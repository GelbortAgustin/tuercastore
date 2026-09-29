// Tuerca Store — verificación de mail con código
//
// · Código de 6 dígitos enviado por SMTP (por ejemplo Gmail con "contraseña de aplicación").
// · Modo prueba: si el mail no está configurado y la tienda NO está publicada, el código se muestra
//   en la consola del servidor (la ventana negra) para poder probar el registro.
//
// La configuración sale de variables de entorno (tienen prioridad) o del panel (config.verify).
// Las contraseñas/tokens guardados desde el panel se guardan cifrados.
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const CODE_TTL = 10 * 60 * 1000;   // el código vence a los 10 minutos
const MAX_ATTEMPTS = 5;            // intentos para escribir el código
const RESEND_COOLDOWN = 60 * 1000; // 1 minuto entre reenvíos
const MAX_SENDS_HOUR = 5;          // envíos por hora por cuenta

export function createVerifier({ getConfig, decrypt, isProd, storeName }) {
  const cfg = () => {
    const v = getConfig().verify || {};
    const smtp = v.smtp || {};
    const safe = (x) => { try { return decrypt(x || ''); } catch { return ''; } };
    return {
      smtp: {
        host: process.env.SMTP_HOST || smtp.host || '',
        port: Number(process.env.SMTP_PORT || smtp.port || 465),
        user: process.env.SMTP_USER || smtp.user || '',
        pass: process.env.SMTP_PASS || safe(smtp.pass),
        from: process.env.SMTP_FROM || smtp.from || '',
      },
    };
  };

  const emailReady = () => { const s = cfg().smtp; return !!(s.host && s.user && s.pass); };
  const devMode = () => !isProd && !emailReady();

  function status() {
    return { email: emailReady() ? 'ok' : isProd ? 'off' : 'prueba' };
  }

  // ¿se puede registrar gente con este tipo de contacto?
  const available = (type) => type === 'email' && (emailReady() || !isProd);

  const hashCode = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

  let transporter = null, transporterKey = '';
  function mailer() {
    const s = cfg().smtp;
    const key = JSON.stringify(s);
    if (!transporter || key !== transporterKey) {
      transporter = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
      transporterKey = key;
    }
    return transporter;
  }

  async function sendEmail(to, code) {
    const s = cfg().smtp;
    await mailer().sendMail({
      from: s.from || `"${storeName()}" <${s.user}>`,
      to,
      subject: `${code} es tu código de ${storeName()}`,
      text: `Tu código para verificar tu cuenta en ${storeName()} es: ${code}\n\nVence en 10 minutos. Si no creaste una cuenta, ignorá este mail.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px">
        <h2 style="margin:0 0 8px">${escapeHtml(storeName())}</h2>
        <p>Tu código para verificar tu cuenta es:</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${code}</p>
        <p style="color:#666;font-size:13px">Vence en 10 minutos. Si no creaste una cuenta, ignorá este mail.</p></div>`,
    });
  }

  // Envía (o reenvía) el código. contact = mail o celular en formato internacional sin "+".
  async function send(user, type, contact) {
    const v = user.verify || (user.verify = {});
    const now = Date.now();
    v.sends = (v.sends || []).filter((t) => now - t < 3600e3);
    if (v.sentAt && now - v.sentAt < RESEND_COOLDOWN) {
      const wait = Math.ceil((RESEND_COOLDOWN - (now - v.sentAt)) / 1000);
      const e = new Error(`Esperá ${wait} segundos para pedir otro código`); e.status = 429; throw e;
    }
    if (v.sends.length >= MAX_SENDS_HOUR) { const e = new Error('Pediste demasiados códigos. Probá en una hora.'); e.status = 429; throw e; }

    let dev = false;
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (type === 'email' && emailReady()) await sendEmail(contact, code);
    else if (devMode()) {
      dev = true;
      console.log(`\n  🔑 [MODO PRUEBA] Código para ${contact}: ${code}\n     (configurá el envío real en Panel → Configuración → Verificación de cuentas)\n`);
    } else { const e = new Error('La verificación no está disponible por ahora'); e.status = 503; throw e; }
    v.codeHash = hashCode(user.id, code);
    v.sentAt = now; v.sends.push(now); v.exp = now + CODE_TTL; v.attempts = 0;
    return { dev };
  }

  // Devuelve true si el código es correcto. Lanza error con mensaje para el usuario si no.
  async function check(user, type, contact, code) {
    const v = user.verify || {};
    const clean = String(code || '').replace(/\D/g, '');
    if (clean.length < 4) { const e = new Error('Escribí el código que te llegó'); e.status = 400; throw e; }
    if (!v.sentAt) { const e = new Error('Pedí un código primero'); e.status = 400; throw e; }
    if (Date.now() > v.exp) { const e = new Error('El código venció. Pedí uno nuevo.'); e.status = 400; throw e; }
    if ((v.attempts || 0) >= MAX_ATTEMPTS) { const e = new Error('Demasiados intentos. Pedí un código nuevo.'); e.status = 429; throw e; }
    v.attempts = (v.attempts || 0) + 1;
    const a = Buffer.from(hashCode(user.id, clean)), b = Buffer.from(v.codeHash || '');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      const left = MAX_ATTEMPTS - v.attempts;
      const e = new Error(left > 0 ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? '' : 's'}.` : 'Demasiados intentos. Pedí un código nuevo.');
      e.status = 400; throw e;
    }
    user.verify = {};
    return true;
  }

  // Prueba de envío desde el panel
  async function test(type, contact) {
    if (!emailReady()) throw new Error('Completá servidor, usuario y contraseña del mail');
    await sendEmail(contact, '123456');
    return 'Mail de prueba enviado (código 123456).';
  }

  // mail libre (por ejemplo, instrucciones para mandar fotos). Devuelve false si el mail no está configurado.
  async function sendMail({ to, subject, text, html, replyTo }) {
    if (!emailReady()) return false;
    const s = cfg().smtp;
    await mailer().sendMail({ from: s.from || `"${storeName()}" <${s.user}>`, to, subject, text, html, replyTo: replyTo || undefined });
    return true;
  }
  const emailAddress = () => cfg().smtp.user || '';

  return { status, available, send, check, test, devMode, sendMail, emailAddress };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
