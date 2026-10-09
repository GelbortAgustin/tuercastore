// Tuerca Store — panel de administración
let token = store.get('tuerca-admin', null);
let cfg = null;
let inv = [];
let search = { q: '', prints: false, page: 1 };

async function api(path, opts = {}) {
  const r = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token || '', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (r.status === 401 && path !== '/login') { logout(); throw new Error('Sesión vencida'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------------------------------------------------------------- sesión
$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const j = await api('/login', { method: 'POST', body: { password: e.target.password.value } });
    token = j.token; store.set('tuerca-admin', token);
    store.set('tuerca-default-pw', j.defaultPassword);
    store.set('tuerca-env-pw', !!j.envPassword);
    start();
  } catch (err) { toast(err.message, true); }
});
function logout() { token = null; store.del('tuerca-admin'); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#logout').addEventListener('click', logout);

async function start() {
  try { cfg = await api('/config'); } catch { return logout(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#pwAlert').classList.toggle('hidden', !store.get('tuerca-default-pw', false));
  if (store.get('tuerca-env-pw', false)) $('#pwBox').innerHTML = '<h3>Seguridad</h3><p class="hint" style="margin:0">La contraseña del panel se define en el hosting con la variable <code>ADMIN_PASSWORD</code>. Para cambiarla, modificala ahí.</p>';
  fillSelects(); loadStatus(); fillConfig(); refreshChats();
}

// ---------------------------------------------------------------- tabs
function showTab(name) {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'inventario') loadInventory();
  if (name === 'pedidos') loadOrders();
  if (name === 'config') fillConfig();
  if (name === 'clientes') loadClients();
  if (name === 'compras') loadSales();
  if (name === 'cotizar') renderQuote();
}
$$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); showTab(g.dataset.goto); } });

function fillSelects() {
  const condOpts = Object.keys(COND).map((c) => `<option value="${c}">${c} — ${COND[c]}</option>`).join('');
  const langOpts = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#importCond').innerHTML = condOpts; $('#importLang').innerHTML = langOpts;
}

async function loadStatus() {
  try {
    const s = await api('/estado');
    const ckDate = s.ck.updatedAt ? new Date(s.ck.updatedAt).toLocaleString('es-AR') : '—';
    $('#status').innerHTML = `
      <div class="s"><small>Cartas en stock</small><b>${s.inventory.cards.toLocaleString('es-AR')}</b><span class="sub">${s.inventory.items} publicaciones</span></div>
      <div class="s"><small>Valor del stock</small><b>${money(s.inventory.value, s.currency)}</b><span class="sub">${s.inventory.noPrice ? `${s.inventory.noPrice} sin precio` : 'todas con precio'}</span></div>
      <div class="s"><small>Pedidos pendientes</small><b>${s.orders.pending}</b><span class="sub"><a href="#" data-goto="pedidos">ver pedidos</a></span></div>
      <div class="s"><small>Compras abiertas</small><b>${s.sales?.pending || 0}</b><span class="sub"><a href="#" data-goto="compras">ver compras</a> · crédito emitido ${money(s.creditTotal || 0, s.currency)}</span></div>
      <div class="s"><small>Clientes registrados</small><b>${(s.users || 0).toLocaleString('es-AR')}</b><span class="sub"><a href="#" data-goto="clientes">ver clientes</a></span></div>
      <div class="s"><small>Precios Card Kingdom</small><b>${s.ck.loading ? 'Cargando…' : s.ck.count.toLocaleString('es-AR')}</b><span class="sub">${s.ck.error ? `<span style="color:var(--bad)">${esc(s.ck.error)}</span>` : `actualizado ${ckDate}`}</span></div>`;
    $('#pendingPill').textContent = s.orders.pending; $('#pendingPill').classList.toggle('hidden', !s.orders.pending);
    $('#salesPill').textContent = s.sales?.pending || 0; $('#salesPill').classList.toggle('hidden', !s.sales?.pending);
    $('#wishPill').textContent = s.wishlist?.pending || 0; $('#wishPill').classList.toggle('hidden', !s.wishlist?.pending);
    $('#ckInfo').innerHTML = s.ck.error ? `<span style="color:var(--bad)">${esc(s.ck.error)}</span>` : `${s.ck.count.toLocaleString('es-AR')} precios · ${ckDate}`;
    const lg = s.legal || {};
    $('#legalInfo').innerHTML = lg.running ? 'Actualizando…' : lg.error ? `<span style="color:var(--bad)">${esc(lg.error)}</span>`
      : lg.updatedAt ? `Actualizado ${new Date(lg.updatedAt).toLocaleString('es-AR')}` : 'Todavía sin datos';
    if (s.ck.loading || lg.running) setTimeout(loadStatus, 4000);
  } catch {}
}

// precio estimado (misma fórmula que el servidor)
function estimate(usdValue) {
  if (!usdValue || !cfg) return null;
  let v = usdValue * (1 + (Number(cfg.markupPercent) || 0) / 100);
  if (cfg.currency === 'ARS') v *= Number(cfg.dollarRate) || 0;
  const step = Number(cfg.roundTo) || 0;
  v = step > 0 ? Math.ceil(v / step) * step : Math.round(v * 100) / 100;
  return Math.max(v, Number(cfg.minPrice) || 0);
}

// ---------------------------------------------------------------- agregar
const acList = debounce(async (q) => {
  if (q.length < 2 || /[:!"]/.test(q)) return;
  try { const names = await api('/scryfall/autocompletar?q=' + encodeURIComponent(q)); $('#ac').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join(''); } catch {}
}, 250);
$('#searchForm [name=q]').addEventListener('input', (e) => acList(e.target.value.trim()));

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  search = { q: e.target.q.value.trim(), prints: e.target.prints.checked, page: 1 };
  runSearch(false);
});
$('#searchMore').addEventListener('click', () => { search.page++; runSearch(true); });

async function runSearch(append) {
  if (!append) { $('#results').innerHTML = '<div class="spinner"></div>'; $('#searchInfo').textContent = ''; }
  try {
    const j = await api(`/scryfall/buscar?q=${encodeURIComponent(search.q)}&prints=${search.prints ? 1 : 0}&page=${search.page}`);
    const html = j.cards.map(resultHtml).join('');
    if (append) $('#results').insertAdjacentHTML('beforeend', html); else $('#results').innerHTML = html;
    $('#searchInfo').textContent = j.total ? `${j.total.toLocaleString('es-AR')} carta${j.total === 1 ? '' : 's'} encontradas` : 'Sin resultados en Scryfall.';
    $('#searchMore').classList.toggle('hidden', !j.hasMore);
  } catch (err) { $('#results').innerHTML = ''; toast(err.message, true); }
}

// precio de referencia en USD para un acabado: Card Kingdom primero, después Scryfall
function refFor(card, finish) {
  const e = card.ck?.[finish];
  if (e?.retail) return { usd: e.retail, src: 'ck' };
  if (finish === 'nonfoil' && card.scryfall_usd) return { usd: card.scryfall_usd, src: 'scryfall' };
  if (finish === 'foil' && card.scryfall_usd_foil) return { usd: card.scryfall_usd_foil, src: 'scryfall' };
  // Scryfall sólo tiene precio de surge cuando la impresión misma es surge
  if (finish === 'surge' && card.surgePrint && card.scryfall_usd_foil) return { usd: card.scryfall_usd_foil, src: 'scryfall' };
  return { usd: null, src: null };
}

function ckBox(card, finish) {
  const r = refFor(card, finish);
  const label = FINISH[finish];
  const cls = finish === 'surge' ? ' class="surge-box"' : '';
  if (r.src === 'ck') return `<div${cls}>${label}<b>${usd(r.usd)}</b><span class="muted">→ ${money(estimate(r.usd), cfg.currency)}</span></div>`;
  if (r.src === 'scryfall') return `<div${cls}>${label}<b style="color:var(--warn)">${usd(r.usd)}</b><span class="muted">sin CK · Scryfall</span></div>`;
  return `<div${cls}>${label}<b style="color:var(--faint)">—</b><span class="muted">sin precio</span></div>`;
}

function resultHtml(c) {
  const opts = c.finishOptions?.length ? c.finishOptions : ['nonfoil'];
  const finOpts = opts.map((f) => `<option value="${f}">${FINISH[f]}</option>`).join('');
  const data = esc(JSON.stringify({ id: c.scryfall_id }));
  return `<div class="res" data-card='${data}'>
    <img src="${esc(c.image || '/logo.svg')}" alt="${esc(c.name)}" loading="lazy">
    <div class="n">${esc(c.name)}</div>
    <div class="m">${setIcon(c.set, c.rarity)}<span>${esc(c.set_name)} · ${esc(c.set.toUpperCase())} #${esc(c.collector_number)} ${c.lang !== 'en' ? `<span class="badge">${esc(c.lang.toUpperCase())}</span>` : ''}</span></div>
    ${c.surgePrint ? '<div class="m"><span class="badge surge">SURGE FOIL</span> impresión surge</div>' : ''}
    <div class="ckp${opts.length > 2 ? ' three' : ''}">${opts.map((f) => ckBox(c, f)).join('')}</div>
    <div class="f">
      <select class="input" data-f="finish" aria-label="Acabado">${finOpts}</select>
      <select class="input" data-f="condition" aria-label="Condición">${Object.keys(COND).map((k) => `<option>${k}</option>`).join('')}</select>
      <select class="input" data-f="lang" aria-label="Idioma">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === c.lang ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="input" data-f="qty" type="number" min="1" value="1" aria-label="Cantidad">
    </div>
    <div class="act-row">
      <button class="btn primary sm" data-act="add">+ Agregar al stock</button>
      ${!search.prints ? `<button class="btn sm" data-act="prints" data-name="${esc(c.name)}" title="Ver todas las ediciones">Ediciones</button>` : ''}
    </div>
  </div>`;
}

$('#results').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const box = btn.closest('.res');
  if (btn.dataset.act === 'prints') {
    const name = btn.dataset.name;
    $('#searchForm').q.value = `!"${name}"`; $('#searchForm').prints.checked = true;
    search = { q: `!"${name}"`, prints: true, page: 1 };
    return runSearch(false);
  }
  const { id } = JSON.parse(box.dataset.card);
  const val = (f) => $(`[data-f=${f}]`, box).value;
  btn.disabled = true;
  try {
    const j = await api('/inventario', { method: 'POST', body: { scryfall_id: id, finish: val('finish'), condition: val('condition'), lang: val('lang'), qty: Number(val('qty')) || 1 } });
    toast(`${j.merged ? 'Sumado' : 'Agregado'}: ${j.item.name} (${j.item.qty} en stock) · ${j.item.price != null ? money(j.item.price, cfg.currency) : 'sin precio'}`);
    loadStatus();
  } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- importar
// filas de la previsualización: se pueden corregir (edición, acabado, cantidad) antes de importar
let importRows = null;

// acabado que queda al pasar una fila a otra impresión
function fitFinish(card, f) {
  const o = card.finishOptions || [];
  if (f === 'foil' && card.surgePrint) f = 'surge';
  if (!o.length || o.includes(f)) return f;
  return f !== 'nonfoil' && o.includes('foil') ? 'foil' : o[0];
}

function renderImport() {
  const ok = importRows.filter((r) => r.card).length;
  $('#importResult').innerHTML = `<p class="muted">${ok} de ${importRows.length} líneas reconocidas. Podés corregir la edición, el acabado y la cantidad de cada carta antes de importar (cantidad 0 = no se importa).</p>
    <div class="table-scroll"><table class="t"><thead><tr><th></th><th>Línea</th><th>Carta encontrada</th><th>Acabado</th><th>Cant.</th><th>Ref. USD</th><th>Precio venta c/u</th></tr></thead><tbody>
    ${importRows.map((r, i) => {
      if (!r.card) return `<tr><td></td><td>${esc(r.raw)}</td><td colspan="5" style="color:var(--bad)">No encontrada en Scryfall</td></tr>`;
      const rf = refFor(r.card, r.finish); const ref = rf.usd;
      const opts = r.card.finishOptions?.length ? [...r.card.finishOptions] : ['nonfoil'];
      if (!opts.includes(r.finish)) opts.push(r.finish);
      return `<tr data-i="${i}"><td><img class="th" src="${esc(r.card.image_small || r.card.image)}" alt=""></td><td>${esc(r.raw)}</td>
        <td>${esc(r.card.name)}<br><span class="muted">${setIcon(r.card.set, r.card.rarity)} ${esc(r.card.set.toUpperCase())} #${esc(r.card.collector_number)}</span>
          <button type="button" class="link-btn" data-edition title="Cambiar la edición de esta carta">✎ Cambiar edición</button></td>
        <td><select class="input" data-k="finish" aria-label="Acabado">${opts.map((f) => `<option value="${f}" ${f === r.finish ? 'selected' : ''}>${FINISH[f]}</option>`).join('')}</select></td>
        <td><input class="input" data-k="qty" type="number" min="0" value="${r.qty}" style="width:70px" aria-label="Cantidad"></td>
        <td>${usd(ref)} ${rf.src === 'scryfall' ? '<span class="src scryfall">Scryfall</span>' : rf.src ? '' : '<span class="src none">Sin precio</span>'}</td><td>${money(estimate(ref), cfg.currency)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function doImport(preview) {
  const rows = preview ? null : importRows;
  const text = $('#importText').value.trim();
  if (!rows && !text) return toast('Pegá una lista primero', true);
  const base = { condition: $('#importCond').value, lang: $('#importLang').value };
  const items = rows && rows.filter((r) => r.card && r.qty > 0).map((r) => ({ scryfall_id: r.card.scryfall_id, finish: r.finish, qty: r.qty, raw: r.raw }));
  if (rows && !items.length) return toast('No hay cartas para importar', true);
  const body = rows ? { ...base, items } : { ...base, text, finish: $('#importFinish').value, preview };
  $('#importResult').innerHTML = '<div class="spinner"></div>';
  try {
    const j = await api('/importar', { method: 'POST', body });
    if (preview) {
      importRows = j.results;
      renderImport();
    } else {
      const missing = rows ? [...rows.filter((r) => !r.card).map((r) => r.raw), ...j.missing] : j.missing;
      importRows = null;
      $('#importResult').innerHTML = `<div class="card-box"><b>Listo:</b> ${j.added} nuevas, ${j.merged} sumadas a stock existente.
        ${missing.length ? `<p style="color:var(--bad)">No encontradas (${missing.length}):</p><pre class="oracle">${esc(missing.join('\n'))}</pre>` : ''}</div>`;
      if (!missing.length) $('#importText').value = '';
      loadStatus();
    }
  } catch (err) { if (importRows) renderImport(); else $('#importResult').innerHTML = ''; toast(err.message, true); }
}
$('#importPreview').addEventListener('click', () => doImport(true));
$('#importGo').addEventListener('click', () => doImport(false));

// si cambia la lista o el acabado por defecto, la previsualización editada ya no vale
function dropImportPreview() {
  if (!importRows) return;
  importRows = null;
  $('#importResult').innerHTML = '<p class="muted">Cambiaste la lista: volvé a previsualizar para editar las cartas.</p>';
}
$('#importText').addEventListener('input', dropImportPreview);
$('#importFinish').addEventListener('change', dropImportPreview);

$('#importResult').addEventListener('change', (e) => {
  const el = e.target.closest('[data-k]'); if (!el || !importRows) return;
  const r = importRows[el.closest('tr').dataset.i];
  if (el.dataset.k === 'finish') { r.finish = el.value; renderImport(); }
  else { r.qty = Math.max(0, parseInt(el.value, 10) || 0); el.value = r.qty; }
});
$('#importResult').addEventListener('click', (e) => {
  if (!e.target.closest('[data-edition]') || !importRows) return;
  const r = importRows[e.target.closest('tr').dataset.i];
  openEditions({ ...r.card, finish: r.finish, condition: $('#importCond').value, qty: r.qty }, (card) => {
    r.card = card; r.finish = fitFinish(card, r.finish);
    renderImport();
    toast(`Edición cambiada a ${card.set.toUpperCase()} #${card.collector_number}`);
  });
});

// ---------------------------------------------------------------- inventario
async function loadInventory() {
  $('#invBody').innerHTML = '<tr><td colspan="10"><div class="spinner"></div></td></tr>';
  try { inv = await api('/inventario'); renderInventory(); } catch (err) { toast(err.message, true); }
}

function renderInventory() {
  const f = $('#invFilter').value.trim().toLowerCase();
  const show = $('#invShow').value;
  const list = inv.filter((i) => {
    if (show === 'stock' && i.qty <= 0) return false;
    if (show === 'nostock' && i.qty > 0) return false;
    if (show === 'noprice' && i.price != null) return false;
    if (f && !`${i.name} ${i.set} ${i.set_name}`.toLowerCase().includes(f)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { $('#invBody').innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:30px">No hay cartas para mostrar.</td></tr>'; return; }
  $('#invBody').innerHTML = list.map((i) => `<tr data-id="${i.id}">
    <td><img class="th" src="${esc(i.image_small || i.image)}" alt="" loading="lazy"></td>
    <td><b>${esc(i.name)}</b><br><span class="muted">${setIcon(i.set, i.rarity)} ${esc(i.set.toUpperCase())} #${esc(i.collector_number)}</span>
      <button type="button" class="link-btn" data-edition title="Cambiar la edición de esta carta">✎ Cambiar edición</button>${bannedIn(i)}</td>
    <td><select class="input" data-k="finish">${Object.entries(FINISH).map(([k, v]) => `<option value="${k}" ${k === finishOf(i) ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><select class="input" data-k="condition">${Object.keys(COND).map((c) => `<option ${c === i.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><select class="input" data-k="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === i.lang ? 'selected' : ''}>${k.toUpperCase()}</option>`).join('')}</select></td>
    <td><input class="input" data-k="qty" type="number" min="0" value="${i.qty}" style="width:70px"></td>
    <td>${usd(i.usd)} <span class="src ${i.source || 'none'}">${i.source === 'cardkingdom' ? 'CK' : i.source === 'scryfall' ? 'Scryfall' : i.source === 'manual' ? 'Manual' : 'Sin precio'}</span>
      ${i.ckUrl ? `<a href="${esc(i.ckUrl)}" target="_blank" rel="noopener" title="Ver en Card Kingdom">↗</a>` : ''}</td>
    <td><input class="input" data-k="priceOverride" type="number" min="0" step="any" value="${i.priceOverride ?? ''}" placeholder="auto" style="width:100px"></td>
    <td><b class="price" style="font-size:1rem">${money(i.price, cfg.currency)}</b></td>
    <td><button class="btn ghost sm danger" data-del title="Eliminar">✕</button></td>
  </tr>`).join('');
}
function bannedIn(i) {
  const leg = i.legalities || {};
  const b = Object.keys(FORMATS).filter((f) => leg[f] === 'banned').map((f) => FORMATS[f]);
  return b.length ? `<br><span style="color:var(--bad);font-size:.74rem">⚠ Baneada en: ${esc(b.join(', '))}</span>` : '';
}
$('#invFilter').addEventListener('input', debounce(renderInventory, 150));
$('#invShow').addEventListener('change', renderInventory);

$('#invBody').addEventListener('change', async (e) => {
  const el = e.target.closest('[data-k]'); if (!el) return;
  const tr = el.closest('tr'); const id = tr.dataset.id;
  let value = el.value;
  try {
    const upd = await api(`/inventario/${id}`, { method: 'PATCH', body: { [el.dataset.k]: value } });
    const idx = inv.findIndex((x) => x.id === id);
    inv[idx] = { ...inv[idx], ...upd };
    renderInventory(); loadStatus();
    toast('Guardado');
  } catch (err) { toast(err.message, true); }
});
// ---- cambiar la edición de una carta en stock
// con onPick (importar lista) no toca el stock: devuelve la impresión elegida
let editionFor = null, editionPick = null, editionCards = [];
async function openEditions(item, onPick = null) {
  editionFor = item; editionPick = onPick; editionCards = [];
  $('#edTitle').textContent = item.name;
  $('#edSub').textContent = `Ahora: ${item.set_name} (${item.set.toUpperCase()} #${item.collector_number}) · ${FINISH[finishOf(item)]} · ${item.condition} · ${item.qty} ${onPick ? 'a importar' : 'en stock'}`;
  $('#edList').innerHTML = '<div class="spinner"></div>';
  $('#editions').classList.remove('hidden'); $('#edClose').focus();
  try {
    const { cards } = await api(`/scryfall/ediciones?name=${encodeURIComponent(item.name)}`);
    if (editionFor !== item) return;
    if (!cards.length) { $('#edList').innerHTML = '<div class="empty">No encontré otras ediciones de esta carta.</div>'; return; }
    editionCards = cards;
    const f = finishOf(item);
    $('#edList').innerHTML = cards.map((c) => {
      const cur = c.scryfall_id === item.scryfall_id;
      const prices = c.finishOptions.map((k) => `${FINISH[k]}: ${c.ck?.[k]?.retail != null ? usd(c.ck[k].retail) : 'sin precio CK'}`).join(' · ');
      const will = c.finishOptions.includes(f) ? f : (f !== 'nonfoil' && c.finishOptions.includes('foil') ? 'foil' : c.finishOptions[0]);
      return `<button type="button" class="ed ${cur ? 'cur' : ''}" data-sid="${esc(c.scryfall_id)}" ${cur ? 'disabled' : ''}>
        <img src="${esc(c.image_small || c.image || '')}" alt="" loading="lazy">
        <span class="ed-t"><b>${setIcon(c.set, c.rarity)} ${esc(c.set_name)}</b>
          <span class="muted">${esc(c.set.toUpperCase())} #${esc(c.collector_number)} · ${esc((c.released_at || '').slice(0, 4))}${c.lang && c.lang !== 'en' ? ' · ' + esc(c.lang.toUpperCase()) : ''}</span>
          <span class="muted">${esc(prices)}</span>
          ${cur ? '<span class="badge">EDICIÓN ACTUAL</span>' : will && will !== f ? `<span class="ed-warn">No existe en ${esc(FINISH[f])}: quedará como ${esc(FINISH[will])}</span>` : ''}</span>
      </button>`;
    }).join('');
  } catch (err) { $('#edList').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}
function closeEditions() { $('#editions').classList.add('hidden'); editionFor = null; editionPick = null; }
$('#editions').addEventListener('click', async (e) => {
  if (e.target.id === 'editions' || e.target.closest('#edClose')) return closeEditions();
  const b = e.target.closest('[data-sid]'); if (!b || !editionFor) return;
  if (editionPick) {
    const card = editionCards.find((c) => c.scryfall_id === b.dataset.sid), pick = editionPick;
    closeEditions();
    if (card) pick(card);
    return;
  }
  const item = editionFor;
  $$('#edList .ed').forEach((x) => { x.disabled = true; });
  try {
    const upd = await api(`/inventario/${item.id}`, { method: 'PATCH', body: { scryfall_id: b.dataset.sid } });
    closeEditions();
    toast(upd.merged ? `Edición cambiada a ${upd.set.toUpperCase()} #${upd.collector_number}: se sumó al stock que ya tenías de esa edición` : `Edición cambiada a ${upd.set.toUpperCase()} #${upd.collector_number}`);
    await loadInventory(); loadStatus();
  } catch (err) { toast(err.message, true); $$('#edList .ed:not(.cur)').forEach((x) => { x.disabled = false; }); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#editions').classList.contains('hidden')) closeEditions(); });

$('#invBody').addEventListener('click', async (e) => {
  if (e.target.closest('[data-edition]')) return openEditions(inv.find((x) => x.id === e.target.closest('tr').dataset.id));
  if (!e.target.closest('[data-del]')) return;
  const tr = e.target.closest('tr'); const item = inv.find((x) => x.id === tr.dataset.id);
  const btn = e.target.closest('[data-del]');
  if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = '¿Borrar?'; setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '✕'; }, 2500); return; }
  try { await api(`/inventario/${item.id}`, { method: 'DELETE' }); inv = inv.filter((x) => x.id !== item.id); renderInventory(); loadStatus(); toast(`Eliminada: ${item.name}`); }
  catch (err) { toast(err.message, true); }
});
$('#exportCsv').addEventListener('click', async () => {
  const r = await fetch('/api/admin/exportar', { headers: { 'x-admin-token': token } });
  if (!r.ok) return toast('No se pudo exportar', true);
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `tuerca-inventario-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------- pedidos
// tablero: una columna por etapa; cada pedido se puede minimizar o agrandar
const ORDER_COLS = [
  { k: 'pendiente', t: 'Nuevo pedido', st: ['pendiente'] },
  { k: 'preparando', t: 'En preparación', st: ['preparando'] },
  { k: 'preparado', t: 'Preparado', st: ['preparado'] },
  { k: 'pagado', t: 'Pagado', st: ['pagado'] },
  { k: 'entregado', t: 'Entregado / Cancelado', st: ['entregado', 'cancelado'] },
];
const ADMIN_ST = { pendiente: 'Nuevo pedido', preparando: 'En preparación', preparado: 'Preparado', pagado: 'Pagado', entregado: 'Entregado', cancelado: 'Cancelado' };
const NEXT_ST = { pendiente: ['preparando', 'Empezar a preparar'], preparando: ['preparado', '✔ Marcar preparado'], preparado: ['pagado', 'Marcar pagado'], pagado: ['entregado', 'Marcar entregado'] };
const openOrders = new Set(store.get('tuerca-orders-open', [])); // pedidos agrandados (se recuerda en este navegador)
const saveOpenOrders = () => store.set('tuerca-orders-open', [...openOrders]);
let popId = null; // pedido abierto en ventana emergente
function orderCard(o) {
  const n = o.items.reduce((s, i) => s + i.qty, 0), open = openOrders.has(o.id), next = NEXT_ST[o.status];
  const cap = (i) => `${i.qty}× ${i.name} · ${i.set.toUpperCase()} #${i.collector_number} · ${i.condition}${finishOf(i) !== 'nonfoil' ? ' · ' + FINISH[finishOf(i)] : ''}`;
  return `<article class="order ${open ? '' : 'min'} ${o.status === 'cancelado' ? 'cancelled' : ''} ${popId === o.id ? 'pop' : ''}" data-id="${o.id}" data-st="${o.status}">
    <header draggable="true">
      <div class="ord-toggle" title="Clic para agrandar o minimizar · arrastrá para cambiar de columna">
        <button type="button" class="chev-btn" data-toggle aria-expanded="${open}" aria-label="${open ? 'Minimizar' : 'Agrandar'} el pedido #${o.number}"><span class="chev">▸</span></button>
        <span class="ord-h"><button type="button" class="ord-id" data-pop title="Abrir el pedido en una ventana">Pedido #${o.number}</button>
          ${o.status === 'cancelado' ? '<span class="tag-cancel">CANCELADO</span>' : o.status === 'entregado' ? '<span class="tag-done">ENTREGADO</span>' : ''}
          <span class="pop-st st-${o.status}">● ${ADMIN_ST[o.status]}</span>
          <span class="nbadge ${o.unread ? '' : 'hidden'}" data-unread-h title="Mensajes sin leer">${o.unread || ''}</span></span>
        <b class="price">${money(o.total, o.currency)}</b>
        <button type="button" class="btn ghost sm pop-x" data-unpop aria-label="Cerrar la ventana">✕</button></div>
      <div class="ord-sub muted">${esc(o.customer.name)} · ${new Date(o.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${n} carta${n === 1 ? '' : 's'}</div>
    </header>
    <div class="ord-strip" aria-hidden="true">${o.items.slice(0, 7).map((i) => i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy">` : '').join('')}${o.items.length > 7 ? `<span>+${o.items.length - 7}</span>` : ''}</div>
    <div class="ord-body">
      <div class="order-actions">
        ${next ? `<button type="button" class="btn primary sm" data-next="${next[0]}">${next[1]}</button>` : ''}
        <select class="input" data-status aria-label="Estado del pedido">${Object.keys(ADMIN_ST).map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${ADMIN_ST[s]}</option>`).join('')}</select>
        ${o.customer.phone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(o.customer.phone))}">WhatsApp</a>` : ''}
      </div>
      <div class="muted ord-meta">${new Date(o.created_at).toLocaleString('es-AR')}${o.customer.phone ? ` · ${esc(o.customer.phone)}` : ''}</div>
      <div class="order-cards">${o.items.map((i) => `<div class="oc">
        <button type="button" class="oc-img" data-zoom="${esc(i.image_large || i.image || '')}" data-caption="${esc(cap(i))}" aria-label="Ver ${esc(i.name)}" ${i.image ? '' : 'disabled'}>
          ${i.image ? `<span class="fx-card ${finishOf(i) === 'surge' ? 'surge' : finishOf(i) === 'foil' ? 'foil' : ''}"><img src="${esc(i.image)}" alt="" loading="lazy">${finishOf(i) === 'surge' ? '<span class="fx-sparkle"></span>' : ''}</span>` : '<span class="oc-noimg">Sin imagen</span>'}
          ${i.qty > 1 ? `<span class="oc-qty">×${i.qty}</span>` : ''}
        </button>
        <div class="oc-n">${esc(i.name)}</div>
        <div class="oc-m">${esc(i.set.toUpperCase())} #${esc(i.collector_number)} · ${esc(i.condition)} ${finishBadge(i)}</div>
        <div class="oc-p">${i.qty}× ${money(i.price, o.currency)} = <b>${money(i.price * i.qty, o.currency)}</b></div>
      </div>`).join('')}</div>
      ${o.creditUsed ? `<div class="muted" style="margin-top:6px">Crédito de tienda usado: −${money(o.creditUsed, o.currency)} · <b>A pagar: ${money(o.toPay, o.currency)}</b></div>` : ''}
      ${o.customer.note ? `<div class="oracle">${esc(o.customer.note)}</div>` : ''}
      ${o.status === 'cancelado' ? '<div class="cancel-banner">✕ Pedido cancelado: el stock volvió al inventario.</div>' : ''}
      ${o.status === 'preparado' ? `<div class="ready-banner">✔ <span>Preparado${o.readyAt ? ' el ' + new Date(o.readyAt).toLocaleString('es-AR') : ''}.<small>${o.userId ? (o.readySeen ? 'El cliente ya vio el aviso en su perfil.' : 'El cliente todavía no vio el aviso en su perfil.') : 'Pidió sin cuenta: avisale por WhatsApp.'}</small></span></div>` : ''}
      ${o.userId ? `<details class="chat" ${openChats.has(o.id) ? 'open' : ''}>
        <summary>💬 Chat con el cliente <span class="nbadge ${o.unread ? '' : 'hidden'}" data-unread>${o.unread || ''}</span><span class="muted" data-count>${o.messages.length ? `${o.messages.length} mensaje${o.messages.length > 1 ? 's' : ''}` : ''}</span></summary>
        <div class="chat-log" data-log></div>
        <form class="chat-form" data-send><input class="input" name="text" maxlength="1000" placeholder="Mensaje para el cliente…" autocomplete="off" required aria-label="Mensaje"><button class="btn primary sm">Enviar</button></form>
      </details>` : '<p class="hint" style="margin:8px 0 0">Pedido hecho sin cuenta: no tiene chat ni avisos en el perfil. Coordiná por WhatsApp.</p>'}
    </div>
  </article>`;
}
async function loadOrders() {
  if (!$('#ordersList .board')) $('#ordersList').innerHTML = '<div class="spinner"></div>';
  try {
    const orders = await api('/pedidos');
    if (!orders.length) { $('#ordersList').innerHTML = '<div class="empty">Todavía no hay pedidos.</div>'; return; }
    const scroll = $('#ordersList .board')?.scrollLeft || 0;
    $('#ordersList').innerHTML = `<div class="board-bar">
        <span class="muted">${orders.length} pedido${orders.length === 1 ? '' : 's'} · tocá un pedido para agrandarlo o minimizarlo</span>
        <span><button type="button" class="btn sm" data-all="open">Agrandar todos</button> <button type="button" class="btn sm" data-all="min">Minimizar todos</button></span>
      </div>
      <div class="pop-backdrop" data-unpop></div>
      <div class="board">${ORDER_COLS.map((c) => {
        const list = orders.filter((o) => c.st.includes(o.status));
        return `<section class="col col-${c.k}" data-col="${c.k}" aria-label="${c.t}">
          <h3>${c.t} <span class="col-n">${list.length}</span></h3>
          <div class="col-list">${list.map(orderCard).join('') || '<div class="col-empty">Sin pedidos</div>'}</div>
        </section>`;
      }).join('')}</div>`;
    $('#ordersList .board').scrollLeft = scroll;
    if (popId && !$('#ordersList .order.pop')) popId = null;
    $('#ordersList').classList.toggle('has-pop', !!popId);
    paintChats(orders);
  } catch (err) { toast(err.message, true); }
}
const openChats = new Set(); // chats desplegados (se mantienen al refrescar la lista)
function paintChats(orders) {
  const unread = orders.reduce((n, o) => n + (o.unread || 0), 0);
  const tab = $('[data-tab="pedidos"]');
  if (tab) { let b = $('.nbadge', tab); if (!b) { b = document.createElement('span'); b.className = 'nbadge'; b.style.marginLeft = '6px'; tab.appendChild(b); } b.textContent = unread; b.classList.toggle('hidden', !unread); }
  for (const o of orders) {
    const box = $(`.order[data-id="${o.id}"] .chat`); if (!box) continue;
    setChatLog($('[data-log]', box), o.messages, 'tienda');
    const card = box.closest('.order'), reading = box.open && (!card.classList.contains('min') || card.classList.contains('pop'));
    const n = reading ? 0 : o.unread;
    for (const b of [$('[data-unread]', box), $('[data-unread-h]', card)]) { b.textContent = n || ''; b.classList.toggle('hidden', !n); }
    $('[data-count]', box).textContent = o.messages.length ? `${o.messages.length} mensaje${o.messages.length > 1 ? 's' : ''}` : '';
    if (reading && o.unread) api(`/pedidos/${o.id}/visto`, { method: 'POST' }).catch(() => {});
  }
}
async function refreshChats() {
  if (!token || $('#app').classList.contains('hidden')) return;
  try {
    const orders = await api('/pedidos');
    const shown = $$('#ordersList .order').length;
    const visible = !$('[data-panel="pedidos"]').classList.contains('hidden');
    if (visible && shown !== orders.length && !$('#ordersList :focus')) return loadOrders(); // entró un pedido nuevo
    paintChats(orders);
  } catch {}
}
setInterval(refreshChats, 20000);
async function setOrderStatus(order, status) {
  try {
    const o = await api(`/pedidos/${order.dataset.id}`, { method: 'PATCH', body: { status } });
    toast(status === 'cancelado' ? 'Pedido cancelado, stock devuelto'
      : status === 'preparado' ? (o.userId ? 'Pedido preparado: el cliente ya tiene el aviso en su perfil' : 'Pedido preparado. Pidió sin cuenta: avisale por WhatsApp')
      : 'Estado actualizado');
    loadOrders(); loadStatus();
  } catch (err) { toast(err.message, true); }
}
$('#ordersList').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-status]'); if (sel) setOrderStatus(sel.closest('.order'), sel.value);
});
$('#ordersList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-next]'); if (b) { b.disabled = true; return setOrderStatus(b.closest('.order'), b.dataset.next); }
  if (e.target.closest('[data-unpop]')) return setPop(null);
  const p = e.target.closest('[data-pop]'); if (p) return setPop(p.closest('.order').dataset.id);
  const top = e.target.closest('.ord-toggle');
  if (top && !top.closest('.order').classList.contains('pop')) {
    const t = $('[data-toggle]', top);
    const card = t.closest('.order'), open = card.classList.toggle('min') === false;
    t.setAttribute('aria-expanded', open); t.setAttribute('aria-label', `${open ? 'Minimizar' : 'Agrandar'} el pedido`);
    open ? openOrders.add(card.dataset.id) : openOrders.delete(card.dataset.id); saveOpenOrders();
    if (open) { const log = $('[data-log]', card); if (log) log.scrollTop = log.scrollHeight; refreshChats(); }
    return;
  }
  const all = e.target.closest('[data-all]');
  if (all) {
    const open = all.dataset.all === 'open';
    $$('#ordersList .order').forEach((c) => { c.classList.toggle('min', !open); $('[data-toggle]', c).setAttribute('aria-expanded', open); open ? openOrders.add(c.dataset.id) : openOrders.delete(c.dataset.id); });
    saveOpenOrders(); if (open) refreshChats();
  }
});
// ventana emergente: el mismo pedido, en grande y por encima del tablero
function setPop(id) {
  popId = id;
  $$('#ordersList .order.pop').forEach((c) => c.classList.remove('pop'));
  const card = id && $(`#ordersList .order[data-id="${id}"]`);
  if (card) { card.classList.add('pop'); card.scrollTop = 0; $('[data-unpop]', card).focus(); const log = $('[data-log]', card); if (log) log.scrollTop = log.scrollHeight; refreshChats(); }
  else popId = null;
  $('#ordersList').classList.toggle('has-pop', !!popId);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popId && $('#zoom').classList.contains('hidden')) setPop(null); });
// arrastrar un pedido a otra columna cambia su estado (la última columna lo marca como entregado; cancelar se hace desde el desplegable)
let dragId = null;
$('#ordersList').addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('.order'); if (!card) return;
  if (card.classList.contains('pop')) return e.preventDefault();
  dragId = card.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); card.classList.add('dragging');
});
$('#ordersList').addEventListener('dragend', () => { dragId = null; $$('#ordersList .dragging, #ordersList .drop').forEach((x) => x.classList.remove('dragging', 'drop')); });
$('#ordersList').addEventListener('dragover', (e) => {
  const col = e.target.closest?.('.col'); if (!col || !dragId) return;
  e.preventDefault(); $$('#ordersList .drop').forEach((x) => x !== col && x.classList.remove('drop')); col.classList.add('drop');
});
$('#ordersList').addEventListener('drop', (e) => {
  const col = e.target.closest?.('.col'); if (!col || !dragId) return;
  e.preventDefault();
  const card = $(`#ordersList .order[data-id="${dragId}"]`), to = col.dataset.col;
  if (card && !ORDER_COLS.find((c) => c.k === to).st.includes(card.dataset.st)) setOrderStatus(card, to);
});
$('#ordersList').addEventListener('toggle', (e) => {
  const box = e.target.closest?.('.chat'); if (!box) return;
  const id = box.closest('.order').dataset.id;
  if (box.open) {
    openChats.add(id);
    const log = $('[data-log]', box); log.scrollTop = log.scrollHeight;
    if (!$('[data-unread]', box).classList.contains('hidden')) api(`/pedidos/${id}/visto`, { method: 'POST' }).then(refreshChats).catch(() => {});
  } else openChats.delete(id);
}, true);
$('#ordersList').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-send]'); if (!f) return;
  e.preventDefault();
  const text = f.text.value.trim(); if (!text) return;
  const btn = $('button', f); btn.disabled = true;
  try {
    const o = await api(`/pedidos/${f.closest('.order').dataset.id}/mensajes`, { method: 'POST', body: { text } });
    f.text.value = ''; setChatLog($('[data-log]', f.closest('.chat')), o.messages, 'tienda');
    $('[data-count]', f.closest('.chat')).textContent = `${o.messages.length} mensaje${o.messages.length > 1 ? 's' : ''}`;
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; f.text.focus(); }
});

// número para wa.me: si es un celular argentino sin código de país (10 dígitos), se agrega 549
function waNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '549' + d;
  return d;
}

// ---------------------------------------------------------------- clientes
let clients = [];
async function loadClients() {
  $('#cliBody').innerHTML = '<tr><td colspan="7"><div class="spinner"></div></td></tr>';
  loadWishlist();
  try { clients = await api('/clientes'); renderClients(); } catch (err) { toast(err.message, true); }
}
// wishlists: avisos de "entró en stock" para mandar por WhatsApp + cartas más buscadas
async function loadWishlist() {
  try {
    const j = await api('/wishlist');
    $('#wishBox').innerHTML = `<h3>Wishlists</h3>
      ${j.notices.length ? `<p class="hint" style="margin:0 0 8px">Entraron en stock cartas que estos clientes estaban esperando. Por mail ya se les avisó solo; por WhatsApp se manda desde acá, con el mensaje ya escrito.</p>
        <div class="mv-list">${j.notices.map((n) => `<div class="mv">
          <div><b>${esc(n.name)}</b> <span class="muted">📱 ${esc(n.whatsapp)}</span><br><small class="muted">${esc(n.cards.join(' · '))}</small></div>
          <span style="white-space:nowrap"><a class="btn wa sm" target="_blank" rel="noopener" href="${esc(n.url)}" data-wishsent="${esc(n.userId)}">Avisar por WhatsApp</a>
            <button class="btn ghost sm" data-wishsent="${esc(n.userId)}" title="Sacar de la lista sin mandar el mensaje">Descartar</button></span>
        </div>`).join('')}</div>` : '<p class="hint" style="margin:0">No hay avisos de WhatsApp pendientes.</p>'}
      ${j.wanted.length ? `<h4 style="margin:14px 0 6px">Cartas más buscadas</h4>
        <div class="wish-wanted">${j.wanted.map((w) => `<span class="badge${w.inStock ? ' in' : ''}" title="${w.inStock ? 'En stock' : 'Sin stock'}">${esc(w.name)}${w.count > 1 ? ` ×${w.count}` : ''}</span>`).join('')}</div>
        <p class="hint" style="margin:6px 0 0">En verde, las que ya tenés en stock.</p>` : '<p class="hint" style="margin:6px 0 0">Todavía ningún cliente armó su wishlist.</p>'}`;
  } catch {}
}
$('#wishBox').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-wishsent]'); if (!b) return;
  try { await api(`/wishlist/${b.dataset.wishsent}/avisado`, { method: 'POST' }); loadWishlist(); loadStatus(); } catch (err) { toast(err.message, true); }
});
function renderClients() {
  const f = $('#cliFilter').value.trim().toLowerCase();
  const list = clients.filter((c) => !f || `${c.name} ${c.contact}`.toLowerCase().includes(f))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const d = (v) => (v ? new Date(v).toLocaleDateString('es-AR') : '—');
  $('#cliBody').innerHTML = list.length ? list.map((c) => `<tr data-id="${c.id}">
    <td><b>${esc(c.name)}</b></td>
    <td>${c.type === 'phone'
      ? `📱 ${esc(c.contact)} <a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(c.contact))}">WhatsApp</a>`
      : `✉️ <a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>${c.whatsapp ? `<br>📱 ${esc(c.whatsapp)} <a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(c.whatsapp))}">WhatsApp</a>` : ''}`}${c.wishlist ? `<br><small class="muted">♡ ${c.wishlist} en su wishlist</small>` : ''}</td>
    <td>${c.verified ? '<span style="color:var(--ok)">✔ Sí</span>' : `<span style="color:var(--warn)">Pendiente</span><br><button class="btn ghost sm" data-cli="verify" title="Marcar como verificado si confirmaste por otro medio">Verificar a mano</button>`}</td>
    <td><b class="price" style="font-size:.95rem">${money(c.credit || 0, cfg?.currency)}</b><br><button class="btn ghost sm" data-cli="credit">Ver / ajustar</button></td>
    <td>${d(c.created_at)}</td><td>${d(c.last_login)}</td><td>${c.orders} / ${c.sales || 0}</td>
    <td>${c.disabled ? '<span style="color:var(--bad)">Bloqueado</span>' : '<span style="color:var(--ok)">Activo</span>'}</td>
    <td style="white-space:nowrap">
      <button class="btn sm" data-cli="pw">Nueva contraseña</button>
      <button class="btn ghost sm ${c.disabled ? '' : 'danger'}" data-cli="block">${c.disabled ? 'Desbloquear' : 'Bloquear'}</button>
    </td>
  </tr>`).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Todavía no hay clientes registrados.</td></tr>';
}
$('#cliFilter').addEventListener('input', debounce(renderClients, 150));
$('#cliBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-crsave]'); if (!b) return;
  const row = b.closest('tr');
  try {
    const j = await api(`/clientes/${b.dataset.crsave}/credito`, { method: 'POST', body: { amount: $('[data-cr=amount]', row).value, reason: $('[data-cr=reason]', row).value } });
    toast(`Nuevo saldo: ${money(j.balance, cfg.currency)}`); loadClients(); loadStatus();
  } catch (err) { toast(err.message, true); }
});
$('#cliBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cli]'); if (!b) return;
  const c = clients.find((x) => x.id === b.closest('tr').dataset.id);
  if (b.dataset.cli === 'pw') {
    const tr = b.closest('tr');
    if (tr.nextElementSibling?.classList.contains('pw-row')) return tr.nextElementSibling.remove();
    tr.insertAdjacentHTML('afterend', `<tr class="pw-row"><td colspan="9"><div class="row-form">
      <input class="input" type="text" placeholder="Nueva contraseña para ${esc(c.name)} (mín. 8)" minlength="8" style="flex:2 1 240px">
      <button class="btn primary sm" data-savepw="${c.id}">Guardar</button></div></td></tr>`);
    tr.nextElementSibling.querySelector('input').focus();
    return;
  }
  if (b.dataset.cli === 'credit') {
    const tr = b.closest('tr');
    if (tr.nextElementSibling?.classList.contains('credit-row')) return tr.nextElementSibling.remove();
    const j = await api(`/clientes/${c.id}/credito`);
    tr.insertAdjacentHTML('afterend', `<tr class="credit-row"><td colspan="9"><div style="display:grid;gap:10px">
      <div class="row-form">
        <label class="field" style="flex:1 1 140px"><span>Monto (negativo para descontar)</span><input class="input" type="number" step="any" data-cr="amount" placeholder="ej: 5000 o -2000"></label>
        <label class="field" style="flex:3 1 240px"><span>Motivo</span><input class="input" data-cr="reason" maxlength="200" placeholder="ej: premio del torneo del sábado"></label>
        <button class="btn primary sm" data-crsave="${c.id}">Aplicar ajuste</button>
      </div>
      <div class="mv-list">${j.movements.length ? j.movements.slice(0, 30).map((m) => `<div class="mv"><div><div>${esc(m.reason)}</div><small class="muted">${new Date(m.created_at).toLocaleString('es-AR')} · ${m.by === 'admin' ? 'panel' : 'automático'}</small></div>
        <b class="${m.amount >= 0 ? 'plus' : 'minus'}">${m.amount >= 0 ? '+' : '−'}${money(Math.abs(m.amount), cfg.currency)}</b></div>`).join('') : '<span class="muted">Sin movimientos.</span>'}</div>
    </div></td></tr>`);
    return;
  }
  if (b.dataset.cli === 'verify') {
    try { await api(`/clientes/${c.id}`, { method: 'PATCH', body: { verified: true } }); toast('Cliente marcado como verificado'); loadClients(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (b.dataset.cli === 'block') {
    try { await api(`/clientes/${c.id}`, { method: 'PATCH', body: { disabled: !c.disabled } }); toast(c.disabled ? 'Cliente desbloqueado' : 'Cliente bloqueado'); loadClients(); }
    catch (err) { toast(err.message, true); }
  }
});
$('#cliBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-savepw]'); if (!b) return;
  const input = b.closest('tr').querySelector('input');
  try { await api(`/clientes/${b.dataset.savepw}/clave`, { method: 'POST', body: { password: input.value } }); toast('Contraseña cambiada. Pasásela al cliente.'); b.closest('tr').remove(); }
  catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- compras (clientes que venden)
let salesData = [];
const SALE_LABEL = { pendiente: 'Pendiente', aceptada: 'Aceptada', completada: 'Completada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
async function loadSales() {
  $('#salesList').innerHTML = '<div class="spinner"></div>';
  try { salesData = await api('/ventas'); renderSales(); } catch (err) { toast(err.message, true); }
}
function renderSales() {
  const show = $('#salesShow').value;
  const list = salesData.filter((v) => show === 'all' ? true : show === 'open' ? ['pendiente', 'aceptada'].includes(v.status)
    : show === 'rechazada' ? ['rechazada', 'cancelada'].includes(v.status) : v.status === show);
  if (!list.length) { $('#salesList').innerHTML = '<div class="empty">No hay solicitudes para mostrar.</div>'; return; }
  $('#salesList').innerHTML = list.map((v) => {
    const open = ['pendiente', 'aceptada'].includes(v.status);
    const cur = v.currency || cfg.currency;
    return `<div class="order" data-sale="${v.id}">
    <header>
      <div><h3>Compra V-${v.number} <span class="st-sale-${v.status}" style="font-size:.85rem">● ${SALE_LABEL[v.status]}</span></h3>
        <span class="muted">${new Date(v.created_at).toLocaleString('es-AR')} · ${esc(v.customer.name)} · ${esc(v.customer.contact)} · saldo actual ${money(v.customer.credit, cur)}</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${open ? `<select class="input" data-payout style="width:auto"><option value="credit" ${v.payout === 'credit' ? 'selected' : ''}>Crédito de tienda</option><option value="cash" ${v.payout === 'cash' ? 'selected' : ''}>Dinero</option></select>`
          : `<span class="badge">${v.payout === 'credit' ? 'CRÉDITO' : 'DINERO'}</span>`}
        <b class="price">${money(v.total, cur)}</b>
      </div>
    </header>
    <div class="table-scroll" style="max-height:none"><table class="t"><thead><tr><th></th><th>Carta</th><th>Pidió</th><th>Acepto</th><th>$ dinero c/u</th><th>$ crédito c/u</th><th>Subtotal</th></tr></thead><tbody>
    ${v.items.map((l, i) => `<tr data-idx="${i}">
      <td><img class="th zoomable" src="${esc(l.image)}" alt="" data-zoom="${esc(l.image)}" data-caption="${esc(`${l.name} · ${l.set.toUpperCase()} #${l.collector_number} · ${l.condition}`)}"></td>
      <td><b>${esc(l.name)}</b><br><span class="muted">${esc(l.set.toUpperCase())} #${esc(l.collector_number)} · ${esc(l.condition)}${l.finish !== 'nonfoil' ? ' · ' + FINISH[l.finish].toUpperCase() : ''}${l.source === 'scryfall' ? ' · <span class="src scryfall">precio Scryfall</span>' : ''}</span></td>
      <td>${l.qty}</td>
      <td>${open ? `<input class="input" type="number" min="0" max="${l.qty}" value="${l.accepted}" data-e="accepted" style="width:64px">` : l.accepted}</td>
      <td>${open ? `<input class="input" type="number" min="0" step="any" value="${l.unitCash}" data-e="unitCash" style="width:100px">` : money(l.unitCash, cur)}</td>
      <td>${open ? `<input class="input" type="number" min="0" step="any" value="${l.unitCredit}" data-e="unitCredit" style="width:100px">` : money(l.unitCredit, cur)}</td>
      <td>${money((v.payout === 'credit' ? l.unitCredit : l.unitCash) * l.accepted, cur)}</td>
    </tr>`).join('')}</tbody></table></div>
    ${v.photosRequired ? `<div class="photo-admin ${v.photosReceived ? 'ok' : ''}">📷 ${v.photosReceived
      ? `Fotos recibidas${v.photos_at ? ` el ${new Date(v.photos_at).toLocaleString('es-AR')}` : ''}`
      : `<b>Esperando fotos</b> del cliente (asunto "Fotos solicitud V-${v.number}"). No se puede completar hasta recibirlas.`}
      ${open ? `<label class="check" style="margin-left:auto"><input type="checkbox" data-photos ${v.photosReceived ? 'checked' : ''}> Recibí las fotos</label>` : ''}</div>` : ''}
    ${v.note ? `<div class="oracle" style="margin-top:8px">Nota del cliente: ${esc(v.note)}</div>` : ''}
    <div class="row-form" style="margin-top:10px">
      <input class="input" data-adminnote placeholder="Nota para el cliente (se ve en 'Mis ventas')" value="${esc(v.adminNote || '')}" style="flex:3 1 260px">
      ${open ? `
        ${v.status === 'pendiente' ? '<button class="btn sm" data-sact="aceptada">Aceptar</button>' : ''}
        <label class="check" style="flex:0 0 auto"><input type="checkbox" data-addstock checked> Sumar las cartas al stock</label>
        <button class="btn primary sm" data-sact="completada" ${v.photosRequired && !v.photosReceived ? 'disabled title="Primero marcá que recibiste las fotos"' : ''}>Completar (${v.payout === 'credit' ? 'acreditar' : 'pagado'})</button>
        <button class="btn ghost sm danger" data-sact="rechazada">Rechazar</button>`
      : `<button class="btn sm" data-sact="note">Guardar nota</button>${v.completed_at ? `<span class="hint">Completada ${new Date(v.completed_at).toLocaleString('es-AR')}${v.addedToStock ? ' · sumada al stock' : ''}</span>` : ''}`}
    </div>
  </div>`;
  }).join('');
}
$('#salesShow').addEventListener('change', renderSales);
async function patchSale(id, body) {
  const upd = await api(`/ventas/${id}`, { method: 'PATCH', body });
  const i = salesData.findIndex((x) => x.id === id);
  salesData[i] = { ...salesData[i], ...upd, note: salesData[i].note, customer: salesData[i].customer };
  return upd;
}
$('#salesList').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-sale]'); if (!box) return;
  try {
    if (e.target.matches('[data-e]')) {
      const tr = e.target.closest('tr');
      await patchSale(box.dataset.sale, { items: [{ idx: Number(tr.dataset.idx), [e.target.dataset.e]: e.target.value }] });
    } else if (e.target.matches('[data-payout]')) {
      await patchSale(box.dataset.sale, { payout: e.target.value });
    } else if (e.target.matches('[data-photos]')) {
      await patchSale(box.dataset.sale, { photosReceived: e.target.checked });
      toast(e.target.checked ? 'Fotos marcadas como recibidas' : 'Fotos marcadas como pendientes');
    } else return;
    renderSales();
  } catch (err) { toast(err.message, true); }
});
$('#salesList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sact]'); if (!b) return;
  const box = b.closest('[data-sale]'); const v = salesData.find((x) => x.id === box.dataset.sale);
  const act = b.dataset.sact;
  if (['completada', 'rechazada'].includes(act) && b.dataset.confirm !== '1') {
    b.dataset.confirm = '1'; const t = b.textContent; b.textContent = '¿Confirmás? Tocá de nuevo';
    setTimeout(() => { b.dataset.confirm = ''; b.textContent = t; }, 3500); return;
  }
  try {
    const body = { adminNote: $('[data-adminnote]', box).value };
    if (act !== 'note') body.status = act;
    if (act === 'completada') body.addToStock = $('[data-addstock]', box)?.checked;
    await patchSale(v.id, body);
    toast(act === 'completada' ? (v.payout === 'credit' ? `Acreditado ${money(v.total, cfg.currency)} a ${v.customer.name}` : 'Compra completada') : act === 'note' ? 'Nota guardada' : `Compra ${SALE_LABEL[act].toLowerCase()}`);
    loadSales(); loadStatus();
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- configuración
function fillConfig() {
  const f = $('#cfgForm'); if (!cfg) return;
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.name.startsWith('cf_')) el.value = cfg.conditionFactors?.[el.name.slice(3)] ?? '';
    else if (el.type === 'checkbox') el.checked = !!cfg[el.name];
    else if (el.name !== 'newPassword') el.value = cfg[el.name] ?? '';
  }
  fillVerify();
  if (cfg.dollarUpdatedAt) $('#dollarInfo').textContent = `Fuente: dolarapi.com · última actualización ${new Date(cfg.dollarUpdatedAt).toLocaleString('es-AR')}`;
}
function fillVerify() {
  const v = cfg.verify || {}, f = $('#cfgForm');
  const st = v.status || {};
  const label = { ok: '<span style="color:var(--ok)">✔ Activo</span>', prueba: '<span style="color:var(--warn)">Modo prueba</span>', off: '<span style="color:var(--bad)">Desactivado</span>' };
  $('#verifyStatus').innerHTML = `Estado: ${label[st.email] || '—'}${v.fromEnv?.smtp ? ' <span class="hint">(variables del hosting)</span>' : ''}`;
  f.v_smtp_host.value = v.smtp?.host || ''; f.v_smtp_port.value = v.smtp?.port || 465;
  f.v_smtp_user.value = v.smtp?.user || ''; f.v_smtp_from.value = v.smtp?.from || ''; f.v_smtp_pass.value = '';
  f.v_smtp_pass.placeholder = v.smtp?.passSet ? '•••••••• (guardada, cifrada)' : '';
  $('#smtpPassHint').textContent = v.smtp?.passSet ? 'Dejala vacía para no cambiarla.' : '';
}
$('#gmailPreset').addEventListener('click', () => { const f = $('#cfgForm'); f.v_smtp_host.value = 'smtp.gmail.com'; f.v_smtp_port.value = 465; f.v_smtp_user.focus(); });
$('#verifyTest').addEventListener('click', async (e) => {
  const to = $('#verifyTestTo').value.trim(); if (!to) return toast('Escribí a dónde mandar la prueba', true);
  e.target.disabled = true;
  try { const j = await api('/verificacion/probar', { method: 'POST', body: { to } }); toast(j.message); }
  catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
});

$('#cfgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const body = { conditionFactors: {} };
  body.verify = {
    smtp: { host: f.v_smtp_host.value, port: f.v_smtp_port.value, user: f.v_smtp_user.value, from: f.v_smtp_from.value, ...(f.v_smtp_pass.value ? { pass: f.v_smtp_pass.value } : {}) },
  };
  for (const el of f.elements) {
    if (!el.name || el.name.startsWith('v_')) continue;
    if (el.name.startsWith('cf_')) body.conditionFactors[el.name.slice(3)] = Number(el.value) || 0;
    else if (el.type === 'checkbox') body[el.name] = el.checked;
    else if (el.name === 'newPassword') { if (el.value) body.newPassword = el.value; }
    else body[el.name] = el.value;
  }
  try {
    cfg = await api('/config', { method: 'PUT', body });
    if (body.newPassword) { store.set('tuerca-default-pw', false); $('#pwAlert').classList.add('hidden'); f.newPassword.value = ''; }
    toast('Configuración guardada'); loadStatus();
  } catch (err) { toast(err.message, true); }
});
$('#fetchDollar').addEventListener('click', async () => {
  const tipo = $('#cfgForm').dollarType.value;
  try {
    const d = await api('/dolar?tipo=' + encodeURIComponent(tipo));
    $('#cfgForm').dollarRate.value = d.venta;
    $('#dollarInfo').textContent = `Dólar ${d.nombre}: venta $${d.venta} (compra $${d.compra ?? '—'}). Guardá para aplicar.`;
  } catch (err) { toast('No se pudo traer la cotización: ' + err.message, true); }
});
// ---- respaldo
$('#backupDownload').addEventListener('click', async () => {
  const r = await fetch('/api/admin/respaldo', { headers: { 'x-admin-token': token } });
  if (!r.ok) return toast('No se pudo descargar el respaldo', true);
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `tuerca-respaldo-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
$('#backupFile').addEventListener('change', (e) => { $('#backupRestore').disabled = !e.target.files.length; });
$('#backupRestore').addEventListener('click', async (e) => {
  const btn = e.target;
  const file = $('#backupFile').files[0]; if (!file) return;
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1'; btn.textContent = '¿Seguro? Tocá de nuevo para reemplazar todo';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Restaurar (reemplaza el inventario actual)'; }, 4000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Restaurando…';
  try {
    const data = JSON.parse(await file.text());
    const j = await api('/respaldo', { method: 'POST', body: data });
    toast(`Respaldo restaurado: ${j.inventory} cartas, ${j.orders} pedidos y ${j.users} clientes`);
    cfg = await api('/config'); fillConfig(); loadStatus();
  } catch (err) { toast(err.message.includes('JSON') ? 'El archivo no es un respaldo válido' : err.message, true); }
  finally { btn.dataset.confirm = ''; btn.textContent = 'Restaurar (reemplaza el inventario actual)'; btn.disabled = false; }
});

$('#legalRefresh').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Actualizando…';
  try { const j = await api('/legalidades/actualizar', { method: 'POST' }); toast(j.error ? j.error : 'Legalidades actualizadas', !!j.error); loadStatus(); }
  catch (err) { toast(err.message, true); }
  finally { e.target.disabled = false; e.target.textContent = 'Actualizar legalidades ahora'; }
});
$('#ckRefresh').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Descargando… (puede tardar)';
  try { const j = await api('/ck/actualizar', { method: 'POST' }); toast(j.error ? j.error : `${j.count.toLocaleString('es-AR')} precios actualizados`, !!j.error); loadStatus(); }
  catch (err) { toast(err.message, true); }
  finally { e.target.disabled = false; e.target.textContent = 'Actualizar precios ahora'; }
});

// ---------------------------------------------------------------- cotizar cartas (cuánto pagamos en dinero y en crédito)
let quoteRows = [], quoteInfo = { cashPercent: 50, creditPercent: 75, minOffer: 0, currency: 'ARS' };
const quoteOf = (r) => r.quotes?.[r.finish]?.[r.condition] || null;
function paintQuotePct() {
  quoteInfo.cashPercent = Number(cfg?.buyCashPercent ?? quoteInfo.cashPercent); quoteInfo.creditPercent = Number(cfg?.buyCreditPercent ?? quoteInfo.creditPercent);
  quoteInfo.currency = cfg?.currency || quoteInfo.currency;
  $('#qCashPct').textContent = `${quoteInfo.cashPercent}%`; $('#qCreditPct').textContent = `${quoteInfo.creditPercent}%`;
  $('#qThCash').textContent = `Dinero ${quoteInfo.cashPercent}%`; $('#qThCredit').textContent = `Crédito ${quoteInfo.creditPercent}%`;
  if (!$('#quoteCond').options.length) $('#quoteCond').innerHTML = Object.keys(COND).map((c) => `<option value="${c}">${c} — ${COND[c]}</option>`).join('');
}
function renderQuote() {
  paintQuotePct();
  const cur = quoteInfo.currency;
  let n = 0, sale = 0, cash = 0, credit = 0;
  $('#quoteBody').innerHTML = quoteRows.map((r, i) => {
    const q = quoteOf(r);
    if (q) { n += r.qty; sale += q.sale * r.qty; cash += q.cash * r.qty; credit += q.credit * r.qty; }
    return `<tr data-i="${i}">
      <td><img class="th zoomable" src="${esc(r.image_small || r.image || '')}" alt="" loading="lazy" data-zoom="${esc(r.image || r.image_small || '')}" data-caption="${esc(`${r.name} · ${r.set.toUpperCase()} #${r.collector_number}`)}"></td>
      <td><b>${esc(r.name)}</b><br><span class="muted">${setIcon(r.set, r.rarity)} ${esc(r.set_name)} · ${esc(r.set.toUpperCase())} #${esc(r.collector_number)}</span></td>
      <td><select class="input" data-q="finish">${r.finishOptions.map((f) => `<option value="${f}" ${f === r.finish ? 'selected' : ''}>${FINISH[f]}</option>`).join('')}</select></td>
      <td><select class="input" data-q="condition">${Object.keys(COND).map((c) => `<option ${c === r.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input class="input" data-q="qty" type="number" min="1" max="99" value="${r.qty}" style="width:64px"></td>
      ${q ? `<td class="r">${money(q.sale, cur)}${r.qty > 1 ? `<small class="muted"> c/u</small>` : ''}<br><span class="src ${q.source}">${q.source === 'cardkingdom' ? 'CK' : 'Scryfall'}</span></td>
        <td class="r cash"><b>${money(q.cash * r.qty, cur)}</b>${q.belowMin ? '<br><small class="low" title="La oferta en dinero queda por debajo del mínimo de compra configurado">bajo el mínimo</small>' : ''}</td>
        <td class="r credit"><b>${money(q.credit * r.qty, cur)}</b></td>`
        : '<td class="r muted" colspan="3">Sin precio de referencia para este acabado</td>'}
      <td><button class="btn ghost sm danger" data-qdel title="Quitar" aria-label="Quitar ${esc(r.name)}">✕</button></td>
    </tr>`;
  }).join('');
  $('#quoteBox').classList.toggle('hidden', !quoteRows.length);
  $('#qN').textContent = n ? `${n} carta${n === 1 ? '' : 's'}` : '';
  $('#qSale').textContent = money(sale, cur); $('#qCash').textContent = money(cash, cur); $('#qCredit').textContent = money(credit, cur);
  $('#qCashTot').textContent = money(cash, cur); $('#qCreditTot').textContent = money(credit, cur);
  return { n, sale, cash, credit };
}
$('#quoteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, text = f.text.value.trim();
  if (!text) return toast('Escribí o pegá las cartas a cotizar', true);
  const btn = $('#quoteBtn'); btn.disabled = true; btn.textContent = 'Cotizando…';
  try {
    const j = await api('/cotizar', { method: 'POST', body: { text } });
    Object.assign(quoteInfo, { cashPercent: j.cashPercent, creditPercent: j.creditPercent, minOffer: j.minOffer, currency: j.currency });
    if (cfg) { cfg.buyCashPercent = j.cashPercent; cfg.buyCreditPercent = j.creditPercent; }
    for (const c of j.cards) {
      const same = quoteRows.find((r) => r.scryfall_id === c.scryfall_id && r.finish === c.finish && r.condition === f.condition.value);
      if (same) same.qty = Math.min(99, same.qty + c.qty); else quoteRows.push({ ...c, condition: f.condition.value });
    }
    $('#quoteMsg').innerHTML = j.missing.length || j.truncated ? `<div class="alert" style="margin:10px 0">${j.missing.length ? `No encontré: <b>${esc(j.missing.join(' · '))}</b>. Revisá que el nombre esté en inglés.` : ''}${j.truncated ? ' La lista era muy larga: coticé las primeras 400 cartas distintas.' : ''}</div>` : '';
    f.text.value = ''; renderQuote(); f.text.focus();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Cotizar'; }
});
$('#quoteClear').addEventListener('click', () => { quoteRows = []; $('#quoteMsg').innerHTML = ''; renderQuote(); });
$('#quoteBody').addEventListener('change', (e) => {
  const el = e.target.closest('[data-q]'); if (!el) return;
  const r = quoteRows[el.closest('tr').dataset.i]; if (!r) return;
  r[el.dataset.q] = el.dataset.q === 'qty' ? Math.max(1, Math.min(99, parseInt(el.value, 10) || 1)) : el.value;
  renderQuote();
});
$('#quoteBody').addEventListener('click', (e) => {
  if (!e.target.closest('[data-qdel]')) return;
  quoteRows.splice(Number(e.target.closest('tr').dataset.i), 1); renderQuote();
});
$('#quoteCopy').addEventListener('click', async () => {
  const cur = quoteInfo.currency, t = renderQuote();
  const lines = quoteRows.map((r) => { const q = quoteOf(r); return `• ${r.qty}x ${r.name} (${r.set.toUpperCase()} #${r.collector_number})${r.finish !== 'nonfoil' ? ' ' + FINISH[r.finish] : ''} ${r.condition} — ${q ? `dinero ${money(q.cash * r.qty, cur)} / crédito ${money(q.credit * r.qty, cur)}` : 'sin precio'}`; });
  const text = [`Cotización ${cfg?.storeName || 'Tuerca Store'} (${t.n} cartas)`, '', ...lines, '', `Total en dinero (${quoteInfo.cashPercent}%): ${money(t.cash, cur)}`, `Total en crédito de tienda (${quoteInfo.creditPercent}%): ${money(t.credit, cur)}`, 'Valores sujetos a revisión de las cartas.'].join('\n');
  try { await navigator.clipboard.writeText(text); toast('Resumen copiado: pegalo en WhatsApp o en el chat'); }
  catch { toast('No se pudo copiar', true); }
});

// ---------------------------------------------------------------- vista previa de cartas (pedidos y compras)
function openZoom(src, caption) {
  if (!src) return;
  const box = $('#zoom');
  $('#zoomImg').src = src; $('#zoomCap').textContent = caption || '';
  box.classList.remove('hidden'); $('#zoomClose').focus();
}
function closeZoom() { $('#zoom').classList.add('hidden'); $('#zoomImg').src = ''; }
document.addEventListener('click', (e) => {
  const z = e.target.closest('[data-zoom]');
  if (z) { e.preventDefault(); return openZoom(z.dataset.zoom, z.dataset.caption); }
  if (e.target.id === 'zoom' || e.target.closest('#zoomClose')) closeZoom();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#zoom').classList.contains('hidden')) closeZoom(); });

// ---------------------------------------------------------------- inicio
if (token) start(); else $('#login').classList.remove('hidden');
