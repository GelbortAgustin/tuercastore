// Utilidades compartidas entre la tienda y el panel
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v, currency = 'ARS') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return currency === 'USD'
    ? 'US$ ' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$ ' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
const usd = (v) => (v == null ? '—' : 'US$ ' + Number(v).toFixed(2));

// {2}{U}{U} -> íconos de Scryfall
function manaHtml(cost) {
  if (!cost) return '';
  return cost.split(' // ').map((part) => '<span class="mana">' +
    (part.match(/\{[^}]+\}/g) || []).map((sym) => {
      const code = sym.slice(1, -1).replace(/\//g, '');
      return `<img src="https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg" alt="${esc(sym)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sym-txt',textContent:this.alt}))">`;
    }).join('') + '</span>').join(' <span class="muted">//</span> ');
}

function setIcon(set, rarity = 'common') {
  return `<img class="set-ico r-${esc(rarity)}" src="https://svgs.scryfall.io/sets/${encodeURIComponent(set)}.svg" alt="" loading="lazy" onerror="this.style.display='none'">`;
}

const RARITY = { common: 'Común', uncommon: 'Infrecuente', rare: 'Rara', mythic: 'Mítica', special: 'Especial', bonus: 'Bonus' };
const COND = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played' };
const LANGS = { en: 'Inglés', es: 'Español', pt: 'Portugués', ja: 'Japonés', de: 'Alemán', fr: 'Francés', it: 'Italiano', ko: 'Coreano', ru: 'Ruso', zhs: 'Chino simp.', zht: 'Chino trad.', ph: 'Phyrexiano' };

function condBadge(c) { return `<span class="badge ${esc(String(c).toLowerCase())}" title="${esc(COND[c] || c)}">${esc(c)}</span>`; }

function toast(msg, isErr = false) {
  const wrap = $('#toasts');
  if (!wrap) return alert(msg);
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Pedidos: estados y chat (lo usan la tienda y el panel)
const ORDER_ST = { pendiente: 'Pendiente', pagado: 'Pagado', preparado: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
// `me` = quién mira: 'tienda' o 'cliente'
function chatHtml(messages = [], me = 'cliente') {
  if (!messages.length) return '<div class="chat-empty">Todavía no hay mensajes.</div>';
  return messages.map((m) => `<div class="msg ${m.from === me ? 'me' : ''}">
    <small>${m.from === me ? 'Vos' : m.from === 'tienda' ? 'Tuerca Store' : 'Cliente'} · ${new Date(m.at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
    <p>${esc(m.text)}</p></div>`).join('');
}
function setChatLog(log, messages, me) {
  if (log.dataset.n === String(messages.length)) return;
  log.dataset.n = messages.length; log.innerHTML = chatHtml(messages, me); log.scrollTop = log.scrollHeight;
}

// Acabados
const FINISH = { nonfoil: 'Normal', foil: 'Foil', surge: 'Surge Foil' };
const finishOf = (p) => p.finish || (p.foil ? 'foil' : 'nonfoil');
function finishBadge(p) {
  const f = finishOf(p);
  if (f === 'surge') return '<span class="badge surge" title="Surge Foil">SURGE FOIL</span>';
  if (f === 'foil') return '<span class="badge foil" title="Foil">FOIL</span>';
  return '';
}

// Formatos (claves de Scryfall)
const FORMATS = {
  standard: 'Standard', pioneer: 'Pioneer', modern: 'Modern', legacy: 'Legacy', vintage: 'Vintage',
  pauper: 'Pauper', commander: 'Commander', paupercommander: 'Pauper Commander', oathbreaker: 'Oathbreaker',
  brawl: 'Brawl', standardbrawl: 'Standard Brawl', historic: 'Historic', timeless: 'Timeless',
  premodern: 'Premodern', predh: 'PreDH', oldschool: 'Old School',
};
const LEGAL = { legal: 'Legal', banned: 'Baneada', restricted: 'Restringida', not_legal: 'No legal' };
// aviso para un formato puntual (sólo baneada / restringida)
function legalWarn(p, format) {
  const s = p.legalities?.[format];
  if (s === 'banned') return `<span class="badge ban" title="Baneada en ${esc(FORMATS[format])}">⚠ BANEADA EN ${esc(FORMATS[format].toUpperCase())}</span>`;
  if (s === 'restricted') return `<span class="badge restr" title="Restringida en ${esc(FORMATS[format])}: máximo 1 copia">⚠ RESTRINGIDA EN ${esc(FORMATS[format].toUpperCase())}</span>`;
  return '';
}
