// Tuerca Store — servidor
// Cartas desde Scryfall, precios desde el listado público de Card Kingdom.
import express from 'express';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as sec from './seguridad.js';
import { createVerifier } from './verificacion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// En Railway el volumen persistente se monta en RAILWAY_VOLUME_MOUNT_PATH; en tu PC se usa ./data
const DATA = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const IS_PROD = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
// Si ADMIN_PASSWORD está definida en el hosting, manda sobre la guardada en config.json
const ENV_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const SCRYFALL_API = process.env.SCRYFALL_API || 'https://api.scryfall.com';
const CK_URL = process.env.CK_URL || 'https://api.cardkingdom.com/api/v2/pricelist';
const DOLAR_API = process.env.DOLAR_API || 'https://dolarapi.com/v1/dolares';
const ARCHIDEKT_API = process.env.ARCHIDEKT_API || 'https://archidekt.com/api';
const UA = 'TuercaStore/1.0 (tienda de cartas)';

const FILES = {
  config: path.join(DATA, 'config.json'),
  inventory: path.join(DATA, 'inventario.json'),
  orders: path.join(DATA, 'pedidos.json'),
  users: path.join(DATA, 'usuarios.json'),
  sales: path.join(DATA, 'ventas.json'),       // cartas que los clientes le venden a la tienda
  credits: path.join(DATA, 'creditos.json'),   // libro de movimientos del crédito de tienda
  ck: path.join(DATA, 'ck-pricelist.json'),
};

const CONDITIONS = ['NM', 'LP', 'MP', 'HP'];

const DEFAULT_CONFIG = {
  storeName: 'Tuerca Store',
  tagline: 'Singles de Magic: The Gathering',
  whatsapp: '',              // ej: 5491122334455 (sin + ni espacios)
  instagram: '',
  currency: 'ARS',           // 'ARS' o 'USD'
  dollarRate: 1200,          // pesos por dólar
  dollarType: 'blue',        // oficial | blue | tarjeta | cripto ... (para el botón de actualizar)
  autoDollar: false,         // actualizar cotización automáticamente cada 6 h
  markupPercent: 0,          // recargo sobre el precio de Card Kingdom (puede ser negativo)
  roundTo: 100,              // redondeo hacia arriba (en la moneda de venta)
  minPrice: 500,             // precio mínimo por carta (en la moneda de venta)
  conditionFactors: { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5 }, // si CK no informa precio por condición
  useScryfallFallback: true, // si CK no tiene la carta, usar precio USD de Scryfall
  hideOutOfPrice: false,     // ocultar cartas sin precio
  buyEnabled: true,          // módulo "Vendé tus cartas"
  buyCashPercent: 50,        // se paga este % del precio de venta de la tienda, en dinero
  buyCreditPercent: 75,      // … o este % en crédito de tienda
  buyMinOffer: 0,            // no se compran cartas cuya oferta en dinero sea menor a esto
  buyRoundTo: 10,            // redondeo hacia abajo de las ofertas
  buyRequirePhotos: true,    // exigir fotos de las cartas por mail para completar la venta
  buyPhotosEmail: '',        // mail donde se reciben las fotos (si queda vacío se usa el mail de envío)
};

// ---------------------------------------------------------------- almacenamiento
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return structuredClone(fallback); }
}
const writeQueues = new Map();
async function writeJson(file, value) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.then(async () => {
    const tmp = file + '.tmp';
    const text = JSON.stringify(value, null, 2);
    await fs.writeFile(tmp, text, 'utf8');
    try { await fs.rename(tmp, file); }
    catch { await fs.writeFile(file, text, 'utf8'); await fs.rm(tmp, { force: true }); } // Windows: archivo bloqueado
  });
  writeQueues.set(file, next.catch(() => {}));
  return next;
}

let config = { ...DEFAULT_CONFIG, ...(await readJson(FILES.config, {})) };
config.conditionFactors = { ...DEFAULT_CONFIG.conditionFactors, ...(config.conditionFactors || {}) };
let inventory = await readJson(FILES.inventory, []);
let orders = await readJson(FILES.orders, []);
let users = await readJson(FILES.users, []);
let sales = await readJson(FILES.sales, []);
let credits = await readJson(FILES.credits, []);
const keyInfo = sec.initKeys(DATA);
// cuentas creadas antes de la verificación: se consideran verificadas
for (const u of users) if (u.verified === undefined) u.verified = true;
const verifier = createVerifier({ getConfig: () => config, decrypt: sec.decrypt, isProd: IS_PROD, storeName: () => config.storeName || 'Tuerca Store' });
await writeJson(FILES.config, config);

const saveInventory = () => writeJson(FILES.inventory, inventory);
const saveOrders = () => writeJson(FILES.orders, orders);
const saveUsers = () => writeJson(FILES.users, users);
const saveSales = () => writeJson(FILES.sales, sales);
const saveCredits = () => writeJson(FILES.credits, credits);

// ---------------------------------------------------------------- crédito de tienda
// Libro de movimientos: el saldo de cada cliente es la suma de sus movimientos (nunca se pisa un número).
const creditBalance = (userId) => Math.round(credits.filter((c) => c.userId === userId).reduce((s, c) => s + c.amount, 0) * 100) / 100;
function addCredit(userId, amount, reason, ref = null, by = 'sistema') {
  const mv = { id: crypto.randomUUID(), userId, amount: Math.round(Number(amount) * 100) / 100, reason: String(reason).slice(0, 200), ref, by, created_at: new Date().toISOString() };
  credits.push(mv);
  return mv;
}
const saveConfig = () => writeJson(FILES.config, config);
// contraseña del panel: se guarda SOLO como hash (scrypt). Migra la versión vieja en texto plano.
{
  const plain = config.adminPassword;
  if (plain || !config.adminPasswordHash) {
    const pw = plain ? String(plain) : 'tuerca123';
    config.adminPasswordHash = sec.hashPassword(pw);
    config.adminPasswordDefault = pw === 'tuerca123';
  }
  delete config.adminPassword;
  await saveConfig();
}

// ---------------------------------------------------------------- Card Kingdom
const ck = { index: new Map(), updatedAt: null, count: 0, loading: false, error: null };
const CK_MAX_AGE = 12 * 60 * 60 * 1000;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const isTrue = (v) => v === true || v === 'true' || v === 1 || v === '1';
// Acabados: 'nonfoil' (normal), 'foil' (foil tradicional), 'surge' (Surge Foil)
const FINISHES = ['nonfoil', 'foil', 'surge'];
const FINISH_LABEL = { nonfoil: 'Normal', foil: 'Foil', surge: 'Surge Foil' };
const ckKey = (id, finish) => `${String(id).toLowerCase()}|${finish}`;
const isSurgeText = (...parts) => parts.some((s) => /surge/i.test(String(s || '')));

// Acepta { finish } nuevo o { foil } viejo (true/false)
function normalizeFinish(finish, foil) {
  if (FINISHES.includes(finish)) return finish;
  if (finish === true || finish === '1') return 'foil';
  return isTrue(foil) ? 'foil' : 'nonfoil';
}

function buildCkIndex(json) {
  const list = Array.isArray(json) ? json : (json.data || []);
  const index = new Map();
  for (const p of list) {
    if (!p.scryfall_id) continue;
    const finish = !isTrue(p.is_foil) ? 'nonfoil' : isSurgeText(p.variation, p.name, p.sku, p.edition) ? 'surge' : 'foil';
    const key = ckKey(p.scryfall_id, finish);
    const cv = p.condition_values || {};
    const entry = {
      retail: num(p.price_retail),
      cond: { NM: num(cv.nm_price), LP: num(cv.ex_price), MP: num(cv.vg_price), HP: num(cv.g_price) },
      qty: Number(p.qty_retail) || 0,
      buy: num(p.price_buy),
      url: p.url ? `https://www.cardkingdom.com/${String(p.url).replace(/^\//, '')}` : null,
      variation: p.variation || '',
    };
    const prev = index.get(key);
    // si hay varias entradas con el mismo scryfall_id, priorizamos la que tiene precio y sin variante rara
    if (!prev || (!prev.retail && entry.retail) || (prev.variation && !entry.variation && entry.retail)) index.set(key, entry);
  }
  return index;
}

async function loadCK({ force = false } = {}) {
  if (ck.loading) return;
  ck.loading = true; ck.error = null;
  try {
    let stat = null;
    try { stat = await fs.stat(FILES.ck); } catch {}
    const stale = !stat || Date.now() - stat.mtimeMs > CK_MAX_AGE;
    if (force || stale) {
      console.log('[CK] Descargando listado de precios de Card Kingdom…');
      try {
        const r = await fetch(CK_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!r.ok) throw new Error(`Card Kingdom respondió ${r.status}`);
        const text = await r.text();
        JSON.parse(text); // validar antes de guardar
        await fs.writeFile(FILES.ck, text, 'utf8');
        stat = await fs.stat(FILES.ck);
      } catch (e) {
        if (!stat) throw e;
        console.warn('[CK] No se pudo actualizar, uso la copia guardada:', e.message);
        ck.error = `No se pudo actualizar (${e.message}); usando copia del ${new Date(stat.mtimeMs).toLocaleString('es-AR')}`;
      }
    }
    const json = JSON.parse(await fs.readFile(FILES.ck, 'utf8'));
    ck.index = buildCkIndex(json);
    ck.count = ck.index.size;
    ck.updatedAt = stat.mtime.toISOString();
    console.log(`[CK] ${ck.count} precios cargados (${ck.updatedAt})`);
  } catch (e) {
    ck.error = e.message;
    console.error('[CK] Error:', e.message);
  } finally {
    ck.loading = false;
  }
}

// surgePrint: la impresión de Scryfall es en sí una versión surge (promo_types incluye "surgefoil").
// En ese caso CK puede listarla como foil a secas; su foil ES el surge foil.
function ckFor(scryfallId, finish, surgePrint = false) {
  const get = (f) => ck.index.get(ckKey(scryfallId, f)) || null;
  if (finish === 'surge') return get('surge') || (surgePrint ? get('foil') : null);
  if (finish === 'foil') return surgePrint ? (get('foil') || get('surge')) : get('foil');
  return get('nonfoil');
}

function ckUsd(item) {
  const e = ckFor(item.scryfall_id, item.finish, item.surgePrint);
  if (!e) return null;
  const cond = item.condition || 'NM';
  return e.cond[cond] || (e.retail ? e.retail * (config.conditionFactors[cond] ?? 1) : null);
}

// ---------------------------------------------------------------- precios
function roundUp(value, step) {
  if (!step || step <= 0) return Math.round(value * 100) / 100;
  return Math.ceil(value / step) * step;
}

function priceOf(item) {
  if (item.priceOverride != null && item.priceOverride !== '') {
    return { price: Number(item.priceOverride), usd: null, source: 'manual' };
  }
  let usd = ckUsd(item);
  let source = usd ? 'cardkingdom' : null;
  if (!usd && config.useScryfallFallback && item.scryfallUsd) {
    usd = item.scryfallUsd * (config.conditionFactors[item.condition || 'NM'] ?? 1);
    source = 'scryfall';
  }
  if (!usd) return { price: null, usd: null, source: null };
  const v = Math.max(saleFromUsd(usd), Number(config.minPrice) || 0);
  return { price: v, usd: Math.round(usd * 100) / 100, source };
}

// USD -> precio de venta en la moneda de la tienda (recargo + dólar + redondeo, sin precio mínimo)
function saleFromUsd(usd) {
  let v = usd * (1 + (Number(config.markupPercent) || 0) / 100);
  if (config.currency === 'ARS') v *= Number(config.dollarRate) || 0;
  return roundUp(v, Number(config.roundTo) || 0);
}

// Cotización de compra: % del precio al que la tienda la vendería (sin precio mínimo ni precio fijo)
function buyQuote(card, finish, condition, { ignoreMin = false } = {}) {
  const probe = { scryfall_id: card.scryfall_id, finish, condition, surgePrint: card.surgePrint };
  let usd = ckUsd(probe), source = usd ? 'cardkingdom' : null;
  if (!usd && config.useScryfallFallback) {
    const s = finish === 'nonfoil' ? card.scryfall_usd : (finish === 'surge' && !card.surgePrint ? null : card.scryfall_usd_foil);
    if (s) { usd = s * (config.conditionFactors[condition] ?? 1); source = 'scryfall'; }
  }
  if (!usd) return null;
  const sale = saleFromUsd(usd);
  const step = Number(config.buyRoundTo) || 0;
  const down = (v) => (step > 0 ? Math.floor(v / step) * step : Math.floor(v * 100) / 100);
  const cash = down(sale * (Number(config.buyCashPercent) || 0) / 100);
  const credit = down(sale * (Number(config.buyCreditPercent) || 0) / 100);
  if (cash < (Number(config.buyMinOffer) || 0)) return ignoreMin ? { sale, cash, credit, source, belowMin: true } : { sale, cash: 0, credit: 0, source, tooLow: true };
  return { sale, cash, credit, source };
}

function publicItem(item) {
  const p = priceOf(item);
  return {
    id: item.id, scryfall_id: item.scryfall_id, name: item.name, printed_name: item.printed_name,
    set: item.set, set_name: item.set_name, collector_number: item.collector_number,
    rarity: item.rarity, colors: item.colors, color_identity: item.color_identity,
    type_line: item.type_line, mana_cost: item.mana_cost, cmc: item.cmc, oracle_text: item.oracle_text,
    image: item.image, image_small: item.image_small, image_large: item.image_large, image_back: item.image_back,
    finish: item.finish, foil: item.finish !== 'nonfoil', condition: item.condition, lang: item.lang, qty: item.qty, added_at: item.added_at,
    price: p.price,
    legalities: pickFormats(item.legalities),
  };
}

// formatos que se muestran en la tienda (claves de Scryfall)
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'paupercommander',
  'oathbreaker', 'brawl', 'standardbrawl', 'historic', 'timeless', 'premodern', 'predh', 'oldschool'];
function pickFormats(leg) {
  if (!leg) return null;
  const out = {};
  for (const f of FORMATS) if (leg[f]) out[f] = leg[f];
  return out;
}

// ---------------------------------------------------------------- Scryfall
let lastScry = 0;
async function scryfall(urlPath, options = {}) {
  const wait = lastScry + 120 - Date.now();   // Scryfall pide ≤10 req/s
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastScry = Date.now();
  const url = urlPath.startsWith('http') ? urlPath : SCRYFALL_API + urlPath;
  const r = await fetch(url, {
    ...options,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const json = await r.json().catch(() => null);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(json?.details || `Scryfall respondió ${r.status}`);
  return json;
}

function mapCard(c) {
  const faces = c.card_faces || [];
  const img = c.image_uris || faces[0]?.image_uris || {};
  const back = !c.image_uris && faces[1]?.image_uris ? faces[1].image_uris.normal : null;
  const usd = num(c.prices?.usd), usdFoil = num(c.prices?.usd_foil) || num(c.prices?.usd_etched);
  const promo = c.promo_types || [];
  const surgePrint = promo.includes('surgefoil');
  const fin = c.finishes || ['nonfoil'];
  const hasFoil = fin.includes('foil') || fin.includes('etched');
  const finishOptions = [];
  if (fin.includes('nonfoil')) finishOptions.push('nonfoil');
  if (hasFoil) finishOptions.push(surgePrint ? 'surge' : 'foil');
  return {
    scryfall_id: c.id,
    name: c.name,
    printed_name: c.printed_name || faces[0]?.printed_name || null,
    set: c.set, set_name: c.set_name, collector_number: c.collector_number,
    rarity: c.rarity, lang: c.lang,
    colors: c.colors || faces[0]?.colors || [],
    color_identity: c.color_identity || [],
    type_line: c.type_line || faces.map((f) => f.type_line).join(' // '),
    mana_cost: c.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    cmc: c.cmc ?? 0,
    oracle_text: c.oracle_text ?? faces.map((f) => f.oracle_text).filter(Boolean).join('\n—\n'),
    image: img.normal || null, image_small: img.small || null, image_large: img.large || img.normal || null,
    image_back: back,
    finishes: fin,
    finishOptions, surgePrint, promo_types: promo,
    legalities: c.legalities || null,
    scryfall_usd: usd, scryfall_usd_foil: usdFoil,
    released_at: c.released_at,
  };
}

function withCk(card) {
  const pack = (e) => (e ? { retail: e.retail, cond: e.cond, qty: e.qty, url: e.url } : null);
  const options = [...card.finishOptions];
  // CK a veces vende el surge foil como variante del mismo scryfall_id
  if (!options.includes('surge') && ck.index.has(ckKey(card.scryfall_id, 'surge'))) options.push('surge');
  return {
    ...card,
    finishOptions: options,
    ck: {
      nonfoil: pack(ckFor(card.scryfall_id, 'nonfoil')),
      foil: card.surgePrint ? null : pack(ckFor(card.scryfall_id, 'foil')),
      surge: pack(ckFor(card.scryfall_id, 'surge', card.surgePrint)),
    },
  };
}

// ---------------------------------------------------------------- inventario
function sameStock(a, b) {
  return a.scryfall_id === b.scryfall_id && a.finish === b.finish && a.condition === b.condition && a.lang === b.lang;
}

// si piden "foil" de una impresión que sólo existe como surge, es surge
// y si piden "normal" de una impresión que sólo existe en foil/surge, se usa ese acabado
function resolveFinish(card, finish) {
  if (finish === 'foil' && card.surgePrint) return 'surge';
  const opts = card.finishOptions;
  if (finish === 'nonfoil' && Array.isArray(opts) && opts.length && !opts.includes('nonfoil')) return opts[0];
  return finish;
}

function addToInventory(card, { finish = 'nonfoil', condition = 'NM', lang, qty = 1, priceOverride = null }) {
  condition = CONDITIONS.includes(condition) ? condition : 'NM';
  lang = lang || card.lang || 'en';
  qty = Math.max(0, parseInt(qty, 10) || 0);
  finish = resolveFinish(card, normalizeFinish(finish));
  const candidate = { scryfall_id: card.scryfall_id, finish, foil: finish !== 'nonfoil', condition, lang };
  const existing = inventory.find((i) => sameStock(i, candidate));
  if (existing) {
    existing.qty += qty;
    if (priceOverride != null && priceOverride !== '') existing.priceOverride = Number(priceOverride);
    Object.assign(existing, pickCardFields(card));
    return { item: existing, merged: true };
  }
  const item = {
    id: crypto.randomUUID(),
    ...pickCardFields(card),
    ...candidate,
    qty,
    priceOverride: priceOverride != null && priceOverride !== '' ? Number(priceOverride) : null,
    added_at: new Date().toISOString(),
  };
  inventory.push(item);
  return { item, merged: false };
}

function pickCardFields(card) {
  const {
    scryfall_id, name, printed_name, set, set_name, collector_number, rarity, colors, color_identity,
    type_line, mana_cost, cmc, oracle_text, image, image_small, image_large, image_back,
  } = card;
  return {
    scryfall_id, name, printed_name, set, set_name, collector_number, rarity, colors, color_identity,
    type_line, mana_cost, cmc, oracle_text, image, image_small, image_large, image_back,
    surgePrint: !!card.surgePrint,
    legalities: card.legalities || null,
    scryfallUsdNonfoil: card.scryfall_usd, scryfallUsdFoil: card.scryfall_usd_foil,
  };
}
// el precio de respaldo de Scryfall depende del acabado.
// Scryfall no separa surge de foil salvo que la impresión sea surge: en ese caso su usd_foil ya es el del surge.
function fixScryfallUsd(item) {
  item.foil = item.finish !== 'nonfoil';
  if (item.finish === 'nonfoil') item.scryfallUsd = item.scryfallUsdNonfoil ?? null;
  else if (item.finish === 'surge' && !item.surgePrint) item.scryfallUsd = null; // no hay dato fiable del surge
  else item.scryfallUsd = item.scryfallUsdFoil ?? null;
}

// Formato de lista: "4 Sol Ring", "1x Lightning Bolt (2XM) 117 *F*", "Counterspell [MH2] foil",
// surge foil: "*S*", "surge" o "surge foil" al final
const SURGE_RE = /\s(\*S\*|\(surge(\s*foil)?\)|surge(\s*foil)?)\s*$/i;
const FOIL_RE = /\s(\*F\*|\*E\*|foil|\(foil\))\s*$/i;
function parseListLine(raw) {
  let line = raw.trim();
  if (!line || line.startsWith('//') || line.startsWith('#')) return null;
  if (/^(deck|sideboard|commander|companion|maybeboard)\s*:?\s*$/i.test(line)) return null;
  let finish = null;
  if (SURGE_RE.test(line)) { finish = 'surge'; line = line.replace(SURGE_RE, ''); }
  else if (FOIL_RE.test(line)) { finish = 'foil'; line = line.replace(FOIL_RE, ''); }
  let qty = 1;
  const q = line.match(/^(\d+)\s*x?\s+/i);
  if (q) { qty = parseInt(q[1], 10); line = line.slice(q[0].length); }
  let set = null, number = null;
  const s = line.match(/\s[\(\[]([A-Za-z0-9]{2,6})[\)\]](?:\s+([A-Za-z0-9★†\-]+))?\s*$/);
  if (s) { set = s[1].toLowerCase(); number = s[2] || null; line = line.slice(0, s.index); }
  const name = line.trim();
  if (!name) return null;
  return { raw, qty, name, set, number, finish };
}

function identifierFor(p) {
  if (p.set && p.number) return { set: p.set, collector_number: p.number };
  if (p.set) return { name: p.name, set: p.set };
  return { name: p.name };
}

const normIdent = (o) => Object.keys(o).sort().map((k) => `${k}=${String(o[k]).toLowerCase()}`).join('&');
const sameIdentifier = (a, b) => normIdent(a) === normIdent(b);

// ---------------------------------------------------------------- dólar
async function fetchDollar(type = config.dollarType) {
  const r = await fetch(`${DOLAR_API}/${encodeURIComponent(type)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`dolarapi respondió ${r.status}`);
  const j = await r.json();
  const venta = Number(j.venta);
  if (!venta) throw new Error('Respuesta sin cotización de venta');
  return { venta, compra: Number(j.compra) || null, nombre: j.nombre || type, fecha: j.fechaActualizacion || null };
}

async function autoDollarTick() {
  if (!config.autoDollar || config.currency !== 'ARS') return;
  try {
    const d = await fetchDollar(config.dollarType);
    config.dollarRate = d.venta; config.dollarUpdatedAt = new Date().toISOString();
    await saveConfig();
    console.log(`[Dólar] ${d.nombre}: ${d.venta}`);
  } catch (e) { console.warn('[Dólar] No se pudo actualizar:', e.message); }
}

// ---------------------------------------------------------------- app
// ---------------------------------------------------------------- legalidades
// Los baneos cambian: se actualizan desde Scryfall al arrancar y una vez por día.
const LEGAL_MAX_AGE = 24 * 60 * 60 * 1000;
const legal = { running: false, updatedAt: config.legalitiesUpdatedAt || null, error: null };
async function refreshLegalities({ force = false } = {}) {
  if (legal.running) return;
  const missing = inventory.some((i) => !i.legalities || i.surgePrint === undefined);
  const stale = !legal.updatedAt || Date.now() - new Date(legal.updatedAt).getTime() > LEGAL_MAX_AGE;
  if (!force && !missing && !stale) return;
  legal.running = true; legal.error = null;
  try {
    const ids = [...new Set(inventory.map((i) => i.scryfall_id))];
    const byId = new Map();
    for (let k = 0; k < ids.length; k += 75) {
      const json = await scryfall('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: ids.slice(k, k + 75).map((id) => ({ id })) }) });
      for (const c of json?.data || []) byId.set(c.id, c);
    }
    for (const i of inventory) {
      const c = byId.get(i.scryfall_id);
      if (!c) continue;
      i.legalities = c.legalities || i.legalities || null;
      // de paso se refrescan los precios de respaldo de Scryfall
      const m = mapCard(c);
      i.scryfallUsdNonfoil = m.scryfall_usd; i.scryfallUsdFoil = m.scryfall_usd_foil;
      i.surgePrint = m.surgePrint;
      // una impresión que es surge no tiene foil común: si quedó cargada como foil, es surge
      if (m.surgePrint && i.finish === 'foil') i.finish = 'surge';
      fixScryfallUsd(i);
    }
    legal.updatedAt = new Date().toISOString();
    config.legalitiesUpdatedAt = legal.updatedAt;
    await Promise.all([saveInventory(), saveConfig()]);
    console.log(`[Formatos] Legalidades actualizadas (${byId.size} cartas)`);
  } catch (e) {
    legal.error = e.message;
    console.warn('[Formatos] No se pudieron actualizar las legalidades:', e.message);
  } finally {
    legal.running = false;
  }
}

// migración: datos de clientes en pedidos viejos sin cifrar -> cifrados
{
  let changed = false;
  for (const o of orders) {
    for (const k of ['name', 'phone', 'note']) {
      const v = o.customer?.[k];
      if (v && !String(v).startsWith('v1:')) { o.customer[k] = sec.encrypt(v); changed = true; }
    }
  }
  if (changed) await saveOrders();
}
const decryptCustomer = (c = {}) => {
  const safe = (v) => { try { return sec.decrypt(v); } catch { return '(no se pudo descifrar)'; } };
  return { name: safe(c.name), phone: safe(c.phone), note: safe(c.note) };
};

// migración: inventario viejo con foil true/false -> finish
for (const i of inventory) {
  if (!FINISHES.includes(i.finish)) { i.finish = normalizeFinish(null, i.foil); fixScryfallUsd(i); }
}

const app = express();
app.set('trust proxy', 1);
const jsonSmall = express.json({ limit: '2mb' }), jsonBig = express.json({ limit: '60mb' });
app.use((req, res, next) => (req.path === '/api/admin/respaldo' ? jsonBig : jsonSmall)(req, res, next));
app.get('/api/salud', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const asyncH = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message || 'Error interno' });
});

// ---- público
app.get('/api/tienda', (req, res) => {
  res.json({
    storeName: config.storeName, tagline: config.tagline, whatsapp: config.whatsapp ? true : false,
    instagram: config.instagram, currency: config.currency,
  });
});

app.get('/api/productos', (req, res) => {
  const list = inventory.filter((i) => i.qty > 0).map(publicItem)
    .filter((i) => !config.hideOutOfPrice || i.price != null);
  res.json(list);
});

app.get('/api/productos/:id', (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  // otras versiones de la misma carta en stock
  const others = inventory.filter((i) => i.name === item.name && i.id !== item.id && i.qty > 0).map(publicItem);
  res.json({ ...publicItem(item), others });
});

// imágenes para la vista previa de pedidos (los pedidos viejos no las guardaban: se buscan en el inventario)
function withItemImages(items = []) {
  return items.map((i) => {
    if (i.image) return i;
    const inv = inventory.find((x) => x.id === i.id);
    return inv ? { ...i, image: inv.image_small || inv.image || null, image_large: inv.image_large || inv.image || null } : i;
  });
}

// ---- estados, avisos y chat de los pedidos
const ORDER_STATUS = ['pendiente', 'preparando', 'preparado', 'pagado', 'entregado', 'cancelado'];
const MAX_MSGS = 300;
const safeDec = (v) => { try { return sec.decrypt(v); } catch { return '(no se pudo leer el mensaje)'; } };
const orderMessages = (o) => (o.messages || []).map((m) => ({ id: m.id, from: m.from, text: safeDec(m.text), at: m.at }));
// mensajes sin leer para 'cliente' (los que escribió la tienda) o para 'tienda' (los que escribió el cliente)
function unreadFor(o, who) {
  const seen = who === 'cliente' ? o.seenByUser : o.seenByAdmin;
  const other = who === 'cliente' ? 'tienda' : 'cliente';
  return (o.messages || []).filter((m) => m.from === other && (!seen || m.at > seen)).length;
}
const readyNew = (o) => o.status === 'preparado' && !o.readySeen;
// avisos que el cliente ve en su perfil: pedidos listos para retirar + mensajes nuevos de la tienda
const userNotices = (uid) => orders.reduce((n, o) => (o.userId === uid ? n + unreadFor(o, 'cliente') + (readyNew(o) ? 1 : 0) : n), 0);
function addMessage(o, from, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) { const e = new Error('Escribí un mensaje'); e.status = 400; throw e; }
  if ((o.messages || []).length >= MAX_MSGS) { const e = new Error('Este pedido ya tiene demasiados mensajes'); e.status = 400; throw e; }
  const at = new Date().toISOString();
  (o.messages ||= []).push({ id: crypto.randomUUID(), from, text: sec.encrypt(t), at });
  if (from === 'cliente') o.seenByUser = at; else o.seenByAdmin = at;
}

// ---- cuentas de clientes
const COOKIE = 'tuerca_sid';
// sesión válida (verificada o no)
function sessionUser(req) {
  const t = sec.readToken(sec.parseCookies(req.headers.cookie)[COOKIE]);
  if (!t) return null;
  const u = users.find((x) => x.id === t.u);
  return u && (u.pv || 0) === t.v && !u.disabled ? u : null;
}
// usuario con mail/celular verificado: el único que puede comprar con su cuenta
function currentUser(req) {
  const u = sessionUser(req);
  return u && u.verified ? u : null;
}
function setSession(req, res, user) {
  const token = sec.signToken(user.id, user.pv || 0, 30);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
}
const publicUser = (u) => {
  const contact = sec.decrypt(u.contact);
  return {
    id: u.id, name: sec.decrypt(u.name), contactType: u.type, contact: sec.maskContact(contact),
    phone: u.type === 'phone' ? contact : '', verified: !!u.verified,
    credit: creditBalance(u.id),
    notifications: userNotices(u.id),
  };
};
const registerLimit = sec.rateLimiter({ max: 8, windowMs: 3600e3, lockMs: 3600e3 });
const loginLimitIp = sec.rateLimiter({ max: 10, windowMs: 15 * 60e3, lockMs: 15 * 60e3 });
const loginLimitAcc = sec.rateLimiter({ max: 8, windowMs: 15 * 60e3, lockMs: 15 * 60e3 });

// envía el código y arma la respuesta para la tienda
async function sendCode(user) {
  const contact = sec.decrypt(user.contact);
  const r = await verifier.send(user, user.type, contact);
  await saveUsers();
  const via = user.type === 'email' ? 'tu mail' : 'SMS';
  return {
    sentTo: sec.maskContact(contact), via,
    dev: r.dev ? 'Modo prueba: el código se muestra en la ventana negra del servidor.' : null,
  };
}
const errOut = (res, e, fallback) => res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.status ? e.message : fallback });

app.get('/api/cuenta/opciones', (req, res) => {
  res.json({ email: verifier.available('email'), phone: false });
});

app.post('/api/cuenta/registro', asyncH(async (req, res) => {
  const ip = req.ip || 'x';
  if (registerLimit.blocked(ip)) return res.status(429).json({ error: 'Demasiados registros desde esta conexión. Probá más tarde.' });
  const { contact, name, password, empresa, t } = req.body || {};
  // anti-bots: campo trampa invisible ("empresa") y formulario completado en menos de 2 segundos
  if (empresa || !Number(t) || Date.now() - Number(t) < 2000) {
    registerLimit.fail(ip);
    return res.status(400).json({ error: 'No pudimos completar el registro. Recargá la página e intentá de nuevo.' });
  }
  const c = sec.normalizeContact(contact);
  // el registro es solo con mail
  if (!c || c.type !== 'email') return res.status(400).json({ error: 'Ingresá un mail válido.' });
  if (!verifier.available('email')) return res.status(400).json({ error: 'El registro de cuentas nuevas no está disponible por el momento.' });
  const nm = String(name || '').trim().slice(0, 80);
  if (nm.length < 2) return res.status(400).json({ error: 'Ingresá tu nombre' });
  const pwErr = sec.passwordProblem(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const idx = sec.blindIndex(c.value);
  registerLimit.fail(ip); // cuenta cada intento de registro, exitoso o no
  const existing = users.find((u) => u.idx === idx);
  if (existing?.verified) return res.status(409).json({ error: `Ya existe una cuenta con ese ${c.type === 'email' ? 'mail' : 'celular'}. Probá ingresar.` });
  // si alguien lo registró antes y nunca lo verificó, el dueño real puede registrarse igual
  if (existing) users = users.filter((u) => u !== existing);
  const user = {
    id: crypto.randomUUID(), type: c.type, idx,
    contact: sec.encrypt(c.value), name: sec.encrypt(nm),
    pass: sec.hashPassword(password), pv: 0, verified: false,
    created_at: new Date().toISOString(), last_login: new Date().toISOString(),
  };
  users.push(user);
  let sent;
  try { sent = await sendCode(user); }
  catch (e) {
    users = users.filter((u) => u !== user); await saveUsers();
    console.error('[Verificación]', e.message);
    return errOut(res, e, c.type === 'email' ? 'No pudimos enviar el mail. Revisá la dirección.' : 'No pudimos enviar el código a ese celular. Revisá el número.');
  }
  setSession(req, res, user);
  res.json({ user: publicUser(user), needsVerification: true, ...sent });
}));

app.post('/api/cuenta/ingresar', asyncH(async (req, res) => {
  const ip = req.ip || 'x';
  const { contact, password } = req.body || {};
  const c = sec.normalizeContact(contact);
  const idx = c ? sec.blindIndex(c.value) : 'x';
  if (loginLimitIp.blocked(ip) || loginLimitAcc.blocked(idx)) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
  const user = c && users.find((u) => u.idx === idx && !u.disabled);
  const ok = user ? sec.verifyPassword(password, user.pass) : (sec.burnTime(password), false);
  if (!ok) { loginLimitIp.fail(ip); loginLimitAcc.fail(idx); return res.status(401).json({ error: 'Mail/celular o contraseña incorrectos' }); }
  loginLimitIp.ok(ip); loginLimitAcc.ok(idx);
  user.last_login = new Date().toISOString(); saveUsers();
  setSession(req, res, user);
  if (!user.verified) {
    let sent = {};
    try { sent = await sendCode(user); } catch (e) { sent = { sendError: e.message }; }
    return res.json({ user: publicUser(user), needsVerification: true, ...sent });
  }
  res.json({ user: publicUser(user) });
}));

app.post('/api/cuenta/verificar', asyncH(async (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Tu sesión venció. Ingresá de nuevo.' });
  if (u.verified) return res.json({ user: publicUser(u) });
  try { await verifier.check(u, u.type, sec.decrypt(u.contact), req.body?.code); }
  catch (e) { await saveUsers(); return errOut(res, e, 'No pudimos comprobar el código. Probá de nuevo.'); }
  u.verified = true; u.verified_at = new Date().toISOString();
  await saveUsers();
  res.json({ user: publicUser(u) });
}));

app.post('/api/cuenta/reenviar', asyncH(async (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Tu sesión venció. Ingresá de nuevo.' });
  if (u.verified) return res.json({ ok: true });
  try { res.json(await sendCode(u)); }
  catch (e) { errOut(res, e, 'No pudimos reenviar el código.'); }
}));

app.post('/api/cuenta/salir', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/cuenta', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  res.json({ user: publicUser(u), needsVerification: !u.verified });
});

app.post('/api/cuenta/clave', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  const { current, password } = req.body || {};
  if (!sec.verifyPassword(current, u.pass)) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  const pwErr = sec.passwordProblem(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  u.pass = sec.hashPassword(password); u.pv = (u.pv || 0) + 1; // cierra las demás sesiones
  saveUsers(); setSession(req, res, u);
  res.json({ ok: true });
});

app.get('/api/cuenta/pedidos', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  const mine = orders.filter((o) => o.userId === u.id);
  res.json(mine.map((o) => ({
    number: o.number, status: o.status, created_at: o.created_at, total: o.total, currency: o.currency, items: withItemImages(o.items),
    creditUsed: o.creditUsed || 0, toPay: o.toPay ?? o.total,
    readyAt: o.status === 'preparado' ? o.readyAt || null : null, readyNew: readyNew(o),
    messages: (o.messages || []).length, unread: unreadFor(o, 'cliente'),
  })));
  // el aviso de "listo para retirar" ya se mostró: deja de contar como novedad
  const fresh = mine.filter(readyNew);
  if (fresh.length) { for (const o of fresh) o.readySeen = true; saveOrders(); }
});

// chat del pedido (cliente)
const chatLimit = sec.rateLimiter({ max: 20, windowMs: 60e3, lockMs: 60e3 });
const myOrder = (req, u) => orders.find((o) => o.userId === u.id && String(o.number) === String(req.params.number));
app.get('/api/cuenta/pedidos/:number/mensajes', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  const o = myOrder(req, u);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const had = unreadFor(o, 'cliente');
  const messages = orderMessages(o);
  if (had) { o.seenByUser = new Date().toISOString(); saveOrders(); }
  res.json({ messages, notifications: userNotices(u.id) });
});
app.post('/api/cuenta/pedidos/:number/mensajes', asyncH(async (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  const o = myOrder(req, u);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (chatLimit.blocked(u.id)) return res.status(429).json({ error: 'Estás enviando mensajes muy rápido. Esperá un minuto.' });
  chatLimit.fail(u.id);
  try { addMessage(o, 'cliente', req.body?.text); } catch (e) { return errOut(res, e, 'No se pudo enviar el mensaje'); }
  await saveOrders();
  res.json({ messages: orderMessages(o), notifications: userNotices(u.id) });
}));

// ---- "Vendé tus cartas" (la tienda compra) + crédito de tienda
const BUY_STATUS = ['pendiente', 'aceptada', 'completada', 'rechazada', 'cancelada'];
const buySearchLimit = sec.rateLimiter({ max: 40, windowMs: 60e3, lockMs: 60e3 });
const CONDS = ['NM', 'LP', 'MP', 'HP'];

function quoteCard(card, opts) {
  const quotes = {};
  for (const f of card.finishOptions || ['nonfoil']) {
    quotes[f] = {};
    for (const cnd of CONDS) quotes[f][cnd] = buyQuote(card, f, cnd, opts);
  }
  return quotes;
}
const photosEmail = () => String(config.buyPhotosEmail || '').trim() || verifier.emailAddress();
const buyInfo = () => ({
  requirePhotos: !!config.buyRequirePhotos, photosEmail: config.buyRequirePhotos ? photosEmail() : '',
  enabled: !!config.buyEnabled, cashPercent: Number(config.buyCashPercent) || 0, creditPercent: Number(config.buyCreditPercent) || 0,
  minOffer: Number(config.buyMinOffer) || 0, currency: config.currency,
});

app.get('/api/vender/info', (req, res) => res.json(buyInfo()));

app.get('/api/vender/buscar', asyncH(async (req, res) => {
  if (!config.buyEnabled) return res.status(403).json({ error: 'Por ahora no estamos comprando cartas' });
  const ip = req.ip || 'x';
  if (buySearchLimit.blocked(ip)) return res.status(429).json({ error: 'Demasiadas búsquedas seguidas. Esperá un minuto.' });
  buySearchLimit.fail(ip);
  const q = String(req.query.q || '').trim().slice(0, 150);
  if (q.length < 2) return res.json({ cards: [] });
  const prints = req.query.prints === '1';
  const page = Math.max(1, Math.min(10, parseInt(req.query.page, 10) || 1));
  const json = await scryfall(`/cards/search?q=${encodeURIComponent(q + ' game:paper')}&unique=${prints ? 'prints' : 'cards'}&order=${prints ? 'released' : 'name'}&page=${page}`);
  if (!json) return res.json({ cards: [], total: 0 });
  const cards = json.data.map(mapCard).map(withCk).map((c) => ({
    scryfall_id: c.scryfall_id, name: c.name, set: c.set, set_name: c.set_name, collector_number: c.collector_number,
    rarity: c.rarity, image: c.image, image_small: c.image_small, finishOptions: c.finishOptions, surgePrint: c.surgePrint,
    quotes: quoteCard(c),
  }));
  res.json({ cards, total: json.total_cards, hasMore: json.has_more, page });
}));

// ---- importar una lista o un mazo para cotizar
const buyImportLimit = sec.rateLimiter({ max: 8, windowMs: 60e3, lockMs: 60e3 });
const MAX_IMPORT = 400; // cartas distintas por importación
const userErr = (msg, extra = {}) => Object.assign(new Error(msg), { status: 400, ...extra });
const MOXFIELD_HELP = 'Moxfield no deja leer los mazos desde otras páginas. En tu mazo tocá "More" → "Export" → "Copy for Moxfield" y pegá esa lista acá.';

// mazo público de Archidekt -> [{ qty, finish, ident, raw }]
async function archidektDeck(id) {
  let r;
  try { r = await fetch(`${ARCHIDEKT_API}/decks/${id}/`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw userErr('No pudimos conectar con Archidekt. Probá de nuevo o pegá la lista exportada.'); }
  if (r.status === 404) throw userErr('No encontramos ese mazo en Archidekt. Revisá el link.');
  if (r.status === 401 || r.status === 403) throw userErr('Ese mazo de Archidekt es privado. Hacelo público o pegá la lista exportada.');
  const deck = r.ok ? await r.json().catch(() => null) : null;
  if (!deck || !Array.isArray(deck.cards)) throw userErr('Archidekt no respondió bien. Probá de nuevo o pegá la lista exportada.');
  const skip = new Set((deck.categories || []).filter((c) => c.includedInDeck === false).map((c) => c.name)); // "Maybeboard" y similares
  const entries = [];
  for (const e of deck.cards) {
    const cats = e.categories || [];
    if (cats.length && cats.every((c) => skip.has(c))) continue;
    const c = e.card || {}, name = c.oracleCard?.name || c.displayName || '';
    const set = c.edition?.editioncode, num = c.collectorNumber;
    const ident = /^[0-9a-f-]{36}$/i.test(c.uid || '') ? { id: c.uid } : set && num ? { set: String(set).toLowerCase(), collector_number: String(num) } : name ? { name } : null;
    if (!ident) continue;
    entries.push({ qty: e.quantity, finish: /foil|etched/i.test(e.modifier || '') ? 'foil' : 'nonfoil', ident, raw: `${e.quantity} ${name || c.uid}` });
  }
  return { name: String(deck.name || '').slice(0, 120), entries };
}

app.post('/api/vender/importar', asyncH(async (req, res) => {
  if (!config.buyEnabled) return res.status(403).json({ error: 'Por ahora no estamos comprando cartas' });
  const ip = req.ip || 'x';
  if (buyImportLimit.blocked(ip)) return res.status(429).json({ error: 'Demasiadas importaciones seguidas. Esperá un minuto.' });
  buyImportLimit.fail(ip);
  try { res.json(await quoteList(req.body?.text)); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, moxfield: !!e.moxfield }); throw e; }
}));

// lista de texto o link de Archidekt -> cartas con su cotización de compra (lo usan la tienda y el panel)
async function quoteList(rawText, quoteOpts) {
  const text = String(rawText || '').trim().slice(0, 60000);
  if (!text) throw userErr('Pegá tu lista o el link de tu mazo');
  let entries, deckName = '', source = 'lista';
  {
    const link = /^https?:\/\/\S+$/i.test(text) ? new URL(text) : null;
    if (link) {
      const host = link.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'archidekt.com') {
        const id = link.pathname.match(/\/decks\/(\d+)/)?.[1];
        if (!id) throw userErr('Ese link de Archidekt no es de un mazo. Tiene que ser como archidekt.com/decks/123456/…');
        ({ name: deckName, entries } = await archidektDeck(id)); source = 'archidekt';
      } else if (host === 'moxfield.com' || host.endsWith('.moxfield.com')) throw userErr(MOXFIELD_HELP, { moxfield: true });
      else throw userErr('Solo podemos leer links de mazos públicos de Archidekt. De otros sitios, pegá la lista de cartas (una por línea).');
    } else {
      entries = text.split(/\r?\n/).map(parseListLine).filter(Boolean).map((l) => ({ qty: l.qty, finish: l.finish || 'nonfoil', ident: identifierFor(l), raw: l.raw.trim() }));
    }
  }
  if (!entries.length) throw userErr('No encontramos cartas en lo que pegaste. Poné una carta por línea, por ejemplo: 2 Sol Ring');
  const truncated = entries.length > MAX_IMPORT;
  entries = entries.slice(0, MAX_IMPORT);

  const merged = new Map(), missing = [];
  for (let i = 0; i < entries.length; i += 75) {
    const chunk = entries.slice(i, i + 75);
    const json = await scryfall('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: chunk.map((e) => e.ident) }) });
    const notFound = json?.not_found || [], found = json?.data || [];
    let idx = 0;
    for (const e of chunk) {
      if (notFound.some((nf) => sameIdentifier(nf, e.ident))) { missing.push(e.raw); continue; }
      const raw = found[idx++];
      if (!raw) { missing.push(e.raw); continue; }
      const c = withCk(mapCard(raw));
      const opts = c.finishOptions.length ? c.finishOptions : ['nonfoil'];
      let finish = resolveFinish(c, e.finish);
      if (!opts.includes(finish)) finish = finish !== 'nonfoil' && opts.includes('foil') ? 'foil' : opts[0];
      const qty = Math.max(1, Math.min(99, parseInt(e.qty, 10) || 1));
      const key = `${c.scryfall_id}|${finish}`;
      if (merged.has(key)) { const m = merged.get(key); m.qty = Math.min(99, m.qty + qty); continue; }
      merged.set(key, {
        scryfall_id: c.scryfall_id, name: c.name, set: c.set, set_name: c.set_name, collector_number: c.collector_number,
        rarity: c.rarity, image: c.image, image_small: c.image_small, finishOptions: opts, surgePrint: c.surgePrint,
        quotes: quoteCard(c, quoteOpts), qty, finish,
      });
    }
  }
  return { cards: [...merged.values()], missing, truncated, deckName, source };
}

// trae varias cartas de Scryfall por id (de a 75)
async function cardsById(ids) {
  const out = new Map();
  const uniq = [...new Set(ids)];
  for (let k = 0; k < uniq.length; k += 75) {
    const json = await scryfall('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: uniq.slice(k, k + 75).map((id) => ({ id })) }) });
    for (const c of json?.data || []) { const m = withCk(mapCard(c)); out.set(m.scryfall_id, m); }
  }
  return out;
}

app.post('/api/vender', asyncH(async (req, res) => {
  if (!config.buyEnabled) return res.status(403).json({ error: 'Por ahora no estamos comprando cartas' });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Ingresá con tu cuenta para enviar la solicitud', needLogin: true });
  const { items, payout, note } = req.body || {};
  if (!['cash', 'credit'].includes(payout)) return res.status(400).json({ error: 'Elegí si querés dinero o crédito de tienda' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Tu lista está vacía' });
  if (items.length > 200) return res.status(400).json({ error: 'Máximo 200 cartas distintas por solicitud' });
  const cards = await cardsById(items.map((i) => String(i.scryfall_id || '')));
  const lines = [], problems = [];
  for (const it of items) {
    const card = cards.get(String(it.scryfall_id));
    const finish = FINISHES.includes(it.finish) ? it.finish : 'nonfoil';
    const condition = CONDS.includes(it.condition) ? it.condition : 'NM';
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    if (!card) { problems.push(`${it.name || it.scryfall_id}: no encontrada`); continue; }
    const q = buyQuote(card, finish, condition);
    if (!q || q.tooLow || !q.cash) { problems.push(`${card.name}: no la estamos comprando`); continue; }
    lines.push({
      scryfall_id: card.scryfall_id, name: card.name, set: card.set, set_name: card.set_name, collector_number: card.collector_number,
      image: card.image_small || card.image, finish, condition, qty, accepted: qty,
      unitSale: q.sale, unitCash: q.cash, unitCredit: q.credit, source: q.source,
    });
  }
  if (!lines.length) return res.status(400).json({ error: problems[0] || 'Ninguna carta se puede cotizar', problems });
  const number = sales.reduce((m, v) => Math.max(m, v.number || 5000), 5000) + 1;
  const sale = {
    id: crypto.randomUUID(), number, userId: user.id, status: 'pendiente', payout, currency: config.currency,
    cashPercent: config.buyCashPercent, creditPercent: config.buyCreditPercent,
    items: lines, note: sec.encrypt(String(note || '').trim().slice(0, 1000)),
    photosRequired: !!config.buyRequirePhotos, photosReceived: false,
    created_at: new Date().toISOString(),
  };
  saleTotals(sale);
  sales.unshift(sale);
  await saveSales();

  let whatsappUrl = null;
  if (config.whatsapp) {
    const money = (v) => fmtMoney(v, config.currency);
    const text = [
      `¡Hola ${config.storeName}! Quiero venderles cartas (solicitud V-${number}):`, '',
      ...lines.map((l) => `• ${l.qty}x ${l.name} (${l.set.toUpperCase()} #${l.collector_number})${l.finish !== 'nonfoil' ? ' ' + FINISH_LABEL[l.finish].toUpperCase() : ''} ${l.condition}`),
      '', `Forma de pago: ${payout === 'credit' ? 'crédito de tienda' : 'dinero'}`,
      `Total ofrecido: ${money(payout === 'credit' ? sale.totalCredit : sale.totalCash)}`,
      `Nombre: ${sec.decrypt(user.name)}`,
    ].join('\n');
    whatsappUrl = `https://wa.me/${config.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  }
  // fotos por mail: se le manda al cliente un mail con las instrucciones (si el envío de mails está configurado)
  let photos = null;
  if (sale.photosRequired) {
    const to = photosEmail();
    const userMail = user.type === 'email' ? sec.decrypt(user.contact) : '';
    const subject = `Fotos solicitud V-${number} - ${sec.decrypt(user.name)}`;
    const listTxt = lines.map((l) => `• ${l.qty}x ${l.name} (${l.set.toUpperCase()} #${l.collector_number}) ${l.condition}${l.finish !== 'nonfoil' ? ' ' + FINISH_LABEL[l.finish] : ''}`);
    const body = ['Adjunto las fotos (frente y dorso) de las cartas de mi solicitud:', '', ...listTxt.slice(0, 25), listTxt.length > 25 ? `… y ${listTxt.length - 25} más` : ''].join('\n');
    photos = { email: to, subject, mailto: to ? `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null, mailed: false };
    if (userMail && to) {
      try {
        photos.mailed = await verifier.sendMail({
          to: userMail, replyTo: to, subject: `${config.storeName}: enviá las fotos de tu solicitud V-${number}`,
          text: `¡Hola! Recibimos tu solicitud de venta V-${number}.\n\nPara completarla, respondé este mail adjuntando fotos (frente y dorso) de cada carta. Si preferís, mandalas a ${to} con el asunto "${subject}".\n\nCartas:\n${listTxt.join('\n')}\n\n${config.storeName}`,
        });
      } catch (e) { console.warn('[Ventas] No se pudo enviar el mail de fotos:', e.message); }
    }
  }
  res.json({ number, payout, total: payout === 'credit' ? sale.totalCredit : sale.totalCash, currency: sale.currency, problems, whatsappUrl, photos });
}));

function saleTotals(v) {
  v.totalCash = v.items.reduce((s, l) => s + l.unitCash * l.accepted, 0);
  v.totalCredit = v.items.reduce((s, l) => s + l.unitCredit * l.accepted, 0);
  v.total = v.payout === 'credit' ? v.totalCredit : v.totalCash;
}

const publicSale = (v) => ({
  id: v.id, number: v.number, status: v.status, payout: v.payout, currency: v.currency, created_at: v.created_at,
  completed_at: v.completed_at, total: v.total, totalCash: v.totalCash, totalCredit: v.totalCredit,
  photosRequired: !!v.photosRequired, photosReceived: !!v.photosReceived,
  photosMailto: v.photosRequired && !v.photosReceived && photosEmail()
    ? `mailto:${photosEmail()}?subject=${encodeURIComponent(`Fotos solicitud V-${v.number}`)}` : null,
  photosEmail: v.photosRequired && !v.photosReceived ? photosEmail() : '',
  items: v.items.map(({ source, unitSale, ...l }) => l), adminNote: v.adminNote || '',
});

app.get('/api/vender/mias', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  res.json(sales.filter((v) => v.userId === u.id).map(publicSale));
});

app.post('/api/vender/:id/cancelar', asyncH(async (req, res) => {
  const u = currentUser(req);
  const v = u && sales.find((x) => x.id === req.params.id && x.userId === u.id);
  if (!v) return res.status(404).json({ error: 'No encontrada' });
  if (v.status !== 'pendiente') return res.status(400).json({ error: 'Esta solicitud ya está en proceso; escribinos para cambiarla' });
  v.status = 'cancelada'; v.updated_at = new Date().toISOString();
  await saveSales(); res.json(publicSale(v));
}));

app.get('/api/cuenta/credito', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'No ingresaste' });
  const mv = credits.filter((c) => c.userId === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200)
    .map(({ id, amount, reason, created_at }) => ({ id, amount, reason, created_at }));
  res.json({ balance: creditBalance(u.id), currency: config.currency, movements: mv });
});

app.post('/api/pedidos', asyncH(async (req, res) => {
  const { items, customer, useCredit } = req.body || {};
  const user = currentUser(req);
  // para comprar hace falta una cuenta verificada, sin excepción
  if (!user) return res.status(401).json({ error: 'Ingresá o creá una cuenta para hacer el pedido', needLogin: true });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'El carrito está vacío' });
  if (!customer?.name?.trim()) return res.status(400).json({ error: 'Falta tu nombre' });
  const lines = [], problems = [];
  for (const { id, qty } of items) {
    const item = inventory.find((i) => i.id === id);
    const want = Math.max(1, parseInt(qty, 10) || 1);
    if (!item || item.qty <= 0) { problems.push({ id, error: 'Sin stock' }); continue; }
    const p = priceOf(item);
    if (p.price == null) { problems.push({ id, error: 'Sin precio' }); continue; }
    if (want > item.qty) { problems.push({ id, error: `Solo quedan ${item.qty}`, available: item.qty }); continue; }
    lines.push({ item, qty: want, price: p.price });
  }
  if (problems.length) return res.status(409).json({ error: 'Algunas cartas cambiaron de stock', problems });

  for (const l of lines) l.item.qty -= l.qty;
  const number = (orders.reduce((m, o) => Math.max(m, o.number || 1000), 1000)) + 1;
  const order = {
    id: crypto.randomUUID(), number, status: 'pendiente', created_at: new Date().toISOString(),
    currency: config.currency,
    userId: user?.id || null,
    customer: {
      name: String(customer.name).trim().slice(0, 120),
      phone: String(customer.phone || '').trim().slice(0, 40),
      note: String(customer.note || '').trim().slice(0, 1000),
    },
    items: lines.map((l) => ({
      id: l.item.id, name: l.item.name, set: l.item.set, set_name: l.item.set_name,
      collector_number: l.item.collector_number, finish: l.item.finish, foil: l.item.finish !== 'nonfoil', condition: l.item.condition,
      lang: l.item.lang, qty: l.qty, price: l.price,
      scryfall_id: l.item.scryfall_id, image: l.item.image_small || l.item.image || null, image_large: l.item.image_large || l.item.image || null,
    })),
  };
  order.total = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  // crédito de tienda
  order.creditUsed = 0;
  if (useCredit && user) {
    const use = Math.min(creditBalance(user.id), order.total);
    if (use > 0) { addCredit(user.id, -use, `Pago del pedido #${number}`, order.id); order.creditUsed = use; }
  }
  order.toPay = Math.max(0, order.total - order.creditUsed);
  const plain = { ...order.customer };
  order.customer = { name: sec.encrypt(plain.name), phone: sec.encrypt(plain.phone), note: sec.encrypt(plain.note) };
  orders.unshift(order);
  await Promise.all([saveInventory(), saveOrders(), order.creditUsed ? saveCredits() : null]);

  let whatsappUrl = null;
  if (config.whatsapp) {
    const money = (v) => fmtMoney(v, config.currency);
    const text = [
      `¡Hola ${config.storeName}! Te hago el pedido #${number}:`,
      '',
      ...order.items.map((i) => `• ${i.qty}x ${i.name} (${i.set.toUpperCase()} #${i.collector_number})${i.finish !== 'nonfoil' ? ' ' + FINISH_LABEL[i.finish].toUpperCase() : ''} ${i.condition} — ${money(i.price * i.qty)}`),
      '',
      `Total: ${money(order.total)}`,
      order.creditUsed ? `Crédito de tienda: -${money(order.creditUsed)}` : null,
      order.creditUsed ? `A pagar: ${money(order.toPay)}` : null,
      `Nombre: ${plain.name}`,
      plain.phone ? `Tel: ${plain.phone}` : null,
      plain.note ? `Nota: ${plain.note}` : null,
    ].filter((l) => l !== null).join('\n');
    whatsappUrl = `https://wa.me/${config.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  }
  res.json({ number, total: order.total, creditUsed: order.creditUsed, toPay: order.toPay, currency: order.currency, whatsappUrl });
}));

function fmtMoney(v, currency) {
  return currency === 'USD'
    ? `US$ ${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

// ---- admin
const sessions = new Map(); // token -> expira
function auth(req, res, next) {
  const token = req.get('x-admin-token');
  const exp = token && sessions.get(token);
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Sesión vencida, volvé a ingresar' });
  next();
}

const isDefaultPassword = () => (ENV_PASSWORD ? ENV_PASSWORD === 'tuerca123' : !!config.adminPasswordDefault);
function checkAdminPassword(pass) {
  if (ENV_PASSWORD) {
    const a = Buffer.from(String(pass)), b = Buffer.from(ENV_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return sec.verifyPassword(String(pass), config.adminPasswordHash);
}
// bloqueo simple contra quien prueba contraseñas: 8 intentos fallidos por IP → 15 minutos afuera
const failures = new Map(); // ip -> { n, until }
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'x';
  const f = failures.get(ip);
  if (f?.until > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
  if (IS_PROD && isDefaultPassword()) {
    return res.status(403).json({ error: 'Por seguridad, definí la variable ADMIN_PASSWORD en Railway antes de entrar.' });
  }
  const pass = String(req.body?.password || '');
  if (!checkAdminPassword(pass)) {
    const n = (f?.n || 0) + 1;
    failures.set(ip, { n, until: n >= 8 ? Date.now() + 15 * 60 * 1000 : 0 });
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  failures.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 7 * 24 * 3600 * 1000);
  res.json({ token, defaultPassword: isDefaultPassword(), envPassword: !!ENV_PASSWORD });
});

app.use('/api/admin', auth);

app.get('/api/admin/estado', (req, res) => {
  const inStock = inventory.filter((i) => i.qty > 0);
  const priced = inStock.map((i) => ({ i, p: priceOf(i) }));
  res.json({
    ck: { count: ck.count, updatedAt: ck.updatedAt, loading: ck.loading, error: ck.error },
    legal: { updatedAt: legal.updatedAt, running: legal.running, error: legal.error },
    inventory: {
      items: inventory.length,
      cards: inStock.reduce((s, i) => s + i.qty, 0),
      value: priced.reduce((s, { i, p }) => s + (p.price || 0) * i.qty, 0),
      noPrice: priced.filter(({ p }) => p.price == null).length,
    },
    orders: { pending: orders.filter((o) => o.status === 'pendiente').length, unread: orders.reduce((n, o) => n + unreadFor(o, 'tienda'), 0) },
    users: users.length,
    sales: { pending: sales.filter((v) => ['pendiente', 'aceptada'].includes(v.status)).length },
    creditTotal: Math.round(users.reduce((s, u) => s + creditBalance(u.id), 0)),
    keyFromEnv: keyInfo.fromEnv,
    currency: config.currency,
  });
});

// la configuración que ve el panel nunca incluye contraseñas ni tokens (solo si están cargados)
function adminConfigView() {
  const { adminPassword, adminPasswordHash, adminPasswordDefault, verify = {}, ...rest } = config;
  const smtp = verify.smtp || {};
  return {
    ...rest,
    verify: {
      smtp: { host: smtp.host || '', port: smtp.port || 465, user: smtp.user || '', from: smtp.from || '', passSet: !!smtp.pass },
      status: verifier.status(),
      fromEnv: { smtp: !!process.env.SMTP_HOST },
    },
  };
}
app.get('/api/admin/config', (req, res) => res.json(adminConfigView()));

app.put('/api/admin/config', asyncH(async (req, res) => {
  const b = req.body || {};
  const allowed = ['storeName', 'tagline', 'whatsapp', 'instagram', 'currency', 'dollarRate', 'dollarType', 'autoDollar',
    'markupPercent', 'roundTo', 'minPrice', 'conditionFactors', 'useScryfallFallback', 'hideOutOfPrice',
    'buyEnabled', 'buyCashPercent', 'buyCreditPercent', 'buyMinOffer', 'buyRoundTo',
    'buyRequirePhotos', 'buyPhotosEmail'];
  for (const k of allowed) if (k in b) config[k] = b[k];
  for (const k of ['dollarRate', 'markupPercent', 'roundTo', 'minPrice', 'buyCashPercent', 'buyCreditPercent', 'buyMinOffer', 'buyRoundTo']) config[k] = Number(config[k]) || 0;
  config.buyCashPercent = Math.min(100, Math.max(0, config.buyCashPercent));
  config.buyCreditPercent = Math.min(150, Math.max(0, config.buyCreditPercent));
  if (!['ARS', 'USD'].includes(config.currency)) config.currency = 'ARS';
  if (b.newPassword && ENV_PASSWORD) return res.status(400).json({ error: 'La contraseña se define con la variable ADMIN_PASSWORD del hosting; cambiala ahí.' });
  if (b.newPassword) {
    if (String(b.newPassword).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    config.adminPasswordHash = sec.hashPassword(String(b.newPassword));
    config.adminPasswordDefault = false;
  }
  if (b.verify && typeof b.verify === 'object') {
    const cur = config.verify || {};
    const smtp = { ...(cur.smtp || {}) };
    const bs = b.verify.smtp || {};
    for (const k of ['host', 'user', 'from']) if (k in bs) smtp[k] = String(bs[k] || '').trim();
    if ('port' in bs) smtp.port = Number(bs.port) || 465;
    if (bs.pass) smtp.pass = sec.encrypt(String(bs.pass).replace(/\s/g, ''));   // contraseñas de app de Gmail vienen con espacios
    if (bs.clearPass) smtp.pass = '';
    config.verify = { smtp };
  }
  await saveConfig();
  res.json(adminConfigView());
}));

app.post('/api/admin/verificacion/probar', asyncH(async (req, res) => {
  const c = sec.normalizeContact(req.body?.to);
  if (!c || c.type !== 'email') return res.status(400).json({ error: 'Escribí un mail válido para la prueba' });
  try { res.json({ message: await verifier.test(c.type, c.value) }); }
  catch (e) { res.status(400).json({ error: `No se pudo enviar: ${e.message}` }); }
}));

app.get('/api/admin/dolar', asyncH(async (req, res) => {
  res.json(await fetchDollar(req.query.tipo || config.dollarType));
}));

app.post('/api/admin/ck/actualizar', asyncH(async (req, res) => {
  await loadCK({ force: true });
  res.json({ count: ck.count, updatedAt: ck.updatedAt, error: ck.error });
}));

// búsqueda en Scryfall (sintaxis completa de Scryfall)
app.get('/api/admin/scryfall/buscar', asyncH(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ cards: [], total: 0 });
  const unique = req.query.prints === '1' ? 'prints' : 'cards';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const json = await scryfall(`/cards/search?q=${encodeURIComponent(q)}&unique=${unique}&order=${req.query.order || 'name'}&page=${page}&include_extras=${req.query.extras === '1'}`);
  if (!json) return res.json({ cards: [], total: 0 });
  res.json({ cards: json.data.map(mapCard).map(withCk), total: json.total_cards, hasMore: json.has_more, page });
}));

// todas las ediciones de una carta
app.get('/api/admin/scryfall/ediciones', asyncH(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json({ cards: [] });
  const json = await scryfall(`/cards/search?q=${encodeURIComponent(`!"${name}"`)}&unique=prints&order=released&dir=desc&include_extras=true`);
  res.json({ cards: json ? json.data.map(mapCard).map(withCk) : [] });
}));

app.get('/api/admin/scryfall/autocompletar', asyncH(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const json = await scryfall(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  res.json(json?.data || []);
}));

app.post('/api/admin/inventario', asyncH(async (req, res) => {
  const { scryfall_id, finish, foil, condition, lang, qty, priceOverride } = req.body || {};
  if (!scryfall_id) return res.status(400).json({ error: 'Falta scryfall_id' });
  const c = await scryfall(`/cards/${encodeURIComponent(scryfall_id)}`);
  if (!c) return res.status(404).json({ error: 'Carta no encontrada en Scryfall' });
  const card = mapCard(c);
  const { item, merged } = addToInventory(card, { finish: normalizeFinish(finish, foil), condition, lang, qty, priceOverride });
  fixScryfallUsd(item);
  await saveInventory();
  res.json({ item: { ...item, ...priceOf(item) }, merged });
}));

// importar lista de texto (formato Arena/Moxfield/MTGO)
app.post('/api/admin/importar', asyncH(async (req, res) => {
  const { text, items, condition = 'NM', lang = 'en', finish: defFinish, foil = false, preview = false } = req.body || {};
  // filas ya previsualizadas y corregidas a mano (edición, acabado y cantidad por carta)
  if (Array.isArray(items)) {
    const rows = items.filter((it) => it && it.scryfall_id && parseInt(it.qty, 10) > 0);
    if (!rows.length) return res.status(400).json({ error: 'No hay cartas para importar' });
    if (rows.length > 1000) return res.status(400).json({ error: 'Máximo 1000 líneas por importación' });
    const cards = new Map();
    const ids = [...new Set(rows.map((it) => String(it.scryfall_id)))];
    for (let i = 0; i < ids.length; i += 75) {
      const json = await scryfall('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }) });
      for (const c of json?.data || []) cards.set(c.id, mapCard(c));
    }
    let added = 0, merged = 0; const missing = [];
    for (const it of rows) {
      const card = cards.get(String(it.scryfall_id));
      if (!card) { missing.push(String(it.raw || it.scryfall_id)); continue; }
      const r = addToInventory(card, { finish: normalizeFinish(it.finish), condition, lang, qty: it.qty });
      fixScryfallUsd(r.item);
      r.merged ? merged++ : added++;
    }
    await saveInventory();
    return res.json({ added, merged, missing });
  }
  const defaultFinish = normalizeFinish(defFinish, foil);
  const lineFinish = (line, card) => resolveFinish(card, line.finish || defaultFinish);
  const parsed = String(text || '').split(/\r?\n/).map(parseListLine).filter(Boolean);
  if (!parsed.length) return res.status(400).json({ error: 'No encontré cartas en el texto' });
  if (parsed.length > 1000) return res.status(400).json({ error: 'Máximo 1000 líneas por importación' });

  const results = [];
  for (let i = 0; i < parsed.length; i += 75) {
    const chunk = parsed.slice(i, i + 75);
    const identifiers = chunk.map(identifierFor);
    const json = await scryfall('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers }) });
    const notFound = json?.not_found || [];
    const found = json?.data || [];
    let idx = 0;
    for (let k = 0; k < chunk.length; k++) {
      const ident = identifiers[k];
      if (notFound.some((nf) => sameIdentifier(nf, ident))) { results.push({ line: chunk[k], card: null }); continue; }
      const c = found[idx++];
      results.push({ line: chunk[k], card: c ? mapCard(c) : null });
    }
  }

  if (preview) {
    return res.json({
      results: results.map(({ line, card }) => ({
        raw: line.raw, qty: line.qty,
        finish: card ? lineFinish(line, card) : (line.finish || defaultFinish),
        card: card ? withCk(card) : null,
      })),
    });
  }
  let added = 0, merged = 0; const missing = [];
  for (const { line, card } of results) {
    if (!card) { missing.push(line.raw); continue; }
    const r = addToInventory(card, { finish: lineFinish(line, card), condition, lang, qty: line.qty });
    fixScryfallUsd(r.item);
    r.merged ? merged++ : added++;
  }
  await saveInventory();
  res.json({ added, merged, missing });
}));

app.get('/api/admin/inventario', (req, res) => {
  res.json(inventory.map((i) => {
    const p = priceOf(i);
    const e = ckFor(i.scryfall_id, i.finish, i.surgePrint);
    return { ...i, price: p.price, usd: p.usd, source: p.source, ckUrl: e?.url || null, ckQty: e?.qty ?? null };
  }));
});

app.patch('/api/admin/inventario/:id', asyncH(async (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  const b = req.body || {};
  if ('qty' in b) item.qty = Math.max(0, parseInt(b.qty, 10) || 0);
  if ('condition' in b && CONDITIONS.includes(b.condition)) item.condition = b.condition;
  if ('lang' in b) item.lang = String(b.lang).slice(0, 5);
  if ('finish' in b || 'foil' in b) { item.finish = resolveFinish(item, normalizeFinish(b.finish, b.foil)); fixScryfallUsd(item); }
  if ('priceOverride' in b) item.priceOverride = b.priceOverride === '' || b.priceOverride == null ? null : Number(b.priceOverride);
  // cambiar la edición (otra impresión de Scryfall) manteniendo cantidad, estado, idioma y precio manual
  let merged = false, removedId = null, target = item;
  if (b.scryfall_id && b.scryfall_id !== item.scryfall_id) {
    const c = await scryfall(`/cards/${encodeURIComponent(b.scryfall_id)}`);
    if (!c) return res.status(404).json({ error: 'Edición no encontrada en Scryfall' });
    const card = mapCard(c);
    const opts = withCk(card).finishOptions;
    let finish = resolveFinish(card, item.finish);
    if (opts.length && !opts.includes(finish)) finish = finish !== 'nonfoil' && opts.includes('foil') ? 'foil' : opts[0];
    const other = inventory.find((x) => x !== item && sameStock(x, { scryfall_id: card.scryfall_id, finish, condition: item.condition, lang: item.lang }));
    if (other) {
      // ya había stock de esa edición con el mismo acabado/estado/idioma: se juntan
      other.qty += item.qty;
      if (other.priceOverride == null && item.priceOverride != null) other.priceOverride = item.priceOverride;
      inventory = inventory.filter((x) => x !== item);
      for (const o of orders) for (const l of o.items || []) if (l.id === item.id) l.id = other.id; // para que cancelar un pedido viejo devuelva el stock
      merged = true; removedId = item.id; target = other;
      await saveOrders();
    } else {
      Object.assign(item, pickCardFields(card));
      item.finish = finish; fixScryfallUsd(item);
    }
  }
  await saveInventory();
  const p = priceOf(target);
  const e = ckFor(target.scryfall_id, target.finish, target.surgePrint);
  res.json({ ...target, price: p.price, usd: p.usd, source: p.source, ckUrl: e?.url || null, ckQty: e?.qty ?? null, ...(merged ? { merged, removedId } : {}) });
}));

app.delete('/api/admin/inventario/:id', asyncH(async (req, res) => {
  const before = inventory.length;
  inventory = inventory.filter((i) => i.id !== req.params.id);
  if (inventory.length === before) return res.status(404).json({ error: 'No encontrado' });
  await saveInventory();
  res.json({ ok: true });
}));

app.post('/api/admin/legalidades/actualizar', asyncH(async (req, res) => {
  await refreshLegalities({ force: true });
  res.json({ updatedAt: legal.updatedAt, error: legal.error });
}));

// cotizador del panel: mismo cálculo que "Vendé tus cartas", pero muestra el valor aunque quede bajo el mínimo de compra
app.post('/api/admin/cotizar', asyncH(async (req, res) => {
  try {
    const r = await quoteList(req.body?.text, { ignoreMin: true });
    res.json({ ...r, cashPercent: Number(config.buyCashPercent) || 0, creditPercent: Number(config.buyCreditPercent) || 0, minOffer: Number(config.buyMinOffer) || 0, currency: config.currency });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
}));

const adminOrder = (o) => ({ ...o, items: withItemImages(o.items), customer: decryptCustomer(o.customer), messages: orderMessages(o), unread: unreadFor(o, 'tienda') });
app.get('/api/admin/pedidos', (req, res) => res.json(orders.map(adminOrder)));

// chat del pedido (tienda)
app.post('/api/admin/pedidos/:id/mensajes', asyncH(async (req, res) => {
  const o = orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'No encontrado' });
  if (!o.userId) return res.status(400).json({ error: 'Este pedido se hizo sin cuenta: coordiná por WhatsApp' });
  try { addMessage(o, 'tienda', req.body?.text); } catch (e) { return errOut(res, e, 'No se pudo enviar el mensaje'); }
  await saveOrders();
  res.json(adminOrder(o));
}));
app.post('/api/admin/pedidos/:id/visto', asyncH(async (req, res) => {
  const o = orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'No encontrado' });
  if (unreadFor(o, 'tienda')) { o.seenByAdmin = new Date().toISOString(); await saveOrders(); }
  res.json({ ok: true });
}));

// ---- clientes (el panel ve los datos descifrados; en disco siguen cifrados)
app.get('/api/admin/clientes', (req, res) => {
  res.json(users.map((u) => {
    let contact = '', name = '';
    try { contact = sec.decrypt(u.contact); name = sec.decrypt(u.name); } catch { contact = '(clave de cifrado distinta)'; }
    return {
      id: u.id, type: u.type, contact, name, created_at: u.created_at, last_login: u.last_login, disabled: !!u.disabled,
      verified: !!u.verified,
      orders: orders.filter((o) => o.userId === u.id).length,
      sales: sales.filter((v) => v.userId === u.id).length,
      credit: creditBalance(u.id),
    };
  }));
});
app.post('/api/admin/clientes/:id/clave', (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const pwErr = sec.passwordProblem(req.body?.password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  u.pass = sec.hashPassword(req.body.password); u.pv = (u.pv || 0) + 1;
  saveUsers(); res.json({ ok: true });
});
app.patch('/api/admin/clientes/:id', (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  if ('disabled' in (req.body || {})) { u.disabled = !!req.body.disabled; u.pv = (u.pv || 0) + 1; }
  if (req.body?.verified === true) { u.verified = true; u.verified_at = new Date().toISOString(); u.verify = {}; }
  saveUsers(); res.json({ ok: true });
});

// ---- compras (solicitudes de venta de clientes)
app.get('/api/admin/ventas', (req, res) => {
  res.json(sales.map((v) => {
    const u = users.find((x) => x.id === v.userId);
    let name = '', contact = '', note = '';
    try { name = u ? sec.decrypt(u.name) : '(cuenta borrada)'; contact = u ? sec.decrypt(u.contact) : ''; note = sec.decrypt(v.note); } catch {}
    return { ...v, note, customer: { name, contact, type: u?.type, credit: u ? creditBalance(u.id) : 0 } };
  }));
});

app.patch('/api/admin/ventas/:id', asyncH(async (req, res) => {
  const v = sales.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'No encontrada' });
  const b = req.body || {};
  const closed = ['completada', 'rechazada', 'cancelada'].includes(v.status);
  if ('adminNote' in b) v.adminNote = String(b.adminNote || '').slice(0, 1000);
  if ('photosReceived' in b && !closed) { v.photosReceived = !!b.photosReceived; v.photos_at = v.photosReceived ? new Date().toISOString() : null; }
  if (Array.isArray(b.items) && !closed) {
    for (const ch of b.items) {
      const l = v.items[ch.idx]; if (!l) continue;
      if ('accepted' in ch) l.accepted = Math.max(0, Math.min(l.qty, parseInt(ch.accepted, 10) || 0));
      if ('unitCash' in ch) l.unitCash = Math.max(0, Number(ch.unitCash) || 0);
      if ('unitCredit' in ch) l.unitCredit = Math.max(0, Number(ch.unitCredit) || 0);
    }
  }
  if (b.payout && ['cash', 'credit'].includes(b.payout) && !closed) v.payout = b.payout;
  saleTotals(v);
  if (b.status && b.status !== v.status) {
    if (!BUY_STATUS.includes(b.status)) return res.status(400).json({ error: 'Estado inválido' });
    if (closed) return res.status(400).json({ error: 'Esta solicitud ya está cerrada' });
    if (b.status === 'completada') {
      if (v.photosRequired && !v.photosReceived) return res.status(400).json({ error: 'Primero marcá que recibiste las fotos de las cartas' });
      if (!v.items.some((l) => l.accepted > 0)) return res.status(400).json({ error: 'No hay cartas aceptadas' });
      // se acredita (si eligió crédito) y, si se pidió, las cartas entran al stock
      if (v.payout === 'credit' && v.total > 0) addCredit(v.userId, v.total, `Venta de cartas V-${v.number}`, v.id, 'admin');
      if (b.addToStock) {
        const cards = await cardsById(v.items.filter((l) => l.accepted > 0).map((l) => l.scryfall_id));
        for (const l of v.items) {
          const card = cards.get(l.scryfall_id);
          if (!card || !l.accepted) continue;
          const r = addToInventory(card, { finish: l.finish, condition: l.condition, lang: card.lang || 'en', qty: l.accepted });
          fixScryfallUsd(r.item);
        }
        v.addedToStock = true;
        await saveInventory();
      }
      v.completed_at = new Date().toISOString();
    }
    v.status = b.status;
  }
  v.updated_at = new Date().toISOString();
  await Promise.all([saveSales(), saveCredits()]);
  res.json(v);
}));

// ---- crédito de tienda por cliente
app.get('/api/admin/clientes/:id/credito', (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  res.json({ balance: creditBalance(u.id), movements: credits.filter((c) => c.userId === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) });
});
app.post('/api/admin/clientes/:id/credito', asyncH(async (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
  const reason = String(req.body?.reason || '').trim();
  if (!amount) return res.status(400).json({ error: 'Poné un monto (negativo para descontar)' });
  if (!reason) return res.status(400).json({ error: 'Escribí el motivo del ajuste' });
  if (creditBalance(u.id) + amount < 0) return res.status(400).json({ error: 'El saldo no puede quedar negativo' });
  addCredit(u.id, amount, reason, null, 'admin');
  await saveCredits();
  res.json({ balance: creditBalance(u.id) });
}));

app.patch('/api/admin/pedidos/:id', asyncH(async (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'No encontrado' });
  const status = req.body?.status;
  if (!ORDER_STATUS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  if (status === 'cancelado' && order.status !== 'cancelado') {
    for (const l of order.items) { const it = inventory.find((i) => i.id === l.id); if (it) it.qty += l.qty; }
    if (order.creditUsed > 0 && order.userId) addCredit(order.userId, order.creditUsed, `Devolución: pedido #${order.number} cancelado`, order.id);
  } else if (order.status === 'cancelado' && status !== 'cancelado') {
    for (const l of order.items) { const it = inventory.find((i) => i.id === l.id); if (it) it.qty = Math.max(0, it.qty - l.qty); }
    if (order.creditUsed > 0 && order.userId) {
      const use = Math.min(creditBalance(order.userId), order.creditUsed);
      if (use > 0) addCredit(order.userId, -use, `Pago del pedido #${order.number} (reactivado)`, order.id);
      order.creditUsed = use; order.toPay = Math.max(0, order.total - use);
    }
  }
  // "preparado": el cliente ve en su perfil el aviso de que puede pasar a retirar
  if (status === 'preparado' && order.status !== 'preparado') { order.readyAt = new Date().toISOString(); order.readySeen = false; }
  order.status = status; order.updated_at = new Date().toISOString();
  await Promise.all([saveOrders(), saveInventory(), saveCredits()]);
  res.json(adminOrder(order));
}));

// respaldo completo (inventario + pedidos + configuración, sin la contraseña) para mudar la tienda
app.get('/api/admin/respaldo', (req, res) => {
  const { adminPassword: _pw, adminPasswordHash: _h, adminPasswordDefault: _d, verify: _v, ...cfg } = config; // sin contraseñas ni tokens de envío
  res.setHeader('Content-Disposition', `attachment; filename="tuerca-respaldo-${new Date().toISOString().slice(0, 10)}.json"`);
  // los datos de clientes viajan CIFRADOS: para restaurarlos en otro lado hace falta la misma clave de cifrado
  res.json({ app: 'tuerca-store', version: 3, created_at: new Date().toISOString(), config: cfg, inventory, orders, users, sales, credits });
});

app.post('/api/admin/respaldo', asyncH(async (req, res) => {
  const b = req.body || {};
  if (b.app !== 'tuerca-store' || !Array.isArray(b.inventory) || !Array.isArray(b.orders)) {
    return res.status(400).json({ error: 'El archivo no es un respaldo de Tuerca Store' });
  }
  const sample = [...(b.users || []).map((u) => u.contact), ...b.orders.map((o) => o.customer?.name)].find((v) => String(v || '').startsWith('v1:'));
  if (sample && !sec.canDecrypt(sample)) {
    return res.status(400).json({ error: 'Este respaldo tiene datos de clientes cifrados con otra clave. Copiá el contenido de clave-secreta.txt de la tienda original en la variable TUERCA_SECRET y reiniciá.' });
  }
  inventory = b.inventory.filter((i) => i && i.id && i.scryfall_id);
  if (Array.isArray(b.users)) users = b.users.filter((u) => u && u.id && u.idx);
  if (Array.isArray(b.sales)) sales = b.sales.filter((v) => v && v.id);
  if (Array.isArray(b.credits)) credits = b.credits.filter((c) => c && c.id && c.userId);
  for (const i of inventory) if (!FINISHES.includes(i.finish)) { i.finish = normalizeFinish(null, i.foil); fixScryfallUsd(i); }
  orders = b.orders.filter((o) => o && o.id);
  if (b.config && typeof b.config === 'object') {
    const { adminPassword: _pw, adminPasswordHash: _h, adminPasswordDefault: _d, verify: _v, ...rest } = b.config; // la contraseña nunca viaja en el respaldo
    config = { ...config, ...rest };
  }
  await Promise.all([saveInventory(), saveOrders(), saveConfig(), saveUsers(), saveSales(), saveCredits()]);
  refreshLegalities({ force: true });
  res.json({ inventory: inventory.length, orders: orders.length, users: users.length, sales: sales.length });
}));

// respaldo del inventario
app.get('/api/admin/exportar', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="tuerca-inventario-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv');
  const rows = [['nombre', 'set', 'numero', 'acabado', 'condicion', 'idioma', 'cantidad', 'precio', 'usd_ck', 'scryfall_id']];
  for (const i of inventory) {
    const p = priceOf(i);
    rows.push([i.name, i.set, i.collector_number, FINISH_LABEL[i.finish], i.condition, i.lang, i.qty, p.price ?? '', p.usd ?? '', i.scryfall_id]);
  }
  res.send('﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n'));
});

app.listen(PORT, () => {
  console.log(`\n  ⚙  ${config.storeName} funcionando en http://localhost:${PORT}`);
  console.log(`     Panel de administración: http://localhost:${PORT}/admin\n`);
  if (isDefaultPassword()) console.log('  ⚠  Estás usando la contraseña por defecto (tuerca123). Cambiala en Configuración.\n');
});

loadCK();
setTimeout(() => refreshLegalities(), 3000);
setInterval(() => refreshLegalities(), 6 * 3600 * 1000).unref?.();
setInterval(() => loadCK(), CK_MAX_AGE).unref?.();
autoDollarTick();
setInterval(autoDollarTick, 6 * 3600 * 1000).unref?.();
