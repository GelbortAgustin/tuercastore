// Tuerca Store — seguridad de datos de clientes
//
// · Contraseñas: hash scrypt con sal aleatoria. No se pueden descifrar: solo se comprueban.
// · Mail / celular / nombre / datos de pedidos: cifrados con AES-256-GCM (clave de 256 bits).
// · Búsqueda de cuentas sin descifrar: "índice ciego" = HMAC-SHA256 del mail o celular normalizado.
// · Sesiones: token firmado con HMAC (no hace falta guardarlas; sobreviven a reinicios).
//
// La clave maestra sale de la variable TUERCA_SECRET o, si no existe, del archivo data/clave-secreta.txt
// (se crea sola la primera vez). SIN ESA CLAVE LOS DATOS CIFRADOS NO SE PUEDEN RECUPERAR.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let keys = null;

export function initKeys(dataDir) {
  let master = process.env.TUERCA_SECRET || '';
  const file = path.join(dataDir, 'clave-secreta.txt');
  if (!master) {
    if (fs.existsSync(file)) master = fs.readFileSync(file, 'utf8').trim();
    else {
      master = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, master + '\n', { encoding: 'utf8', mode: 0o600 });
      console.log(`[Seguridad] Se creó la clave de cifrado en ${file}. Guardala en un lugar seguro.`);
    }
  }
  if (master.length < 32) throw new Error('TUERCA_SECRET debe tener al menos 32 caracteres');
  const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.alloc(0), Buffer.from(label), 32));
  keys = { enc: derive('tuerca/enc/v1'), idx: derive('tuerca/index/v1'), tok: derive('tuerca/token/v1') };
  return { fromEnv: !!process.env.TUERCA_SECRET, file };
}

// ---------------------------------------------------------------- cifrado AES-256-GCM
export function encrypt(text) {
  if (text == null || text === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys.enc, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return '';
  if (typeof blob !== 'string' || !blob.startsWith('v1:')) return String(blob); // dato viejo sin cifrar
  const [, iv, tag, ct] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', keys.enc, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export function canDecrypt(blob) {
  try { decrypt(blob); return true; } catch { return false; }
}

// ---------------------------------------------------------------- contacto (mail o celular)
export function normalizeContact(raw) {
  const s = String(raw || '').trim();
  if (s.includes('@')) {
    const email = s.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return null;
    return { type: 'email', value: email };
  }
  // celular -> formato internacional sin "+" (por defecto Argentina)
  let d = s.replace(/[^\d]/g, '');
  const hadPlus = s.startsWith('+');
  if (!hadPlus && d.startsWith('0')) d = d.slice(1);             // 011... -> 11...
  if (!hadPlus && d.length === 10) d = '549' + d;                // 1155551234 -> 5491155551234
  else if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = '549' + d.slice(2); // falta el 9 de celular
  if (d.length < 10 || d.length > 15) return null;
  return { type: 'phone', value: d };
}

export const blindIndex = (value) => crypto.createHmac('sha256', keys.idx).update(value).digest('hex');

export function maskContact(c) {
  if (!c) return '';
  if (c.includes('@')) { const [u, d] = c.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`; }
  return `${'•'.repeat(Math.max(0, c.length - 4))}${c.slice(-4)}`;
}

// ---------------------------------------------------------------- contraseñas (scrypt)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    return crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}
// para no revelar si una cuenta existe, se hace el mismo trabajo aunque no exista
const DUMMY = hashPassword(crypto.randomBytes(8).toString('hex'));
export const burnTime = (pw) => verifyPassword(pw, DUMMY);

export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (s.length > 200) return 'La contraseña es demasiado larga';
  return null;
}

// ---------------------------------------------------------------- sesiones firmadas
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signToken(userId, version, days = 30) {
  const body = b64u(JSON.stringify({ u: userId, v: version, e: Date.now() + days * 86400e3 }));
  const sig = crypto.createHmac('sha256', keys.tok).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', keys.tok).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return t.e > Date.now() ? t : null;
  } catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------------------------------------------------------------- límite de intentos
export function rateLimiter({ max, windowMs, lockMs }) {
  const hits = new Map();
  return {
    blocked(key) { const h = hits.get(key); return !!(h && h.until > Date.now()); },
    fail(key) {
      const now = Date.now();
      const h = hits.get(key);
      const fresh = !h || now - h.start > windowMs;
      const n = fresh ? 1 : h.n + 1;
      hits.set(key, { n, start: fresh ? now : h.start, until: n >= max ? now + lockMs : 0 });
    },
    ok(key) { hits.delete(key); },
  };
}
