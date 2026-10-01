// Tuerca Store — "Vendé tus cartas"
const state = {
  user: null, pending: null, currency: 'ARS', buyInfo: null,
  results: [], search: { q: '', prints: false, page: 1 },
  list: store.get('tuerca-sell', []), // [{key, scryfall_id, name, set, collector_number, image, finish, condition, qty, cash, credit}]
};

const lineKey = (l) => `${l.scryfall_id}|${l.finish}|${l.condition}`;

async function init() {
  $('#year').textContent = new Date().getFullYear();
  bindAccount(); loadAccount();
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
  $('#overlay').addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  try {
    const info = await fetch('/api/vender/info').then((r) => r.json());
    state.buyInfo = info; state.currency = info.currency;
    $('#pCash').textContent = `${info.cashPercent}%`; $('#pCredit').textContent = `${info.creditPercent}%`;
    if (info.requirePhotos) {
      $('#stepPhotos').classList.remove('hidden'); $('#photoNote').classList.remove('hidden');
      $('.steps').classList.add('four');
      if (info.photosEmail) $('#photoMail').innerHTML = ` a <b>${esc(info.photosEmail)}</b>`;
    }
    if (!info.enabled) { $('#sellMain').classList.add('hidden'); $('#closedMsg').classList.remove('hidden'); return; }
  } catch {}
  $('#sellSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    state.search = { q: e.target.q.value.trim(), prints: e.target.prints.checked, page: 1 };
    search(false);
  });
  $('#sellMore').addEventListener('click', () => { state.search.page++; search(true); });
  $('#sellResults').addEventListener('change', (e) => { const r = e.target.closest('.res'); if (r) updateOffer(r); });
  $('#sellResults').addEventListener('click', onResultClick);
  $('#listItems').addEventListener('click', onListClick);
  $$('[name=payout]').forEach((r) => r.addEventListener('change', renderList));
  $('#sellSend').addEventListener('click', sendSale);
  $('#listFab').addEventListener('click', () => $('#sellList').scrollIntoView({ behavior: 'smooth' }));
  renderList();
}

function closeAll() { $('#modal').classList.remove('open'); $('#overlay').classList.remove('open'); }
function onAccountChange() {}

// ---------------------------------------------------------------- búsqueda
async function search(append) {
  if (!append) { $('#sellResults').innerHTML = '<div class="spinner"></div>'; $('#sellInfo').textContent = ''; }
  try {
    const { q, prints, page } = state.search;
    const r = await fetch(`/api/vender/buscar?q=${encodeURIComponent(q)}&prints=${prints ? 1 : 0}&page=${page}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo buscar');
    state.results = append ? state.results.concat(j.cards) : j.cards;
    const html = j.cards.map(resultHtml).join('');
    if (append) $('#sellResults').insertAdjacentHTML('beforeend', html); else $('#sellResults').innerHTML = html;
    $$('#sellResults .res').forEach(updateOffer);
    $('#sellInfo').textContent = j.total ? `${j.total.toLocaleString('es-AR')} resultado${j.total === 1 ? '' : 's'}` : 'No encontramos esa carta. Probá con el nombre en inglés.';
    $('#sellMore').classList.toggle('hidden', !j.hasMore);
  } catch (err) { $('#sellResults').innerHTML = ''; toast(err.message, true); }
}

function resultHtml(c) {
  const opts = c.finishOptions?.length ? c.finishOptions : ['nonfoil'];
  return `<div class="res sell-res" data-id="${esc(c.scryfall_id)}">
    <span class="fx-card ${opts[0] === 'surge' ? 'surge' : ''}"><img src="${esc(c.image || '/logo.svg')}" alt="${esc(c.name)}" loading="lazy">${opts[0] === 'surge' ? '<span class="fx-sparkle"></span>' : ''}</span>
    <div class="n">${esc(c.name)}</div>
    <div class="m">${setIcon(c.set, c.rarity)}<span>${esc(c.set_name)} · ${esc(c.set.toUpperCase())} #${esc(c.collector_number)}</span></div>
    <div class="f">
      <select class="input" data-f="finish" aria-label="Acabado">${opts.map((f) => `<option value="${f}">${FINISH[f]}</option>`).join('')}</select>
      <select class="input" data-f="condition" aria-label="Estado">${Object.keys(COND).map((k) => `<option value="${k}" title="${COND[k]}">${k}</option>`).join('')}</select>
    </div>
    <div class="offer-line" data-offer></div>
    <div class="act-row">
      <div class="qty"><button type="button" data-q="-1" aria-label="Menos">−</button><input data-f="qty" type="number" value="1" min="1" max="99" aria-label="Cantidad"><button type="button" data-q="1" aria-label="Más">+</button></div>
      <button class="btn primary sm" data-act="add">+ Agregar</button>
    </div>
    ${!state.search.prints ? `<button class="btn ghost sm" data-act="prints" data-name="${esc(c.name)}">Ver otras ediciones</button>` : ''}
  </div>`;
}

function quoteFor(box) {
  const c = state.results.find((x) => x.scryfall_id === box.dataset.id);
  const f = $('[data-f=finish]', box).value, cnd = $('[data-f=condition]', box).value;
  return { card: c, finish: f, condition: cnd, q: c?.quotes?.[f]?.[cnd] };
}

function updateOffer(box) {
  const { q, finish } = quoteFor(box);
  const fx = $('.fx-card', box);
  fx.className = `fx-card ${finish === 'surge' ? 'surge' : finish === 'foil' ? 'foil' : ''}`;
  if (finish === 'surge' && !$('.fx-sparkle', fx)) fx.insertAdjacentHTML('beforeend', '<span class="fx-sparkle"></span>');
  const ok = q && !q.tooLow && q.cash > 0;
  $('[data-offer]', box).innerHTML = ok
    ? `<div><small>Dinero</small><b>${money(q.cash, state.currency)}</b></div><div class="cr"><small>Crédito</small><b>${money(q.credit, state.currency)}</b></div>`
    : q?.tooLow
      ? '<div class="no"><small>Por ahora no compramos esta carta (valor muy bajo)</small></div>'
      : '<div class="no"><small>Sin precio de referencia para esta versión. Probá otro acabado o consultanos.</small></div>';
  $('[data-act=add]', box).disabled = !ok;
}

function onResultClick(e) {
  const box = e.target.closest('.res'); if (!box) return;
  const qb = e.target.closest('[data-q]');
  if (qb) { const i = $('[data-f=qty]', box); i.value = Math.min(99, Math.max(1, Number(i.value) + Number(qb.dataset.q))); return; }
  const act = e.target.closest('[data-act]'); if (!act) return;
  if (act.dataset.act === 'prints') {
    $('#sellSearch').q.value = `!"${act.dataset.name}"`; $('#sellSearch').prints.checked = true;
    state.search = { q: `!"${act.dataset.name}"`, prints: true, page: 1 };
    return search(false);
  }
  const { card, finish, condition, q } = quoteFor(box);
  if (!q || !q.cash) return;
  const qty = Math.max(1, Math.min(99, Number($('[data-f=qty]', box).value) || 1));
  const line = { scryfall_id: card.scryfall_id, name: card.name, set: card.set, collector_number: card.collector_number, image: card.image_small || card.image, finish, condition, qty, cash: q.cash, credit: q.credit };
  const existing = state.list.find((l) => lineKey(l) === lineKey(line));
  if (existing) existing.qty = Math.min(99, existing.qty + qty); else state.list.push(line);
  saveList();
  toast(`Agregaste ${qty}× ${card.name}`);
}

// ---------------------------------------------------------------- lista
function saveList() { store.set('tuerca-sell', state.list); renderList(); }

function onListClick(e) {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const line = state.list.find((l) => lineKey(l) === b.dataset.k); if (!line) return;
  if (b.dataset.d) line.qty = Math.min(99, line.qty + Number(b.dataset.d));
  if (b.dataset.rm || line.qty <= 0) state.list = state.list.filter((l) => l !== line);
  saveList();
}

function renderList() {
  const n = state.list.reduce((s, l) => s + l.qty, 0);
  const cash = state.list.reduce((s, l) => s + l.cash * l.qty, 0);
  const credit = state.list.reduce((s, l) => s + l.credit * l.qty, 0);
  $('#listCount').textContent = n ? `(${n} carta${n === 1 ? '' : 's'})` : '';
  $('#listFooter').classList.toggle('hidden', !n);
  $('#listFab').classList.toggle('hidden', !n);
  $('#listFab').textContent = `Ver mi lista (${n})`;
  if (!n) { $('#listItems').innerHTML = '<p class="muted" style="margin:6px 0">Buscá una carta y agregala para ver cuánto te pagamos.</p>'; return; }
  const payout = $('[name=payout]:checked').value;
  $('#listItems').innerHTML = state.list.map((l) => `<div class="line-item">
    <img src="${esc(l.image)}" alt="">
    <div>
      <div class="n">${esc(l.name)}</div>
      <div class="s">${esc(l.set.toUpperCase())} #${esc(l.collector_number)} · ${esc(l.condition)}${l.finish !== 'nonfoil' ? ' · ' + FINISH[l.finish].toUpperCase() : ''}</div>
      <div class="s">${money(payout === 'credit' ? l.credit : l.cash, state.currency)} c/u</div>
    </div>
    <div class="right">
      <b>${money((payout === 'credit' ? l.credit : l.cash) * l.qty, state.currency)}</b>
      <div class="qty"><button data-k="${esc(lineKey(l))}" data-d="-1" aria-label="Menos">−</button><input value="${l.qty}" readonly aria-label="Cantidad"><button data-k="${esc(lineKey(l))}" data-d="1" aria-label="Más">+</button></div>
      <button class="btn ghost sm danger" data-k="${esc(lineKey(l))}" data-rm="1">Quitar</button>
    </div>
  </div>`).join('');
  $('#totCash').textContent = money(cash, state.currency);
  $('#totCredit').textContent = money(credit, state.currency);
  $('#creditExtra').textContent = cash > 0 ? `${money(credit - cash, state.currency)} más que en dinero` : '';
}

async function sendSale() {
  if (!state.user) {
    toast(state.pending ? 'Confirmá tu cuenta con el código para enviar la solicitud' : 'Ingresá o creá una cuenta para enviar la solicitud');
    return state.pending ? openVerify({ sentTo: state.pending.contact, via: 'tu mail' }, sendSale) : openAuth('ingresar', sendSale);
  }
  const btn = $('#sellSend'); btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await fetch('/api/vender', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: state.list, payout: $('[name=payout]:checked').value, note: $('#sellNote').value }),
    });
    const j = await r.json();
    if (!r.ok) { if (j.needLogin) return openAuth('ingresar', sendSale); throw new Error(j.error || 'No se pudo enviar'); }
    state.list = []; saveList(); $('#sellNote').value = '';
    showModal(`<div class="auth" style="text-align:center">
      <img src="/logo.svg" alt="" class="auth-logo">
      <h2 style="margin:0;font-family:var(--display)">¡Solicitud V-${j.number} enviada!</h2>
      <p>Te ofrecemos <b>${money(j.total, j.currency)}</b> en ${j.payout === 'credit' ? '<b>crédito de tienda</b>' : '<b>dinero</b>'}.
      Traé las cartas: las revisamos y confirmamos el total.</p>
      ${j.photos ? `<div class="photo-step">
        <b>📷 Último paso: mandanos las fotos</b>
        <span>Para completar la venta necesitamos fotos de <b>cada carta, frente y dorso</b>${j.photos.email ? `, enviadas a <b>${esc(j.photos.email)}</b> con el asunto <b>"${esc(j.photos.subject)}"</b>` : ''}.</span>
        ${j.photos.mailed ? '<span class="hint">También te mandamos un mail: podés responderlo adjuntando las fotos.</span>' : ''}
        ${j.photos.mailto ? `<a class="btn primary" href="${esc(j.photos.mailto)}">Enviar fotos por mail</a>` : ''}
      </div>` : ''}
      ${j.problems?.length ? `<p class="hint">No incluimos: ${esc(j.problems.join('; '))}</p>` : ''}
      ${j.whatsappUrl ? `<a class="btn wa" href="${esc(j.whatsappUrl)}" target="_blank" rel="noopener">Coordinar por WhatsApp</a>` : ''}
      <button class="btn" type="button" id="goSales">Ver mis ventas</button>
    </div>`);
    $('#goSales').addEventListener('click', openMySales);
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Enviar solicitud de venta'; }
}

init();
