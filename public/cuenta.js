// Tuerca Store — cuenta de cliente (compartido por la tienda y "Vendé tus cartas")
// Cada página define: `state` (con user/pending/currency), `closeAll()` y opcionalmente `onAccountChange()`.
// ---------------------------------------------------------------- cuenta de cliente
async function loadAccount() {
  state.user = null; state.pending = null;
  try {
    const r = await fetch('/api/cuenta', { credentials: 'same-origin' });
    if (r.ok) { const j = await r.json(); if (j.user.verified) state.user = j.user; else state.pending = j.user; }
  } catch {}
  renderAccount();
}

function renderAccount() {
  const u = state.user;
  $('#accountLbl').textContent = u ? u.name.split(' ')[0] : state.pending ? 'Verificar cuenta' : 'Ingresar';
  $('#accountBtn').classList.toggle('logged', !!u);
  $('#accountWho').innerHTML = u ? `<b>${esc(u.name)}</b><span>${esc(u.contact)}</span>${u.credit ? `<span class="credit-pill">Crédito: ${money(u.credit, state.currency || 'ARS')}</span>` : ''}` : '';
  renderNotices();
  if (typeof onAccountChange === 'function') onAccountChange();
}

// globito de avisos: pedidos listos para retirar + mensajes nuevos de la tienda
function renderNotices() {
  const n = state.user?.notifications || 0;
  const put = (host) => {
    if (!host) return;
    let b = $('.nbadge', host);
    if (!b) { b = document.createElement('span'); b.className = 'nbadge'; host.appendChild(b); }
    b.textContent = n; b.classList.toggle('hidden', !n);
  };
  put($('#accountBtn')); put($('[data-acc="pedidos"]'));
  $('#accountBtn').title = n ? `Tenés ${n} novedad${n > 1 ? 'es' : ''} en tus pedidos` : '';
}
async function refreshNotices() {
  if (!state.user) return;
  try {
    const r = await fetch('/api/cuenta', { credentials: 'same-origin' });
    if (!r.ok) return;
    const j = await r.json(), before = state.user.notifications || 0;
    state.user.notifications = j.user.notifications || 0;
    renderNotices();
    if (state.user.notifications > before) toast('Tenés novedades en tus pedidos');
  } catch {}
}
setInterval(refreshNotices, 45000);

function bindAccount() {
  $('#accountBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.pending) return openVerify({ sentTo: state.pending.contact, via: state.pending.contactType === 'email' ? 'tu mail' : 'SMS' });
    if (!state.user) return openAuth('ingresar');
    $('#accountMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', () => $('#accountMenu').classList.add('hidden'));
  $('#accountMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    $('#accountMenu').classList.add('hidden');
    if (b.dataset.acc === 'salir') {
      await fetch('/api/cuenta/salir', { method: 'POST' });
      state.user = null; state.pending = null; renderAccount(); toast('Cerraste sesión');
    }
    if (b.dataset.acc === 'pedidos') openMyOrders();
    if (b.dataset.acc === 'wishlist') openWishlist();
    if (b.dataset.acc === 'credito') openMyCredit();
    if (b.dataset.acc === 'ventas') openMySales();
    if (b.dataset.acc === 'clave') openChangePassword();
  });
}

function showModal(html, narrow = true) {
  $('#modal').classList.toggle('narrow', narrow);
  $('#modalBody').innerHTML = html;
  $('#modal').classList.add('open'); $('#overlay').classList.add('open');
}

function openAuth(mode = 'ingresar', after) {
  const reg = mode === 'registro';
  showModal(`<div class="auth">
    <img src="/logo.svg" alt="" class="auth-logo">
    <div class="auth-tabs" role="tablist">
      <button role="tab" data-mode="ingresar" aria-selected="${!reg}">Ingresar</button>
      <button role="tab" data-mode="registro" aria-selected="${reg}">Crear cuenta</button>
    </div>
    <form id="authForm" novalidate>
      <input class="hp" name="empresa" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${reg ? '<label class="field"><span>Nombre</span><input class="input" name="name" autocomplete="name" required maxlength="80"></label>' : ''}
      <label class="field"><span>Mail</span><input class="input" name="contact" type="email" autocomplete="${reg ? 'email' : 'username'}" required placeholder="tu@mail.com"></label>
      <label class="field"><span>Contraseña</span>
        <div class="pw"><input class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 8 : 1}">
        <button type="button" class="btn ghost sm" data-show aria-label="Mostrar contraseña">Ver</button></div>
        ${reg ? '<span class="hint">Mínimo 8 caracteres.</span>' : ''}
      </label>
      <div class="auth-err hidden" id="authErr" role="alert"></div>
      <button class="btn primary" type="submit">${reg ? 'Crear cuenta' : 'Ingresar'}</button>
      <p class="hint">${reg
        ? 'Te vamos a enviar un código a tu mail para confirmar que es tuyo. Tus datos se guardan cifrados.'
        : '¿Olvidaste tu contraseña? Escribinos y te la reseteamos.'}</p>
    </form>
  </div>`);
  $$('.auth-tabs [data-mode]').forEach((t) => t.addEventListener('click', () => openAuth(t.dataset.mode, after)));
  $('[data-show]').addEventListener('click', (e) => {
    const i = $('#authForm [name=password]'); i.type = i.type === 'password' ? 'text' : 'password';
    e.target.textContent = i.type === 'password' ? 'Ver' : 'Ocultar';
  });
  const form = $('#authForm');
  const openedAt = Date.now();
  form.querySelector(reg ? '[name=name]' : '[name=contact]').focus();
  if (reg) fetch('/api/cuenta/opciones').then((r) => r.json()).then((o) => {
    if (!o.email) {
      $('#authErr').textContent = 'El registro de cuentas nuevas no está disponible por el momento.';
      $('#authErr').classList.remove('hidden'); form.querySelector('[type=submit]').disabled = true;
    }
  }).catch(() => {});
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    $('#authErr').classList.add('hidden');
    try {
      const r = await fetch(`/api/cuenta/${reg ? 'registro' : 'ingresar'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), t: openedAt }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No se pudo completar');
      if (j.needsVerification) {
        state.pending = j.user; state.user = null; renderAccount();
        return openVerify(j, after);
      }
      state.user = j.user; state.pending = null; renderAccount();
      closeAll();
      toast(reg ? `¡Bienvenido/a, ${j.user.name}!` : `Hola de nuevo, ${j.user.name}`);
      if (after) after();
    } catch (err) {
      $('#authErr').textContent = err.message; $('#authErr').classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
}

// paso 2: escribir el código que llegó por mail / SMS / WhatsApp
function openVerify(info = {}, after) {
  showModal(`<div class="auth">
    <img src="/logo.svg" alt="" class="auth-logo">
    <h2 style="margin:0;text-align:center;font-family:var(--display)">Confirmá que sos vos</h2>
    <p class="muted" style="margin:0;text-align:center">Te enviamos un código de 6 dígitos a <b>${esc(info.sentTo || '')}</b>${info.via ? ` por ${esc(info.via)}` : ''}.</p>
    ${info.dev ? `<div class="auth-dev">${esc(info.dev)}</div>` : ''}
    ${info.sendError ? `<div class="auth-err">${esc(info.sendError)}</div>` : ''}
    <form id="verifyForm" novalidate>
      <input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="••••••" aria-label="Código de verificación" required>
      <div class="auth-err hidden" id="authErr" role="alert"></div>
      <button class="btn primary" type="submit">Verificar</button>
      <div class="verify-actions">
        <button type="button" class="btn ghost sm" id="resend">Reenviar código</button>
        <button type="button" class="btn ghost sm" id="changeContact">Usar otro mail</button>
      </div>
      <p class="hint">El código vence en 10 minutos.${/mail/.test(info.via || '') ? ' Revisá también la carpeta de spam.' : ''}</p>
    </form>
  </div>`);
  const form = $('#verifyForm'), code = form.code;
  code.focus();
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, ''); if (code.value.length === 6) form.requestSubmit(); });
  const showErr = (m) => { $('#authErr').textContent = m; $('#authErr').classList.remove('hidden'); };
  // cuenta regresiva para reenviar
  let timer;
  const cooldown = (sec) => {
    const b = $('#resend'); if (!b) return;
    clearInterval(timer); b.disabled = true;
    const tick = () => { if (sec <= 0) { clearInterval(timer); b.disabled = false; b.textContent = 'Reenviar código'; return; } b.textContent = `Reenviar en ${sec--}s`; };
    tick(); timer = setInterval(tick, 1000);
  };
  cooldown(60);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    $('#authErr').classList.add('hidden');
    try {
      const r = await fetch('/api/cuenta/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.value }) });
      const j = await r.json();
      if (!r.ok) { code.select(); throw new Error(j.error || 'Código incorrecto'); }
      clearInterval(timer);
      state.user = j.user; state.pending = null; renderAccount();
      closeAll(); toast(`¡Cuenta verificada! Bienvenido/a, ${j.user.name}`);
      if (after) after();
    } catch (err) { showErr(err.message); } finally { btn.disabled = false; }
  });
  $('#resend').addEventListener('click', async () => {
    const r = await fetch('/api/cuenta/reenviar', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) return showErr(j.error || 'No se pudo reenviar');
    toast('Te enviamos un código nuevo');
    if (j.dev) toast(j.dev);
    cooldown(60);
  });
  $('#changeContact').addEventListener('click', async () => {
    clearInterval(timer);
    await fetch('/api/cuenta/salir', { method: 'POST' });
    state.pending = null; renderAccount();
    openAuth('registro', after);
  });
}

async function openMyOrders() {
  showModal('<div class="spinner"></div>');
  const r = await fetch('/api/cuenta/pedidos');
  if (!r.ok) { state.user = null; renderAccount(); closeAll(); return openAuth('ingresar'); }
  const list = await r.json();
  const ST = ORDER_ST;
  showModal(`<div class="myorders"><h2>Mis pedidos</h2>
    ${list.length ? list.map((o) => `<div class="order" data-number="${o.number}">
      <header><h3>Pedido #${o.number}</h3><span class="st-${o.status}">● ${ST[o.status] || o.status}</span></header>
      ${o.status === 'preparado' ? `<div class="ready-banner ${o.readyNew ? 'new' : ''}">✔ <span>¡Tu pedido está listo para retirar!<small>Coordiná el retiro por el chat de acá abajo.</small></span></div>` : ''}
      <div class="muted">${new Date(o.created_at).toLocaleString('es-AR')} · <b class="price" style="font-size:1rem">${money(o.total, o.currency)}</b>${o.creditUsed ? ` · crédito −${money(o.creditUsed, o.currency)} · a pagar ${money(o.toPay, o.currency)}` : ''}</div>
      <div class="mini-cards">${o.items.map((i) => `<div class="mc" title="${esc(`${i.qty}× ${i.name} · ${i.set.toUpperCase()} #${i.collector_number} · ${i.condition}`)}">
        ${i.image ? `<a href="${esc(i.image_large || i.image)}" target="_blank" rel="noopener"><img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy"></a>` : '<span class="oc-noimg">Sin imagen</span>'}
        <span>${i.qty}× ${esc(i.name)}<small class="muted">${esc(i.set.toUpperCase())} · ${esc(i.condition)}${i.finish && i.finish !== 'nonfoil' ? ' · ' + FINISH[i.finish].toUpperCase() : ''}</small></span>
      </div>`).join('')}</div>
      <details class="chat">
        <summary>💬 Chat con la tienda <span class="nbadge ${o.unread ? '' : 'hidden'}" data-unread>${o.unread || ''}</span><span class="muted" data-count>${o.messages ? `${o.messages} mensaje${o.messages > 1 ? 's' : ''}` : ''}</span></summary>
        <div class="chat-log" data-log><div class="spinner"></div></div>
        <form class="chat-form" data-send><input class="input" name="text" maxlength="1000" placeholder="Escribí tu mensaje…" autocomplete="off" required aria-label="Mensaje"><button class="btn primary sm">Enviar</button></form>
      </details>
    </div>`).join('') : '<div class="empty">Todavía no hiciste pedidos.</div>'}
  </div>`);
  const root = $('.myorders');
  const paint = (box, j) => {
    setChatLog($('[data-log]', box), j.messages, 'cliente');
    $('[data-unread]', box).classList.add('hidden');
    $('[data-count]', box).textContent = j.messages.length ? `${j.messages.length} mensaje${j.messages.length > 1 ? 's' : ''}` : '';
    if (state.user) { state.user.notifications = j.notifications || 0; renderNotices(); }
  };
  const load = async (box) => {
    try {
      const r = await fetch(`/api/cuenta/pedidos/${box.closest('.order').dataset.number}/mensajes`);
      if (r.ok) { delete $('[data-log]', box).dataset.n; paint(box, await r.json()); }
    } catch {}
  };
  root.addEventListener('toggle', (e) => { const box = e.target.closest?.('.chat'); if (box?.open) load(box); }, true);
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-send]'); if (!f) return;
    e.preventDefault();
    const text = f.text.value.trim(); if (!text) return;
    const btn = $('button', f); btn.disabled = true;
    try {
      const r = await fetch(`/api/cuenta/pedidos/${f.closest('.order').dataset.number}/mensajes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo enviar el mensaje');
      f.text.value = ''; paint(f.closest('.chat'), j);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; f.text.focus(); }
  });
  // mientras la ventana esté abierta, trae los mensajes nuevos de los chats desplegados
  const timer = setInterval(() => {
    if (!root.isConnected || !$('#modal').classList.contains('open')) return clearInterval(timer);
    $$('.chat[open]', root).forEach(load);
  }, 15000);
  // abre solo el chat con mensajes sin leer, o el del pedido listo para retirar
  const first = $$('.chat', root).find((c) => !$('[data-unread]', c).classList.contains('hidden'));
  if (first) first.open = true;
  refreshNotices();
}

function openChangePassword() {
  showModal(`<div class="auth"><h2 style="margin:0 0 12px;font-family:var(--display)">Cambiar contraseña</h2>
    <form id="pwForm">
      <label class="field"><span>Contraseña actual</span><input class="input" name="current" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Nueva contraseña</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="auth-err hidden" id="authErr" role="alert"></div>
      <button class="btn primary" type="submit">Guardar</button>
    </form></div>`);
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/cuenta/clave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    const j = await r.json();
    if (!r.ok) { $('#authErr').textContent = j.error; $('#authErr').classList.remove('hidden'); return; }
    closeAll(); toast('Contraseña actualizada');
  });
}

// wishlist: cartas que el cliente busca; la tienda le avisa cuando entran en stock
// `prefill` = nombre para dejar escrito en el buscador (por ejemplo, lo que buscó en la tienda y no había)
async function openWishlist(prefill = '') {
  showModal('<div class="spinner"></div>');
  const r = await fetch('/api/cuenta/wishlist');
  if (!r.ok) { closeAll(); return openAuth('ingresar', () => openWishlist(prefill)); }
  const j = await r.json();
  showModal(`<div class="myorders wishlist">
    <h2>Mi wishlist</h2>
    <p class="muted" style="margin:0 0 10px">Anotá las cartas que estás buscando. Cuando entren en stock te avisamos por mail, y también por WhatsApp si nos dejás tu número.</p>
    <form id="wishAdd" class="wish-row">
      <input class="input" name="name" list="wishAc" maxlength="150" autocomplete="off" required placeholder="Nombre de la carta (en inglés)…" aria-label="Carta para agregar" value="${esc(prefill)}">
      <datalist id="wishAc"></datalist>
      <button class="btn primary">Agregar</button>
    </form>
    <div id="wishItems"></div>
    <form id="wishWa">
      <label class="field"><span>WhatsApp para los avisos (opcional)</span>
        <div class="wish-row"><input class="input" name="whatsapp" type="tel" maxlength="30" autocomplete="tel" placeholder="11 2345 6789" value="${esc(j.whatsapp || '')}"><button class="btn">Guardar</button></div>
        <span class="hint">Con código de área. Si lo dejás vacío, te avisamos solo por mail.</span>
      </label>
    </form>
  </div>`);
  const paint = (items) => {
    $('#wishItems').innerHTML = items.length ? items.map((w) => `<div class="wish-item">
      ${w.image ? `<img src="${esc(w.image)}" alt="" loading="lazy">` : '<span></span>'}
      <div><b>${esc(w.name)}</b>
        ${w.stock ? `<small class="in">● En stock${w.stock.price != null ? ` · ${money(w.stock.price, j.currency)}` : ''} · <a href="/?carta=${encodeURIComponent(w.stock.id)}">Ver carta</a></small>`
          : '<small class="muted">Sin stock · te avisamos cuando entre</small>'}</div>
      <button class="btn ghost sm danger" data-unwish="${esc(w.id)}">Quitar</button>
    </div>`).join('') : '<div class="empty" style="padding:30px 20px">Tu wishlist está vacía.</div>';
  };
  paint(j.items);
  const add = $('#wishAdd');
  add.name.focus();
  add.name.addEventListener('input', debounce(async () => {
    const q = add.name.value.trim(); if (q.length < 2) return;
    try {
      const names = await fetch('/api/cuenta/wishlist/buscar?q=' + encodeURIComponent(q)).then((x) => (x.ok ? x.json() : []));
      $('#wishAc').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
    } catch {}
  }, 250));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', add); btn.disabled = true;
    try {
      const r2 = await fetch('/api/cuenta/wishlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: add.name.value }) });
      const k = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(k.error || 'No se pudo agregar');
      add.reset(); $('#wishAc').innerHTML = ''; paint(k.items);
      toast(k.inStock ? `${k.added} ya está en stock` : `Te avisamos cuando entre ${k.added}`);
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; add.name.focus(); }
  });
  $('#wishItems').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unwish]'); if (!b) return;
    const r2 = await fetch(`/api/cuenta/wishlist/${encodeURIComponent(b.dataset.unwish)}`, { method: 'DELETE' });
    if (r2.ok) paint((await r2.json()).items);
  });
  $('#wishWa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r2 = await fetch('/api/cuenta/whatsapp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsapp: e.target.whatsapp.value }) });
    const k = await r2.json().catch(() => ({}));
    if (!r2.ok) return toast(k.error || 'No se pudo guardar', true);
    state.user = k.user; renderAccount();
    e.target.whatsapp.value = k.user.whatsapp || '';
    toast(k.user.whatsapp ? 'Listo: también te avisamos por WhatsApp' : 'Te avisamos solo por mail');
  });
}

const SALE_ST = { pendiente: 'Pendiente', aceptada: 'Aceptada', completada: 'Completada', rechazada: 'Rechazada', cancelada: 'Cancelada' };

async function openMyCredit() {
  showModal('<div class="spinner"></div>');
  const r = await fetch('/api/cuenta/credito');
  if (!r.ok) { closeAll(); return openAuth('ingresar'); }
  const j = await r.json();
  if (state.user) { state.user.credit = j.balance; renderAccount(); }
  showModal(`<div class="myorders">
    <h2>Mi crédito de tienda</h2>
    <div class="credit-hero"><span>Saldo disponible</span><b>${money(j.balance, j.currency)}</b>
      <small>Lo podés usar al hacer un pedido. Sumá más vendiéndonos cartas: <a href="/vender">te pagamos ${esc(String(state.buyInfo?.creditPercent ?? 75))}% en crédito</a>.</small></div>
    <h3 style="margin:14px 0 6px;font-family:var(--display);font-size:1rem">Movimientos</h3>
    ${j.movements.length ? `<div class="mv-list">${j.movements.map((m) => `<div class="mv">
      <div><div>${esc(m.reason)}</div><small class="muted">${new Date(m.created_at).toLocaleString('es-AR')}</small></div>
      <b class="${m.amount >= 0 ? 'plus' : 'minus'}">${m.amount >= 0 ? '+' : '−'}${money(Math.abs(m.amount), j.currency)}</b></div>`).join('')}</div>`
      : '<div class="empty">Todavía no tenés movimientos.</div>'}
  </div>`);
}

async function openMySales() {
  showModal('<div class="spinner"></div>');
  const r = await fetch('/api/vender/mias');
  if (!r.ok) { closeAll(); return openAuth('ingresar'); }
  const list = await r.json();
  showModal(`<div class="myorders"><h2>Mis ventas a la tienda</h2>
    ${list.length ? list.map((v) => `<div class="order" data-sale="${v.id}">
      <header><h3>Solicitud V-${v.number}</h3><span class="st-sale-${v.status}">● ${SALE_ST[v.status] || v.status}</span></header>
      <div class="muted">${new Date(v.created_at).toLocaleString('es-AR')} · ${v.payout === 'credit' ? 'Crédito de tienda' : 'Dinero'} ·
        <b class="price" style="font-size:1rem">${money(v.total, v.currency)}</b></div>
      <ul>${v.items.map((i) => `<li>${i.accepted !== i.qty ? `<s>${i.qty}×</s> ${i.accepted}×` : `${i.qty}×`} ${esc(i.name)}
        <span class="muted">${esc(i.set.toUpperCase())} #${esc(i.collector_number)} · ${esc(i.condition)}${i.finish !== 'nonfoil' ? ' · ' + FINISH[i.finish].toUpperCase() : ''}</span></li>`).join('')}</ul>
      ${v.photosRequired && !['rechazada', 'cancelada'].includes(v.status) ? (v.photosReceived
        ? '<div class="photo-ok">📷 Fotos recibidas ✔</div>'
        : `<div class="photo-step small"><span>📷 <b>Faltan las fotos</b> de las cartas (frente y dorso)${v.photosEmail ? ` — mandalas a <b>${esc(v.photosEmail)}</b> con el asunto "Fotos solicitud V-${v.number}"` : ''}. Sin fotos no podemos completar la venta.</span>
          ${v.photosMailto ? `<a class="btn primary sm" href="${esc(v.photosMailto)}">Enviar fotos por mail</a>` : ''}</div>`) : ''}
      ${v.adminNote ? `<div class="oracle">${esc(v.adminNote)}</div>` : ''}
      ${v.status === 'pendiente' ? `<button class="btn ghost sm danger" data-cancel-sale="${v.id}">Cancelar solicitud</button>` : ''}
    </div>`).join('') : '<div class="empty">Todavía no nos vendiste cartas. <a href="/vender">Mirá cuánto te pagamos</a>.</div>'}
  </div>`);
  $$('[data-cancel-sale]').forEach((b) => b.addEventListener('click', async () => {
    const r2 = await fetch(`/api/vender/${b.dataset.cancelSale}/cancelar`, { method: 'POST' });
    const j = await r2.json();
    if (!r2.ok) return toast(j.error, true);
    toast('Solicitud cancelada'); openMySales();
  }));
}
