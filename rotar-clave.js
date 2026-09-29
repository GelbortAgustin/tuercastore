// Tuerca Store — cambiar la clave de cifrado (por ejemplo, si la clave se filtró)
//
// Uso (con la tienda CERRADA):  node rotar-clave.js      (o doble clic en rotar-clave.bat)
//
// 1. Hace una copia de seguridad de la carpeta data/ antes de tocar nada.
// 2. Descifra todos los datos de clientes con la clave actual.
// 3. Genera una clave nueva y vuelve a cifrar todo con ella.
// 4. Las sesiones de clientes se cierran (tienen que volver a ingresar). Las contraseñas no cambian.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as sec from './seguridad.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const KEYFILE = path.join(DATA, 'clave-secreta.txt');
const read = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return def; } };
const write = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2), 'utf8');

if (!fs.existsSync(KEYFILE) && !process.env.TUERCA_SECRET) {
  console.log('No encontré una clave de cifrado en', DATA, '— no hay nada que rotar.');
  process.exit(0);
}

// 1) copia de seguridad
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = path.join(DATA, `respaldo-antes-de-rotar-${stamp}`);
fs.mkdirSync(backup);
for (const f of fs.readdirSync(DATA)) {
  const full = path.join(DATA, f);
  if (fs.statSync(full).isFile() && f !== 'ck-pricelist.json') fs.copyFileSync(full, path.join(backup, f));
}
console.log('✔ Copia de seguridad en', backup);

// 2) descifrar con la clave actual
sec.initKeys(DATA);
const users = read('usuarios.json', []);
const orders = read('pedidos.json', []);
const sales = read('ventas.json', []);
const config = read('config.json', {});
const dec = (v) => (v ? sec.decrypt(v) : '');
let plainUsers, plainOrders, plainSales, smtpPass;
try {
  plainUsers = users.map((u) => ({ contact: dec(u.contact), name: dec(u.name) }));
  plainOrders = orders.map((o) => ({ name: dec(o.customer?.name), phone: dec(o.customer?.phone), note: dec(o.customer?.note) }));
  plainSales = sales.map((v) => dec(v.note));
  smtpPass = dec(config.verify?.smtp?.pass);
} catch (e) {
  console.error('✖ No pude descifrar los datos con la clave actual. No cambié nada.', e.message);
  process.exit(1);
}

// 3) clave nueva y volver a cifrar
const newKey = crypto.randomBytes(32).toString('hex');
if (process.env.TUERCA_SECRET) process.env.TUERCA_SECRET = newKey;
fs.writeFileSync(KEYFILE, newKey + '\n', { encoding: 'utf8', mode: 0o600 });
sec.initKeys(DATA);
users.forEach((u, i) => {
  u.contact = sec.encrypt(plainUsers[i].contact);
  u.name = sec.encrypt(plainUsers[i].name);
  u.idx = sec.blindIndex(plainUsers[i].contact);
  u.pv = (u.pv || 0) + 1; // cierra las sesiones abiertas
});
orders.forEach((o, i) => {
  if (!o.customer) return;
  o.customer = { name: sec.encrypt(plainOrders[i].name), phone: sec.encrypt(plainOrders[i].phone), note: sec.encrypt(plainOrders[i].note) };
});
sales.forEach((v, i) => { v.note = sec.encrypt(plainSales[i]); });
if (config.verify?.smtp) config.verify.smtp.pass = smtpPass ? sec.encrypt(smtpPass) : '';
write('usuarios.json', users); write('pedidos.json', orders); write('ventas.json', sales); write('config.json', config);

console.log(`✔ Clave nueva generada y ${users.length} clientes, ${orders.length} pedidos y ${sales.length} ventas vueltos a cifrar.`);
console.log('  Guardá una copia de data/clave-secreta.txt en un lugar seguro (NO en GitHub).');
if (process.env.RAILWAY_ENVIRONMENT || process.env.TUERCA_SECRET) console.log('  Clave nueva para la variable TUERCA_SECRET:', newKey);
console.log('  Cuando confirmes que la tienda funciona, podés borrar la carpeta', path.basename(backup));
