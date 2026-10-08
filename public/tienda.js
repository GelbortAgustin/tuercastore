// Tuerca Store — tienda pública
const state = {
  products: [], shop: { currency: 'ARS' },
  q: '', colors: new Set(), rarity: new Set(), cond: new Set(), type: '', set: '', format: '', finish: new Set(), sort: 'new',
  shown: 48,
  cart: store.get('tuerca-cart', []), // [{id, qty}]
  user: null,
  pending: null, // cuenta creada pero sin verificar
};
const PAGE = 48;

async function init() {
  $('#year').textContent = new Date().getFullYear();
  buildFilters();
  bindUi();
  bindAccount();
  loadAccount();
  try {
    const [shop, products] = await Promise.all([
      fetch('/api/tienda').then((r) => r.json()),
      fetch('/api/productos').then((r) => r.json()),
    ]);
    state.shop = shop; state.products = products; state.currency = shop.currency;
    document.title = shop.storeName;
    if (shop.tagline) $('#tagline').textContent = shop.tagline;
    fillSets();
    $('#statCards').textContent = products.reduce((s, p) => s + p.qty, 0).toLocaleString('es-AR');
    $('#statSets').textContent = new Set(products.map((p) => p.set)).size;
    pruneCart();
    render();
    renderCart();
    fetch('/api/vender/info').then((r) => r.json()).then((b) => {
      state.buyInfo = b;
      if (!b.enabled) { $$('.mainnav a[href="/vender"]').forEach((a) => a.classList.add('hidden')); return; }
      $('#bCash').textContent = `${b.cashPercent}%`; $('#bCredit').textContent = `${b.creditPercent}%`;
      $('#sellBanner').classList.remove('hidden');
    }).catch(() => {});
    const id = new URLSearchParams(location.search).get('carta');
    if (id) openDetail(id);
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty">No se pudo cargar la tienda. Probá de nuevo en un rato.</div>`;
  }
}

// ---------------------------------------------------------------- filtros
function buildFilters() {
  const colors = [['W', 'Blanco'], ['U', 'Azul'], ['B', 'Negro'], ['R', 'Rojo'], ['G', 'Verde'], ['C', 'Incoloro']];
  $('#fColors').innerHTML = colors.map(([c, n]) =>
    `<button class="color-btn" data-color="${c}" aria-pressed="false" title="${n}"><img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sym-txt',textContent:'${c}'}))"></button>`).join('') +
    `<button class="color-btn txt" data-color="M" aria-pressed="false" title="Multicolor">MULTI</button>`;
  $('#fRarity').innerHTML = ['common', 'uncommon', 'rare', 'mythic'].map((r) =>
    `<button class="chip" data-rarity="${r}" aria-pressed="false">${RARITY[r]}</button>`).join('');
  $('#fFormat').innerHTML = '<option value="">Todos</option>' + Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#fCond').innerHTML = Object.keys(COND).map((c) =>
    `<button class="chip" data-cond="${c}" aria-pressed="false" title="${COND[c]}">${c}</button>`).join('');
}

function fillSets() {
  const sets = new Map();
  for (const p of state.products) sets.set(p.set, p.set_name);
  $('#fSet').innerHTML = '<option value="">Todas</option>' + [...sets].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => `<option value="${esc(code)}">${esc(name)} (${esc(code.toUpperCase())})</option>`).join('');
}

function toggleSet(set, value, btn) {
  set.has(value) ? set.delete(value) : set.add(value);
  btn.setAttribute('aria-pressed', set.has(value));
  state.shown = PAGE; render();
}

function bindUi() {
  $('#q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim().toLowerCase(); state.shown = PAGE; render(); }, 180));
  $('#fColors').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) toggleSet(state.colors, b.dataset.color, b); });
  $('#fRarity').addEventListener('click', (e) => { const b = e.target.closest('[data-rarity]'); if (b) toggleSet(state.rarity, b.dataset.rarity, b); });
  $('#fCond').addEventListener('click', (e) => { const b = e.target.closest('[data-cond]'); if (b) toggleSet(state.cond, b.dataset.cond, b); });
  $('#fType').addEventListener('change', (e) => { state.type = e.target.value; state.shown = PAGE; render(); });
  $('#fSet').addEventListener('change', (e) => { state.set = e.target.value; state.shown = PAGE; render(); });
  $('#fFormat').addEventListener('change', (e) => {
    state.format = e.target.value; state.shown = PAGE;
    $('#formatHint').classList.toggle('hidden', !state.format);
    render();
  });
  $('#fFinish').addEventListener('click', (e) => { const b = e.target.closest('[data-finish]'); if (b) toggleSet(state.finish, b.dataset.finish, b); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#more').addEventListener('click', () => { state.shown += PAGE; render(); });
  $('#clearFilters').addEventListener('click', () => {
    state.colors.clear(); state.rarity.clear(); state.cond.clear(); state.type = ''; state.set = ''; state.format = ''; state.finish.clear();
    $$('[aria-pressed]', $('#filters')).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    $('#fType').value = ''; $('#fSet').value = ''; $('#fFormat').value = ''; $('#formatHint').classList.add('hidden');
    state.shown = PAGE; render();
  });
  $('#toggleFilters').addEventListener('click', () => { $('#filters').classList.add('open'); $('#overlay').classList.add('open'); });

  $('#grid').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addToCart(add.dataset.add, 1);
    const open = e.target.closest('[data-open]');
    if (open) return openDetail(open.dataset.open);
    if (e.target.closest('[data-wish]')) {
      const q = $('#q').value.trim();
      state.user ? openWishlist(q) : (toast('Ingresá o creá una cuenta para armar tu wishlist'), openAuth('ingresar', () => openWishlist(q)));
    }
  });

  $('#openCart').addEventListener('click', openCart);
  $('#overlay').addEventListener('click', closeAll);
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  $('#cartItems').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delta]');
    if (b) changeQty(b.dataset.id, Number(b.dataset.delta));
    const r = e.target.closest('[data-remove]');
    if (r) { state.cart = state.cart.filter((c) => c.id !== r.dataset.remove); saveCart(); }
  });
  $('#goCheckout').addEventListener('click', () => {
    // los pedidos se hacen siempre con cuenta
    if (!state.user) {
      const again = () => { openCart(); $('#goCheckout').click(); };
      if (state.pending) { toast('Confirmá tu cuenta con el código para hacer el pedido'); return openVerify({ sentTo: state.pending.contact }, again); }
      toast('Ingresá o creá una cuenta para hacer tu pedido');
      return openAuth('ingresar', again);
    }
    $('#checkout').classList.remove('hidden'); $('#goCheckout').classList.add('hidden');
    prefillCheckout();
    $('#checkout [name=name]').focus();
  });
  $('#checkout').addEventListener('submit', sendOrder);
  $('#checkout [name=useCredit]').addEventListener('change', renderCreditOption);
}

function matches(p) {
  if (state.q) {
    const hay = `${p.name} ${p.printed_name || ''} ${p.type_line} ${p.set_name} ${p.set}`.toLowerCase();
    if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (state.colors.size) {
    const cols = p.colors || [];
    const ok = [...state.colors].some((c) =>
      c === 'C' ? cols.length === 0 : c === 'M' ? cols.length > 1 : cols.includes(c));
    if (!ok) return false;
  }
  if (state.rarity.size && !state.rarity.has(p.rarity)) return false;
  if (state.cond.size && !state.cond.has(p.condition)) return false;
  if (state.type && !(p.type_line || '').includes(state.type)) return false;
  if (state.set && p.set !== state.set) return false;
  if (state.format) {
    // legal, restringida o baneada (esta última con aviso); "no legal" queda afuera
    const s = p.legalities?.[state.format];
    if (!s || s === 'not_legal') return false;
  }
  if (state.finish.size && !state.finish.has(finishOf(p))) return false;
  return true;
}

const sorters = {
  new: (a, b) => (b.added_at || '').localeCompare(a.added_at || ''),
  name: (a, b) => a.name.localeCompare(b.name),
  'price-asc': (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  'price-desc': (a, b) => (b.price ?? -1) - (a.price ?? -1),
  set: (a, b) => a.set_name.localeCompare(b.set_name) || a.collector_number.localeCompare(b.collector_number, undefined, { numeric: true }),
};

function render() {
  const banRank = (p) => (state.format && p.legalities?.[state.format] === 'banned' ? 1 : 0);
  const list = state.products.filter(matches).sort((a, b) => banRank(a) - banRank(b) || sorters[state.sort](a, b));
  $('#resultCount').textContent = `${list.length.toLocaleString('es-AR')} resultado${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><img src="/logo.svg" alt="">${state.products.length ? 'No hay cartas que coincidan con tu búsqueda.' : 'Todavía no hay cartas cargadas. ¡Volvé pronto!'}
      <div style="margin-top:14px"><button class="btn sm" data-wish>♡ Avisame cuando entre</button></div></div>`;
    $('#more').classList.add('hidden');
    return;
  }
  $('#grid').innerHTML = list.slice(0, state.shown).map(tileHtml).join('');
  $('#more').classList.toggle('hidden', list.length <= state.shown);
}

function tileHtml(p) {
  const inCart = state.cart.find((c) => c.id === p.id)?.qty || 0;
  const left = p.qty - inCart;
  const fin = finishOf(p);
  const warn = state.format ? legalWarn(p, state.format) : '';
  const banned = state.format && p.legalities?.[state.format] === 'banned';
  return `<article class="tile${fin === 'foil' ? ' is-foil' : fin === 'surge' ? ' is-surge' : ''}${banned ? ' is-banned' : ''}">
    <button class="art" data-open="${p.id}" aria-label="Ver ${esc(p.name)}">
      <span class="fx-card ${fin}"><img src="${esc(p.image || '/logo.svg')}" alt="${esc(p.name)}" loading="lazy">${fin === 'surge' ? '<span class="fx-sparkle"></span>' : ''}</span>
    </button>
    <div class="body">
      <div class="name">${esc(p.name)}</div>
      <div class="meta">${setIcon(p.set, p.rarity)} ${esc(p.set.toUpperCase())} #${esc(p.collector_number)} ${condBadge(p.condition)}
        ${finishBadge(p)}${p.lang && p.lang !== 'en' ? `<span class="badge">${esc(p.lang.toUpperCase())}</span>` : ''}</div>
      ${warn ? `<div class="warn">${warn}</div>` : ''}
      <div class="buy">
        <div>
          ${p.price != null ? `<div class="price">${money(p.price, state.shop.currency)}</div>` : '<div class="price na">Consultar</div>'}
          <div class="stock">${p.qty} en stock</div>
        </div>
        <button class="btn primary sm" data-add="${p.id}" ${left <= 0 || p.price == null ? 'disabled' : ''} aria-label="Agregar ${esc(p.name)}">${left <= 0 ? 'En carrito' : '+ Agregar'}</button>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- detalle
async function openDetail(id) {
  const local = state.products.find((p) => p.id === id);
  let p = local;
  try { p = await fetch(`/api/productos/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)); } catch {}
  if (!p) return toast('Esa carta ya no está disponible', true);
  const others = p.others || [];
  $('#modal').classList.remove('narrow');
  $('#modalBody').innerHTML = `<div class="detail">
      <div class="imgs">
        <div class="fx-card ${finishOf(p)}"><img id="detailImg" src="${esc(p.image_large || p.image)}" alt="${esc(p.name)}">${finishOf(p) === 'surge' ? '<span class="fx-sparkle"></span>' : ''}</div>
        ${p.image_back ? `<button class="btn sm" style="margin:10px auto 0;display:flex" id="flip">↻ Ver dorso</button>` : ''}
      </div>
      <div>
        <h2>${esc(p.name)} ${manaHtml(p.mana_cost)}</h2>
        ${p.printed_name && p.printed_name !== p.name ? `<div class="muted">${esc(p.printed_name)}</div>` : ''}
        <div class="type">${esc(p.type_line)}</div>
        ${p.oracle_text ? `<div class="oracle">${esc(p.oracle_text)}</div>` : ''}
        <dl class="kv">
          <dt>Edición</dt><dd>${setIcon(p.set, p.rarity)} ${esc(p.set_name)} (${esc(p.set.toUpperCase())}) #${esc(p.collector_number)}</dd>
          <dt>Rareza</dt><dd>${esc(RARITY[p.rarity] || p.rarity)}</dd>
          <dt>Condición</dt><dd>${condBadge(p.condition)} ${esc(COND[p.condition] || '')}</dd>
          <dt>Acabado</dt><dd>${finishBadge(p) || 'Normal'}</dd>
          <dt>Idioma</dt><dd>${esc(LANGS[p.lang] || p.lang)}</dd>
          <dt>Stock</dt><dd>${p.qty} disponible${p.qty === 1 ? '' : 's'}</dd>
        </dl>
        ${state.format ? legalWarn(p, state.format) : ''}
        ${p.legalities ? `<div class="legal-grid" aria-label="Legalidad por formato">${Object.entries(FORMATS).filter(([k]) => p.legalities[k]).map(([k, v]) =>
          `<div class="${esc(p.legalities[k])}"><span>${v}</span><b>${LEGAL[p.legalities[k]] || esc(p.legalities[k])}</b></div>`).join('')}</div>` : ''}
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div class="price" style="font-size:1.7rem">${p.price != null ? money(p.price, state.shop.currency) : 'Consultar'}</div>
          <div class="qty"><button data-q="-1" aria-label="Menos">−</button><input id="dq" type="number" value="1" min="1" max="${p.qty}" aria-label="Cantidad"><button data-q="1" aria-label="Más">+</button></div>
          <button class="btn primary" id="dAdd" ${p.price == null ? 'disabled' : ''}>Agregar al carrito</button>
        </div>
        ${others.length ? `<div class="others"><h4>Otras versiones en stock</h4>${others.map((o) => `
          <div class="o" data-other="${o.id}">
            <span>${setIcon(o.set, o.rarity)} ${esc(o.set.toUpperCase())} #${esc(o.collector_number)} ${condBadge(o.condition)} ${finishBadge(o)}</span>
            <b class="price" style="font-size:1rem">${money(o.price, state.shop.currency)}</b>
          </div>`).join('')}</div>` : ''}
      </div>
    </div>`;
  const q = $('#dq');
  $$('[data-q]', $('#modalBody')).forEach((b) => b.addEventListener('click', () => {
    q.value = Math.min(p.qty, Math.max(1, Number(q.value) + Number(b.dataset.q)));
  }));
  $('#dAdd').addEventListener('click', () => { addToCart(p.id, Math.max(1, Number(q.value) || 1)); closeAll(); });
  $$('[data-other]', $('#modalBody')).forEach((o) => o.addEventListener('click', () => openDetail(o.dataset.other)));
  const flip = $('#flip');
  if (flip) { let back = false; flip.addEventListener('click', () => { back = !back; $('#detailImg').src = back ? p.image_back : (p.image_large || p.image); }); }
  $('#modal').classList.add('open'); $('#overlay').classList.add('open');
  history.replaceState(null, '', `?carta=${encodeURIComponent(id)}`);
}

function closeAll() {
  $('#modal').classList.remove('open'); $('#drawer').classList.remove('open');
  $('#filters').classList.remove('open'); $('#overlay').classList.remove('open');
  if (location.search) history.replaceState(null, '', location.pathname);
}

// ---------------------------------------------------------------- carrito
const product = (id) => state.products.find((p) => p.id === id);
function saveCart() { store.set('tuerca-cart', state.cart); renderCart(); render(); }
function pruneCart() {
  state.cart = state.cart.filter((c) => product(c.id)).map((c) => ({ ...c, qty: Math.min(c.qty, product(c.id).qty) })).filter((c) => c.qty > 0);
  store.set('tuerca-cart', state.cart);
}

function addToCart(id, qty) {
  const p = product(id); if (!p) return;
  const line = state.cart.find((c) => c.id === id);
  const current = line?.qty || 0;
  const next = Math.min(p.qty, current + qty);
  if (next === current) return toast(`No hay más stock de ${p.name}`, true);
  line ? (line.qty = next) : state.cart.push({ id, qty: next });
  saveCart();
  toast(`Agregaste ${p.name}`);
}

function changeQty(id, delta) {
  const line = state.cart.find((c) => c.id === id); const p = product(id);
  if (!line || !p) return;
  line.qty = Math.min(p.qty, line.qty + delta);
  if (line.qty <= 0) state.cart = state.cart.filter((c) => c.id !== id);
  saveCart();
}

function renderCart() {
  const n = state.cart.reduce((s, c) => s + c.qty, 0);
  $('#cartCount').textContent = n; $('#cartCount').classList.toggle('hidden', !n);
  const total = state.cart.reduce((s, c) => s + (product(c.id)?.price || 0) * c.qty, 0);
  $('#cartTotal').textContent = money(total, state.shop.currency);
  renderCreditOption();
  $('#cartFooter').classList.toggle('hidden', !n);
  if (!n) { $('#cartItems').innerHTML = '<div class="empty" style="margin-top:20px">Tu carrito está vacío.</div>'; return; }
  $('#cartItems').innerHTML = state.cart.map((c) => {
    const p = product(c.id);
    return `<div class="line-item">
      <img src="${esc(p.image_small || p.image)}" alt="">
      <div>
        <div class="n">${esc(p.name)}</div>
        <div class="s">${esc(p.set.toUpperCase())} #${esc(p.collector_number)} · ${esc(p.condition)}${finishOf(p) !== 'nonfoil' ? ' · ' + FINISH[finishOf(p)].toUpperCase() : ''}</div>
        <div class="s">${money(p.price, state.shop.currency)} c/u</div>
      </div>
      <div class="right">
        <b>${money(p.price * c.qty, state.shop.currency)}</b>
        <div class="qty"><button data-delta="-1" data-id="${p.id}" aria-label="Menos">−</button><input value="${c.qty}" readonly aria-label="Cantidad"><button data-delta="1" data-id="${p.id}" aria-label="Más">+</button></div>
        <button class="btn ghost sm danger" data-remove="${p.id}">Quitar</button>
      </div>
    </div>`;
  }).join('');
}

function openCart() {
  $('#drawer').classList.add('open'); $('#overlay').classList.add('open');
  $('#checkout').classList.add('hidden'); $('#goCheckout').classList.remove('hidden');
}

async function sendOrder(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#sendOrder'); btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await fetch('/api/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: state.cart, customer: Object.fromEntries(f), useCredit: f.get('useCredit') === 'on' && !!state.user?.credit }),
    });
    const j = await r.json();
    if (!r.ok) {
      if (j.needLogin) { closeAll(); state.pending ? openVerify({ sentTo: state.pending.contact }, () => openCart()) : openAuth('ingresar', () => openCart()); }
      if (j.problems) {
        state.products = await fetch('/api/productos').then((x) => x.json());
        pruneCart(); renderCart(); render();
      }
      throw new Error(j.error || 'No se pudo enviar el pedido');
    }
    state.cart = []; saveCart();
    if (j.creditUsed) loadAccount();
    state.products = await fetch('/api/productos').then((x) => x.json()); render();
    $('#cartFooter').classList.add('hidden');
    $('#cartItems').innerHTML = `<div class="empty" style="margin-top:20px">
      <img src="/logo.svg" alt="">
      <h3 style="margin:0 0 6px;color:var(--text)">¡Pedido #${j.number} recibido!</h3>
      <p>Total: <b>${money(j.total, j.currency)}</b>${j.creditUsed ? `<br>Crédito usado: <b>−${money(j.creditUsed, j.currency)}</b><br>A pagar: <b>${money(j.toPay, j.currency)}</b>` : ''}. Te reservamos las cartas.</p>
      ${j.whatsappUrl ? `<a class="btn wa" href="${esc(j.whatsappUrl)}" target="_blank" rel="noopener">Coordinar por WhatsApp</a>` : '<p>Nos vamos a comunicar con vos para coordinar el pago y la entrega.</p>'}
    </div>`;
    if (j.whatsappUrl) window.open(j.whatsappUrl, '_blank', 'noopener');
    e.target.reset();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar pedido';
  }
}

function prefillCheckout() {
  const u = state.user; const f = $('#checkout');
  if (!u || !f) return;
  if (!f.name.value) f.name.value = u.name;
  if (!f.phone.value && (u.phone || u.whatsapp)) f.phone.value = u.phone || u.whatsapp;
}

// opción de pagar con crédito de tienda en el checkout
function renderCreditOption() {
  const box = $('#creditUse'); if (!box) return;
  const credit = state.user?.credit || 0;
  const total = state.cart.reduce((s, c) => s + (product(c.id)?.price || 0) * c.qty, 0);
  box.classList.toggle('hidden', !(credit > 0));
  $('#creditAvail').textContent = money(credit, state.shop.currency);
  const use = box.querySelector('input').checked && credit > 0 ? Math.min(credit, total) : 0;
  $('#toPayRow').classList.toggle('hidden', !use);
  $('#toPay').textContent = money(total - use, state.shop.currency);
}

function onAccountChange() {
  prefillCheckout();
  renderCreditOption();
}

init();
