// Nous deux — listes, notes et factures partagées.
const CFG = self.FIREBASE_CONFIG || {};
const VAPID = self.VAPID_KEY || '';
const DEMO = !CFG.apiKey;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

// ───────────────────────── utilitaires ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();

const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const fmtDay = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayYear = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function todayISO() { return toISO(new Date()); }
function daysUntil(iso) {
  const a = parseISO(todayISO()), b = parseISO(iso);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}
function fmtDate(iso) {
  const d = parseISO(iso);
  return d.getFullYear() === new Date().getFullYear() ? fmtDay.format(d) : fmtDayYear.format(d);
}
function addMonths(iso, n, anchorDay) {
  const d = parseISO(iso);
  const day = anchorDay || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toISO(t);
}
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function nextDue(bill) {
  const a = bill.anchorDay;
  switch (bill.recurrence) {
    case 'weekly': return addDays(bill.dueDate, 7);
    case 'biweekly': return addDays(bill.dueDate, 14);
    case 'monthly': return addMonths(bill.dueDate, 1, a);
    case 'quarterly': return addMonths(bill.dueDate, 3, a);
    case 'yearly': return addMonths(bill.dueDate, 12, a);
    default: return null;
  }
}
const REC = { none: 'Une seule fois', weekly: 'Chaque semaine', biweekly: 'Aux 2 semaines', monthly: 'Chaque mois', quarterly: 'Aux 3 mois', yearly: 'Chaque année' };
const REC_SHORT = { weekly: '↻ hebdo', biweekly: '↻ 2 sem.', monthly: '↻ mensuel', quarterly: '↻ trimestriel', yearly: '↻ annuel' };
function timeAgo(t) {
  if (!t) return '';
  const s = Math.max(0, (now() - t) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

// ───────────────────────── état ─────────────────────────
const state = {
  lists: [], items: [], notes: [], bills: [], payments: [], profiles: [],
  loaded: { lists: false, items: false, notes: false, bills: false, payments: false, profiles: false },
  billView: ls.get('nd-billview', 'due'),
  bilanMonth: todayISO().slice(0, 7),
  tab: 'listes',
  currentList: ls.get('nd-list'),
  showDone: ls.get('nd-showdone', true),
  showPaid: false,
  me: { name: '', email: '' },
};
let store = null;     // couche de données (Firebase ou démo)
let fb = null;        // modules Firebase quand configuré
let installEvent = null;

// ───────────────────────── stockage démo ─────────────────────────
function demoStore() {
  const KEY = 'nd-demo-data';
  let data = ls.get(KEY);
  if (!data) {
    const t = todayISO();
    const l1 = uid(), l2 = uid();
    data = {
      lists: [{ id: l1, name: 'Épicerie', createdAt: now() }, { id: l2, name: 'Costco', createdAt: now() + 1 }],
      items: [
        { id: uid(), listId: l1, text: 'Lait 2 %', done: false, by: 'Toi', createdAt: now() - 5000 },
        { id: uid(), listId: l1, text: 'Pommes', done: false, by: 'Elle', createdAt: now() - 4000 },
        { id: uid(), listId: l1, text: 'Pain tranché', done: false, by: 'Toi', createdAt: now() - 3000 },
        { id: uid(), listId: l1, text: 'Café', done: true, by: 'Elle', createdAt: now() - 9000, doneAt: now() - 2000 },
        { id: uid(), listId: l2, text: 'Papier de toilette', done: false, by: 'Elle', createdAt: now() }
      ],
      notes: [
        { id: uid(), title: 'Code Wi-Fi', body: 'Réseau : Maison\nMot de passe : à remplir', color: 'c4', updatedAt: now() - 86400000 * 3, by: 'Toi' },
        { id: uid(), title: 'Idées resto', body: 'Le petit thaï sur Mont-Royal\nBrunch dimanche ?', color: 'c1', updatedAt: now() - 3600000, by: 'Elle' }
      ],
      profiles: [{ id: 'toi@demo', name: 'Toi' }, { id: 'elle@demo', name: 'Elle' }],
      payments: [
        { id: uid(), billId: 'x1', name: 'Loyer', amount: 1250, date: addDays(t, -10), paidBy: 'toi@demo', owner: 'shared', shares: { 'toi@demo': 0.5, 'elle@demo': 0.5 }, createdAt: now() - 3 },
        { id: uid(), billId: 'x2', name: 'Internet', amount: 85, date: addDays(t, -6), paidBy: 'elle@demo', owner: 'shared', shares: { 'toi@demo': 0.5, 'elle@demo': 0.5 }, createdAt: now() - 2 },
        { id: uid(), billId: 'x3', name: 'Cellulaire', amount: 45, date: addDays(t, -3), paidBy: 'elle@demo', owner: 'elle@demo', shares: { 'elle@demo': 1 }, createdAt: now() - 1 }
      ],
      bills: [
        { id: uid(), name: 'Hydro-Québec', amount: 128.4, dueDate: addDays(t, 2), recurrence: 'monthly', anchorDay: parseISO(addDays(t, 2)).getDate(), remindDays: 3, paid: false, createdAt: now(), owner: 'shared' },
        { id: uid(), name: 'Internet', amount: 85, dueDate: addDays(t, 12), recurrence: 'monthly', anchorDay: parseISO(addDays(t, 12)).getDate(), remindDays: 3, paid: false, createdAt: now() },
        { id: uid(), name: 'Assurance auto', amount: 96.15, dueDate: addDays(t, -1), recurrence: 'monthly', anchorDay: parseISO(addDays(t, -1)).getDate(), remindDays: 3, paid: false, createdAt: now(), owner: 'toi@demo' },
        { id: uid(), name: 'Loyer', amount: 1250, dueDate: addDays(t, 20), recurrence: 'monthly', anchorDay: parseISO(addDays(t, 20)).getDate(), remindDays: 5, paid: false, createdAt: now(), owner: 'shared', lastPaid: addDays(t, -10), paidBy: 'toi@demo', paidFor: addMonths(addDays(t, 20), -1) }
      ]
    };
    ls.set(KEY, data);
  }
  const subs = {};
  const snap = (col) => (data[col] || []).map((x) => ({ ...x }));
  const emit = (col) => (subs[col] || []).forEach((cb) => cb(snap(col)));
  const save = () => ls.set(KEY, data);
  return {
    subscribe(col, cb) { (subs[col] ||= []).push(cb); data[col] ||= []; setTimeout(() => cb(snap(col), { fromCache: false }), 0); return () => {}; },
    async set(col, id, obj) { data[col] ||= []; const o = data[col].find((x) => x.id === id); if (o) Object.assign(o, obj); else data[col].push({ id, ...obj }); save(); emit(col); },
    async add(col, obj) { const id = uid(); data[col].push({ id, ...obj }); save(); emit(col); return id; },
    async update(col, id, patch) { const o = data[col].find((x) => x.id === id); if (o) Object.assign(o, patch); save(); emit(col); },
    async remove(col, id) { data[col] = data[col].filter((x) => x.id !== id); save(); emit(col); },
    async removeMany(col, ids) { const s = new Set(ids); data[col] = data[col].filter((x) => !s.has(x.id)); save(); emit(col); }
  };
}

// ───────────────────────── Firebase ─────────────────────────
async function loadFirebase() {
  const [appM, authM, fsM, msgM] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
    import(FB + 'firebase-messaging.js').catch(() => null)
  ]);
  const app = appM.initializeApp(CFG);
  let db;
  try {
    db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
  } catch { db = fsM.getFirestore(app); }
  const auth = authM.getAuth(app);
  auth.languageCode = 'fr';
  return { app, db, auth, authM, fsM, msgM };
}

function firebaseStore() {
  const { db, fsM: F } = fb;
  return {
    subscribe(col, cb, onError) {
      return F.onSnapshot(F.collection(db, col), { includeMetadataChanges: true }, (snap) => {
        setSync(!snap.metadata.fromCache);
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { fromCache: snap.metadata.fromCache });
      }, (err) => onError && onError(err));
    },
    async add(col, obj) { const ref = F.doc(F.collection(db, col)); F.setDoc(ref, obj).catch((e) => write(Promise.reject(e))); return ref.id; },
    async set(col, id, obj) { await F.setDoc(F.doc(db, col, id), obj, { merge: true }); },
    async update(col, id, patch) { await F.updateDoc(F.doc(db, col, id), patch); },
    async remove(col, id) { await F.deleteDoc(F.doc(db, col, id)); },
    async removeMany(col, ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const b = F.writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => b.delete(F.doc(db, col, id)));
        await b.commit();
      }
    }
  };
}

// Écritures : on n'attend pas le serveur (Firestore met à jour localement tout de suite).
function write(p) {
  Promise.resolve(p).catch((e) => {
    console.error(e);
    toast(e && e.code === 'permission-denied' ? "Accès refusé : ce compte n'est pas autorisé." : "Erreur d'enregistrement. Réessaie.");
  });
}

function setSync(online) {
  const dot = $('#sync-dot');
  dot.className = 'sync-dot ' + (online ? 'on' : 'off');
  dot.title = online ? 'Synchronisé' : 'Hors ligne — les changements seront envoyés au retour du réseau';
}

// ───────────────────────── démarrage ─────────────────────────
function show(id) {
  ['#screen-loading', '#screen-login', '#screen-denied'].forEach((s) => ($(s).hidden = s !== id));
  const inApp = id === null;
  $('#tabbar').hidden = !inApp;
  $('#btn-settings').hidden = !inApp;
  ['listes', 'notes', 'factures'].forEach((t) => ($('#v-' + t).hidden = !inApp || state.tab !== t));
}

async function main() {
  registerSW();
  wireStatic();
  const h = location.hash.slice(1);
  if (['listes', 'notes', 'factures'].includes(h)) state.tab = h;

  if (DEMO) {
    state.me = { name: 'Toi', email: 'toi@demo' };
    banner('Mode démo : les données restent sur ce téléphone. Remplis <b>config.js</b> pour partager avec ta conjointe (voir le guide).');
    store = demoStore();
    startApp();
    return;
  }

  try {
    fb = await loadFirebase();
  } catch (e) {
    console.error(e);
    show('#screen-login');
    $('#login-error').hidden = false;
    $('#login-error').textContent = 'Impossible de charger Firebase. Vérifie ta connexion Internet.';
    return;
  }
  const { auth, authM } = fb;
  authM.getRedirectResult(auth).catch((e) => loginError(e));
  let started = false;
  authM.onAuthStateChanged(auth, (user) => {
    if (user) {
      state.me = { name: (user.displayName || user.email || '').split(' ')[0], email: user.email || '' };
      if (!started) { started = true; store = firebaseStore(); startApp(); }
    } else {
      if (started) { location.reload(); return; }
      show('#screen-login');
    }
  });
}

function loginError(e) {
  if (!e) return;
  console.error(e);
  const el = $('#login-error');
  el.hidden = false;
  el.textContent = e.code === 'auth/unauthorized-domain'
    ? "Ce domaine n'est pas autorisé dans Firebase (README, étape 3 : Domaines autorisés)."
    : 'Connexion impossible : ' + (e.code || e.message);
}

async function login() {
  const { auth, authM } = fb;
  const provider = new authM.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await authM.signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      await authM.signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user') loginError(e);
  }
}

async function logout() {
  if (DEMO) return;
  await fb.authM.signOut(fb.auth);
  location.reload();
}

function startApp() {
  show(null);
  setTab(state.tab, true);
  const onErr = (err) => {
    console.error(err);
    if (err.code === 'permission-denied') {
      $('#denied-email').textContent = state.me.email;
      show('#screen-denied');
    } else banner('Problème de synchronisation : ' + esc(err.code || err.message));
  };
  for (const col of ['lists', 'items', 'notes', 'bills', 'payments']) {
    store.subscribe(col, (rows) => { state[col] = rows; state.loaded[col] = true; render(col); }, onErr);
  }
  store.subscribe('profiles', (rows, meta) => { state.loaded.profiles = true; onProfiles(rows, meta); }, onErr);
  if (!DEMO) refreshPushToken();
}

async function loginEmail(e) {
  e.preventDefault();
  const f = $('#f-login');
  const btn = f.querySelector('.btn.primary');
  $('#login-error').hidden = true; $('#login-error').className = 'error';
  btn.disabled = true; btn.textContent = 'Connexion…';
  try {
    await fb.authM.signInWithEmailAndPassword(fb.auth, f.email.value.trim(), f.password.value);
  } catch (err) {
    const bad = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
    if (bad.includes(err.code)) { const el = $('#login-error'); el.hidden = false; el.textContent = 'Courriel ou mot de passe incorrect.'; }
    else if (err.code === 'auth/too-many-requests') { const el = $('#login-error'); el.hidden = false; el.textContent = 'Trop d\'essais. Attends quelques minutes ou réinitialise le mot de passe.'; }
    else if (err.code === 'auth/operation-not-allowed') { const el = $('#login-error'); el.hidden = false; el.textContent = 'La connexion par courriel n\'est pas activée dans Firebase (README, étape 3).'; }
    else loginError(err);
  } finally { btn.disabled = false; btn.textContent = 'Se connecter'; }
}

async function forgotPassword() {
  const email = $('#f-login').email.value.trim();
  const el = $('#login-error');
  el.hidden = false; el.className = 'error';
  if (!email) { el.textContent = 'Entre ton courriel d\'abord, puis touche « Mot de passe oublié ? ».'; return; }
  try {
    await fb.authM.sendPasswordResetEmail(fb.auth, email);
    el.className = 'muted'; el.textContent = `Si ce compte existe, un courriel de réinitialisation a été envoyé à ${email}. Regarde aussi dans les indésirables.`;
  } catch (err) { el.className = 'error'; loginError(err); }
}

function wireStatic() {
  $('#btn-login').onclick = login;
  $('#f-login').onsubmit = loginEmail;
  $('#btn-forgot').onclick = forgotPassword;
  $('#btn-denied-logout').onclick = logout;
  $('#btn-settings').onclick = openSettings;
  $$('#tabbar button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (['listes', 'notes', 'factures'].includes(h) && h !== state.tab) setTab(h, true);
  });

  // Listes
  $('#add-item').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#item-input');
    const text = input.value.trim();
    if (!text || !state.currentList) return;
    input.value = '';
    write(store.add('items', { listId: state.currentList, text, done: false, by: state.me.name, createdAt: now() }));
  };
  $('#lists-empty').addEventListener('click', (e) => {
    const b = e.target.closest('[data-create-list]');
    if (!b) return;
    if (b.dataset.createList) createList(b.dataset.createList);
    else editListSheet(null);
  });
  $('#fab-note').onclick = () => noteSheet(null);
  $('#fab-bill').onclick = () => billSheet(null);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
}

function banner(html) { const b = $('#banner'); b.innerHTML = html; b.hidden = false; }

function setTab(tab, noHash) {
  state.tab = tab;
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['listes', 'notes', 'factures'].forEach((t) => ($('#v-' + t).hidden = t !== tab));
  if (!noHash || location.hash.slice(1) !== tab) history.replaceState(history.state, '', '#' + tab);
  window.scrollTo(0, 0);
}

function render(col) {
  if (col === 'lists' || col === 'items') renderLists();
  if (col === 'notes') renderNotes();
  if (col === 'bills' || col === 'payments') renderBills();
}

// ───────────────────────── LISTES ─────────────────────────
function sortedLists() { return [...state.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }

function renderLists() {
  if (!state.loaded.lists) return;
  const lists = sortedLists();
  const empty = lists.length === 0;
  $('#lists-empty').hidden = !empty;
  $('#list-body').hidden = empty;
  $('.chips-row').hidden = empty;
  if (empty) return;

  if (!lists.find((l) => l.id === state.currentList)) { state.currentList = lists[0].id; ls.set('nd-list', state.currentList); }

  const counts = {};
  state.items.forEach((i) => { if (!i.done) counts[i.listId] = (counts[i.listId] || 0) + 1; });
  const chips = $('#list-chips');
  chips.innerHTML = lists.map((l) => `
    <button class="chip ${l.id === state.currentList ? 'active' : ''}" data-id="${esc(l.id)}">
      ${esc(l.name)}${counts[l.id] ? `<span class="count">${counts[l.id]}</span>` : ''}
    </button>`).join('') +
    `<button class="chip ghost" data-new="1">+ Liste</button>`;
  chips.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.new) return editListSheet(null);
    if (b.dataset.id === state.currentList) return listMenu(b.dataset.id);
    state.currentList = b.dataset.id; ls.set('nd-list', state.currentList); renderLists();
  };
  chips.oncontextmenu = (e) => { const b = e.target.closest('.chip[data-id]'); if (b) { e.preventDefault(); listMenu(b.dataset.id); } };

  const cur = lists.find((l) => l.id === state.currentList);
  $('#item-input').placeholder = `Ajouter à « ${cur.name} »…`;

  const mine = state.items.filter((i) => i.listId === state.currentList);
  const todo = mine.filter((i) => !i.done).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const done = mine.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  const itemHTML = (i) => `
    <li class="item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
      <button class="toggle">
        <span class="box">${i.done ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>' : ''}</span>
        <span class="txt">${esc(i.text)}${i.by && i.by !== state.me.name && !i.done ? `<span class="who">ajouté par ${esc(i.by)}</span>` : ''}</span>
      </button>
      <button class="del" aria-label="Supprimer">×</button>
    </li>`;

  const ul = $('#items');
  ul.innerHTML = todo.length ? todo.map(itemHTML).join('') : '';
  if (!todo.length) ul.innerHTML = '';

  const ds = $('#done-section');
  if (!todo.length && !done.length) {
    ds.innerHTML = `<div class="empty"><div class="empty-emoji">✨</div><p>Liste vide. Ajoute un premier article ci-dessus.</p></div>`;
  } else if (!todo.length && done.length) {
    ds.innerHTML = `<div class="empty" style="padding:20px"><p>Tout est coché 🎉</p></div>` + doneBlock(done, itemHTML);
  } else {
    ds.innerHTML = done.length ? doneBlock(done, itemHTML) : '';
  }

  const onItemClick = (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const it = state.items.find((x) => x.id === li.dataset.id);
    if (!it) return;
    if (e.target.closest('.del')) {
      write(store.remove('items', it.id));
      toast(`« ${it.text} » supprimé`, 'Annuler', () => { const { id, ...rest } = it; write(store.add('items', rest)); });
    } else if (e.target.closest('.toggle')) {
      write(store.update('items', it.id, { done: !it.done, doneAt: it.done ? null : now() }));
    }
  };
  ul.onclick = onItemClick;
  ds.onclick = (e) => {
    if (e.target.closest('.toggle-done')) { state.showDone = !state.showDone; ls.set('nd-showdone', state.showDone); return renderLists(); }
    if (e.target.closest('.clear-done')) {
      const ids = done.map((i) => i.id);
      write(store.removeMany('items', ids));
      toast(`${ids.length} article${ids.length > 1 ? 's' : ''} retiré${ids.length > 1 ? 's' : ''}`);
      return;
    }
    onItemClick(e);
  };
}

function doneBlock(done, itemHTML) {
  return `
    <div class="done-head">
      <button class="toggle-done">${state.showDone ? '▾' : '▸'} Cochés (${done.length})</button>
      <button class="link-btn clear-done">Retirer les cochés</button>
    </div>
    ${state.showDone ? `<ul class="items">${done.map(itemHTML).join('')}</ul>` : ''}`;
}

function createList(name) {
  write(store.add('lists', { name, createdAt: now() }).then((id) => { state.currentList = id; ls.set('nd-list', id); renderLists(); }));
}

function listMenu(id) {
  const l = state.lists.find((x) => x.id === id);
  if (!l) return;
  const close = openSheet(`
    <h2>${esc(l.name)}</h2>
    <div class="menu-list">
      <button data-a="rename">✏️ Renommer la liste</button>
      <button data-a="uncheck">↺ Tout décocher</button>
      <button data-a="delete" class="danger">🗑️ Supprimer la liste</button>
    </div>`);
  $('#sheet .menu-list').onclick = async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    close();
    if (a === 'rename') editListSheet(l);
    if (a === 'uncheck') state.items.filter((i) => i.listId === id && i.done).forEach((i) => write(store.update('items', i.id, { done: false, doneAt: null })));
    if (a === 'delete') {
      const n = state.items.filter((i) => i.listId === id).length;
      if (await confirmSheet(`Supprimer « ${l.name} » ?`, n ? `Les ${n} article${n > 1 ? 's' : ''} de la liste seront supprimés aussi.` : '', 'Supprimer')) {
        write(store.removeMany('items', state.items.filter((i) => i.listId === id).map((i) => i.id)));
        write(store.remove('lists', id));
      }
    }
  };
}

function editListSheet(l) {
  const close = openSheet(`
    <h2>${l ? 'Renommer la liste' : 'Nouvelle liste'}</h2>
    <form id="f-list">
      <label class="field"><span>Nom</span><input name="name" required maxlength="40" value="${esc(l?.name || '')}" placeholder="ex. Pharmacie, Quincaillerie, Cadeaux…"></label>
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${l ? 'Enregistrer' : 'Créer'}</button></div>
    </form>`);
  const f = $('#f-list');
  setTimeout(() => f.name.focus(), 50);
  f.onsubmit = (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return;
    if (l) write(store.update('lists', l.id, { name }));
    else createList(name);
    close();
  };
}

// ───────────────────────── NOTES ─────────────────────────
function renderNotes() {
  const notes = [...state.notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  $('#notes-empty').hidden = notes.length > 0;
  const grid = $('#notes-grid');
  grid.innerHTML = notes.map((n) => `
    <button class="note-card ${esc(n.color || '')}" data-id="${esc(n.id)}">
      ${n.title ? `<h3>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3>` : ''}
      ${n.body ? `<p>${esc(n.body)}</p>` : ''}
      <div class="meta">${esc(n.by || '')} · ${timeAgo(n.updatedAt)}</div>
    </button>`).join('');
  grid.onclick = (e) => {
    const c = e.target.closest('.note-card');
    if (c) noteSheet(state.notes.find((n) => n.id === c.dataset.id));
  };
}

function noteSheet(note) {
  let color = note?.color || '';
  let pinned = !!note?.pinned;
  const close = openSheet(`
    <input class="note-title" id="n-title" placeholder="Titre" maxlength="100" value="${esc(note?.title || '')}">
    <textarea class="note-body" id="n-body" placeholder="Écris ici…">${esc(note?.body || '')}</textarea>
    <div class="colors" id="n-colors">
      ${['', 'c1', 'c2', 'c3', 'c4'].map((c) => `<button type="button" class="${c} ${c === color ? 'sel' : ''}" data-c="${c}" aria-label="Couleur"></button>`).join('')}
    </div>
    <div class="actions">
      ${note ? '<button class="btn danger small" id="n-del">Supprimer</button>' : ''}
      <button class="btn small" id="n-pin">${pinned ? 'Désépingler' : '📌 Épingler'}</button>
      <span class="spacer"></span>
      <button class="btn primary" data-close>Terminé</button>
    </div>`, save);
  if (!note) setTimeout(() => $('#n-title').focus(), 50);
  const ta = $('#n-body');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 200) + 'px'; };
  ta.addEventListener('input', grow); grow();
  $('#n-colors').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    color = b.dataset.c; $$('#n-colors button').forEach((x) => x.classList.toggle('sel', x === b));
  };
  $('#n-pin').onclick = () => { pinned = !pinned; $('#n-pin').textContent = pinned ? 'Désépingler' : '📌 Épingler'; };
  let deleted = false;
  if (note) $('#n-del').onclick = async () => {
    deleted = true; close();
    write(store.remove('notes', note.id));
    toast('Note supprimée', 'Annuler', () => { const { id, ...rest } = note; write(store.add('notes', rest)); });
  };
  function save() {
    if (deleted) return;
    const title = $('#n-title').value.trim();
    const body = $('#n-body').value.replace(/\s+$/, '');
    if (!note) {
      if (title || body) write(store.add('notes', { title, body, color, pinned, by: state.me.name, updatedAt: now(), createdAt: now() }));
    } else if (title !== (note.title || '') || body !== (note.body || '') || color !== (note.color || '') || pinned !== !!note.pinned) {
      write(store.update('notes', note.id, { title, body, color, pinned, by: state.me.name, updatedAt: now() }));
    }
  }
}

// ───────────────────────── PERSONNES ─────────────────────────
// Chaque personne a un profil (prénom) rangé sous son courriel.
const amtStr = (n) => (n == null || n === '' ? '' : (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2).replace('.', ',')));
const keyOf = (email) => String(email || '').trim().toLowerCase();
function people() {
  const list = state.profiles.map((p) => ({ email: p.id, name: p.name || p.id.split('@')[0] }));
  if (state.me.email && !list.find((p) => p.email === keyOf(state.me.email))) list.push({ email: keyOf(state.me.email), name: state.me.name || 'Moi' });
  return list.sort((a, b) => (a.email === keyOf(state.me.email) ? -1 : b.email === keyOf(state.me.email) ? 1 : a.name.localeCompare(b.name)));
}
function nameOf(email, fallback = '') {
  if (!email) return fallback;
  const p = state.profiles.find((x) => x.id === keyOf(email));
  if (p && p.name) return p.name;
  return String(email).includes('@') ? String(email).split('@')[0] : String(email); // ancien format : un prénom
}
function onProfiles(rows, meta) {
  state.profiles = rows;
  const mine = rows.find((p) => p.id === keyOf(state.me.email));
  if (mine && mine.name) state.me.name = mine.name;
  else if (!meta?.fromCache && !askedName && state.me.email) { askedName = true; nameSheet(true); }
  renderBills();
}
let askedName = false;
function nameSheet(first) {
  const close = openSheet(`
    <h2>${first ? 'Bienvenue ! 👋' : 'Ton prénom'}</h2>
    ${first ? '<p class="muted" style="margin-top:-8px">Comment tu t\'appelles ? C\'est le nom que l\'autre verra (factures, listes…).</p>' : ''}
    <form id="f-name">
      <label class="field"><span>Prénom</span><input name="name" required maxlength="30" value="${esc(first ? '' : state.me.name)}" autocomplete="given-name"></label>
      <div class="actions">${first ? '' : '<button type="button" class="btn" data-close>Annuler</button>'}<button class="btn primary">Enregistrer</button></div>
    </form>`);
  const f = $('#f-name');
  setTimeout(() => f.name.focus(), 50);
  f.onsubmit = (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return;
    state.me.name = name;
    write(store.set('profiles', keyOf(state.me.email), { name, updatedAt: now() }));
    close();
  };
}

// ───────────────────────── FACTURES ─────────────────────────
// owner : 'shared' (les deux, selon split) ou le courriel d'une personne.
// split : { courriel: pourcentage } pour les factures partagées (50/50 par défaut).
function sharesOf(owner, split) {
  const ps = people();
  if (owner && owner !== 'shared') return { [keyOf(owner)]: 1 };
  if (ps.length < 2) return ps.length ? { [ps[0].email]: 1 } : {};
  const [a, b] = ps;
  const pa = split && split[a.email] != null ? Number(split[a.email]) : (split && split[b.email] != null ? 100 - Number(split[b.email]) : 50);
  return { [a.email]: pa / 100, [b.email]: (100 - pa) / 100 };
}
function ownerLabel(b) {
  if (b.owner && b.owner !== 'shared') return '👤 ' + nameOf(b.owner);
  const s = sharesOf('shared', b.split);
  const vals = Object.values(s);
  if (vals.length === 2 && vals[0] !== 0.5) return `👥 ${Math.round(vals[0] * 100)}/${Math.round(vals[1] * 100)}`;
  return '👥 Nous deux';
}
const dueWindow = (b) => Math.max(7, Number(b.remindDays) || 0);
function paidThisCycle(b) {
  if (!b.paidFor || !b.recurrence || b.recurrence === 'none') return false;
  return nextDue({ ...b, dueDate: b.paidFor }) === b.dueDate;
}

function billStatus(b) {
  if (b.paid) return { cls: 'paid', label: 'Payée' };
  const d = daysUntil(b.dueDate);
  if (d < 0) return { cls: 'overdue', label: d === -1 ? 'En retard (hier)' : `En retard de ${-d} j` };
  if (d === 0) return { cls: 'overdue', label: "Aujourd'hui" };
  if (d === 1) return { cls: 'soon', label: 'Demain' };
  if (d <= Math.max(3, b.remindDays || 0)) return { cls: 'soon', label: `Dans ${d} jours` };
  return { cls: 'ok', label: `Dans ${d} jours` };
}

function renderBills() {
  const all = state.bills;
  const unpaid = all.filter((b) => !b.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paid = all.filter((b) => b.paid).sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));
  const toPay = unpaid.filter((b) => daysUntil(b.dueDate) <= dueWindow(b));
  const upcoming = unpaid.filter((b) => daysUntil(b.dueDate) > dueWindow(b));
  $('#bills-empty').hidden = all.length > 0 || state.billView === 'bilan';

  const soonCount = unpaid.filter((b) => daysUntil(b.dueDate) <= Math.max(3, b.remindDays || 0)).length;
  const badge = $('#bills-badge');
  badge.hidden = !soonCount; badge.textContent = soonCount;

  const seg = `<div class="seg">
      <button data-view="due" class="${state.billView === 'due' ? 'on' : ''}">Échéances</button>
      <button data-view="bilan" class="${state.billView === 'bilan' ? 'on' : ''}">Bilan</button>
    </div>`;

  if (state.billView === 'bilan') {
    $('#bills-summary').innerHTML = seg;
    $('#bills-list').innerHTML = bilanHTML();
    $('#fab-bill').hidden = true;
  } else {
    $('#fab-bill').hidden = false;
    const urgent = unpaid.filter((b) => daysUntil(b.dueDate) <= 0).length;
    const total30 = unpaid.filter((b) => daysUntil(b.dueDate) <= 30).reduce((s, b) => s + (Number(b.amount) || 0), 0);
    $('#bills-summary').innerHTML = seg + (all.length ? `
      <div class="summary">
        <div class="stat ${urgent ? 'alert' : ''}"><div class="k">${urgent ? 'En retard / aujourd\'hui' : 'À payer bientôt'}</div><div class="v">${urgent || toPay.length}</div></div>
        <div class="stat"><div class="k">Prévu (30 jours)</div><div class="v">${money.format(total30)}</div></div>
      </div>` : '');

    const billHTML = (b) => {
      const s = billStatus(b);
      const done = paidThisCycle(b);
      return `
        <div class="bill ${s.cls}" data-id="${esc(b.id)}">
          <div class="stripe"></div>
          <button class="main">
            <div class="name"><span>${esc(b.name)}</span>${REC_SHORT[b.recurrence] ? `<span class="rec">${REC_SHORT[b.recurrence]}</span>` : ''}</div>
            <div class="sub">
              ${b.amount != null && b.amount !== '' ? `<span class="amt">${money.format(Number(b.amount))}</span>` : ''}
              ${b.paid ? '' : `<span class="pill">${s.label}</span><span>${fmtDate(b.dueDate)}</span>`}
              ${b.paid ? `<span class="pill">Payée${b.lastPaid ? ' le ' + fmtDate(b.lastPaid) : ''}${b.paidBy ? ' · ' + esc(nameOf(b.paidBy)) : ''}</span>` : ''}
            </div>
            <div class="sub2"><span class="owner">${esc(ownerLabel(b))}</span>${done ? `<span class="done-chip">✓ Payée le ${fmtDate(b.lastPaid)}${b.paidBy ? ' par ' + esc(nameOf(b.paidBy)) : ''}</span>` : ''}</div>
          </button>
          <button class="pay">${b.paid ? '↺' : '✓ Payée'}</button>
        </div>`;
    };

    $('#bills-list').innerHTML =
      (toPay.length ? `<div class="section-title">⚠️ À payer</div>${toPay.map(billHTML).join('')}`
        : (all.length ? '<div class="allgood">✓ Rien à payer cette semaine</div>' : '')) +
      (upcoming.length ? `<div class="section-title">📅 À venir</div>${upcoming.map(billHTML).join('')}` : '') +
      (paid.length ? `<div class="done-head"><button class="toggle-done" data-paid>${state.showPaid ? '▾' : '▸'} ✓ Payées (${paid.length})</button>${state.showPaid ? '<button class="link-btn" data-clear-paid>Effacer</button>' : ''}</div>${state.showPaid ? paid.map(billHTML).join('') : ''}` : '');
  }

  $('#bills-summary').onclick = (e) => {
    const v = e.target.closest('[data-view]');
    if (v && v.dataset.view !== state.billView) { state.billView = v.dataset.view; ls.set('nd-billview', state.billView); renderBills(); }
  };
  $('#bills-list').onclick = async (e) => {
    const m = e.target.closest('[data-month]');
    if (m) { state.bilanMonth = shiftMonth(state.bilanMonth, Number(m.dataset.month)); return renderBills(); }
    const pd = e.target.closest('[data-pay-id]');
    if (pd) return paymentSheet(state.payments.find((p) => p.id === pd.dataset.payId));
    if (e.target.closest('[data-paid]')) { state.showPaid = !state.showPaid; return renderBills(); }
    if (e.target.closest('[data-clear-paid]')) {
      if (await confirmSheet('Effacer les factures payées ?', 'Les factures uniques déjà payées disparaîtront de la liste. Le bilan les garde.', 'Effacer')) write(store.removeMany('bills', paid.map((b) => b.id)));
      return;
    }
    const el = e.target.closest('.bill'); if (!el) return;
    const b = state.bills.find((x) => x.id === el.dataset.id); if (!b) return;
    if (e.target.closest('.pay')) b.paid ? unpayBill(b) : paySheet(b);
    else billSheet(b);
  };
}

// ── Bilan du mois : qui a payé quoi, et qui doit combien ──
function monthKey(iso) { return String(iso).slice(0, 7); }
function shiftMonth(mk, n) { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
const fmtMonth = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric' });

function bilanHTML() {
  const mk = state.bilanMonth;
  const label = fmtMonth.format(parseISO(mk + '-01'));
  const pays = state.payments.filter((p) => monthKey(p.date) === mk).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const ps = people();
  const paidBy = {}, owes = {};
  ps.forEach((p) => { paidBy[p.email] = 0; owes[p.email] = 0; });
  let total = 0;
  for (const p of pays) {
    const amt = Number(p.amount) || 0;
    total += amt;
    const who = keyOf(p.paidBy);
    paidBy[who] = (paidBy[who] || 0) + amt;
    const shares = p.shares && Object.keys(p.shares).length ? p.shares : sharesOf(p.owner || 'shared', p.split);
    for (const [e, s] of Object.entries(shares)) owes[keyOf(e)] = (owes[keyOf(e)] || 0) + amt * s;
  }
  const emails = Object.keys(paidBy);
  const nav = `<div class="month-nav"><button class="icon-btn" data-month="-1" aria-label="Mois précédent">◀</button><b>${label.charAt(0).toUpperCase() + label.slice(1)}</b><button class="icon-btn" data-month="1" aria-label="Mois suivant" ${mk >= monthKey(todayISO()) ? 'disabled' : ''}>▶</button></div>`;
  if (!pays.length) return nav + `<div class="empty"><div class="empty-emoji">📊</div><p>Aucun paiement en ${label}.<br>Touche « ✓ Payée » sur une facture pour qu'elle apparaisse ici.</p></div>`;

  const max = Math.max(...emails.map((e) => paidBy[e]), 1);
  const cards = emails.filter((e) => paidBy[e] > 0 || ps.find((p) => p.email === e)).map((e, i) => `
    <div class="who-row">
      <div class="who-top"><span class="avatar a${i % 2}">${esc(nameOf(e).charAt(0).toUpperCase())}</span><b>${esc(nameOf(e))}</b><span class="spacer"></span><b>${money.format(paidBy[e])}</b></div>
      <div class="bar"><span class="a${i % 2}" style="width:${(paidBy[e] / max) * 100}%"></span></div>
    </div>`).join('');

  // Équilibre entre deux personnes : ce que chacun a payé moins sa part.
  let balance = '';
  if (emails.length === 2) {
    const [a, b] = emails;
    const diff = paidBy[a] - owes[a]; // > 0 : a a trop payé, b lui doit diff
    if (Math.abs(diff) < 1) balance = `<div class="balance ok">✓ Vous êtes à égalité ce mois-ci</div>`;
    else {
      const [debtor, creditor] = diff > 0 ? [b, a] : [a, b];
      balance = `<div class="balance">💸 <b>${esc(nameOf(debtor))}</b> doit <b>${money.format(Math.abs(diff))}</b> à <b>${esc(nameOf(creditor))}</b></div>`;
    }
  }

  const rows = pays.map((p) => `
    <button class="pay-row" data-pay-id="${esc(p.id)}">
      <span class="pay-date">${fmtDay.format(parseISO(p.date))}</span>
      <span class="pay-name">${esc(p.name)}<small>${esc(nameOf(p.paidBy))} · ${esc(p.owner && p.owner !== 'shared' ? 'pour ' + nameOf(p.owner) : 'partagée')}</small></span>
      <b>${money.format(Number(p.amount) || 0)}</b>
    </button>`).join('');

  return nav + `
    <div class="card bilan">
      <div class="k">Total payé</div><div class="v">${money.format(total)}</div>
      ${cards}
      ${balance}
      <p class="muted tiny">La part de chacun suit le « Responsable » de chaque facture (à toi, à elle, ou partagée).</p>
    </div>
    <div class="section-title">Paiements (${pays.length})</div>
    <div class="card list">${rows}</div>`;
}

// ── Payer : on demande le montant (il varie souvent) et qui a payé ──
function paySheet(b) {
  const ps = people();
  const close = openSheet(`
    <h2>Payer « ${esc(b.name)} »</h2>
    <form id="f-pay" autocomplete="off">
      <div class="row2">
        <label class="field"><span>Montant payé ($)</span><input name="amount" inputmode="decimal" required value="${b.amount != null && b.amount !== '' ? esc(amtStr(b.amount)) : ''}"></label>
        <label class="field"><span>Date</span><input name="date" type="date" required value="${todayISO()}"></label>
      </div>
      <label class="field"><span>Payée par</span><select name="paidBy">
        ${ps.map((p) => `<option value="${esc(p.email)}" ${p.email === keyOf(state.me.email) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>
      ${nextDue(b) ? `<p class="muted tiny">Prochaine échéance : ${fmtDate(nextDue(b))}</p>` : ''}
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">✓ Confirmer</button></div>
    </form>`);
  const f = $('#f-pay');
  setTimeout(() => { if (!f.amount.value) f.amount.focus(); }, 50);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const amount = Number(f.amount.value.replace(/\s|\$/g, '').replace(',', '.'));
    if (!isFinite(amount) || amount < 0) { f.amount.focus(); return toast('Montant invalide'); }
    const date = f.date.value || todayISO();
    const paidBy = f.paidBy.value;
    close();
    const owner = b.owner || 'shared';
    const shares = sharesOf(owner, b.split);
    const payId = await store.add('payments', { billId: b.id, name: b.name, amount, date, paidBy, owner, shares, dueDate: b.dueDate, createdAt: now() }).catch((err) => { write(Promise.reject(err)); return null; });
    const prev = { dueDate: b.dueDate, paid: !!b.paid, paidAt: b.paidAt || null, lastPaid: b.lastPaid || null, paidBy: b.paidBy || null, paidFor: b.paidFor || null };
    const next = nextDue(b);
    const patch = { lastPaid: date, paidBy, paidFor: b.dueDate };
    if (next) write(store.update('bills', b.id, { ...patch, dueDate: next }));
    else write(store.update('bills', b.id, { ...patch, paid: true, paidAt: now() }));
    toast(`${b.name} payée ✓${next ? ' · prochaine : ' + fmtDate(next) : ''}`, 'Annuler', () => {
      write(store.update('bills', b.id, prev));
      if (payId) write(store.remove('payments', payId));
    });
  };
}

function unpayBill(b) {
  const p = state.payments.filter((x) => x.billId === b.id).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))[0];
  write(store.update('bills', b.id, { paid: false, paidAt: null }));
  if (p) write(store.remove('payments', p.id));
}

function paymentSheet(p) {
  if (!p) return;
  const ps = people();
  const close = openSheet(`
    <h2>Paiement : ${esc(p.name)}</h2>
    <form id="f-payedit" autocomplete="off">
      <div class="row2">
        <label class="field"><span>Montant ($)</span><input name="amount" inputmode="decimal" required value="${esc(amtStr(p.amount))}"></label>
        <label class="field"><span>Date</span><input name="date" type="date" required value="${esc(p.date)}"></label>
      </div>
      <label class="field"><span>Payée par</span><select name="paidBy">
        ${ps.map((x) => `<option value="${esc(x.email)}" ${x.email === keyOf(p.paidBy) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select></label>
      <div class="actions"><button type="button" class="btn danger" id="p-del">Supprimer</button><span class="spacer"></span><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`);
  const f = $('#f-payedit');
  f.onsubmit = (e) => {
    e.preventDefault();
    const amount = Number(f.amount.value.replace(/\s|\$/g, '').replace(',', '.'));
    if (!isFinite(amount)) return toast('Montant invalide');
    write(store.update('payments', p.id, { amount, date: f.date.value, paidBy: f.paidBy.value }));
    close();
  };
  $('#p-del').onclick = async () => {
    close();
    if (await confirmSheet('Supprimer ce paiement ?', 'Il disparaît du bilan. La facture, elle, ne change pas.', 'Supprimer')) write(store.remove('payments', p.id));
  };
}

function billSheet(b) {
  const ps = people();
  const owner = b?.owner || 'shared';
  const shares = sharesOf('shared', b?.split);
  const firstPct = ps.length >= 2 ? Math.round((shares[ps[0].email] ?? 0.5) * 100) : 50;
  const close = openSheet(`
    <h2>${b ? 'Modifier la facture' : 'Nouvelle facture'}</h2>
    <form id="f-bill" autocomplete="off">
      <label class="field"><span>Nom</span><input name="name" required maxlength="60" value="${esc(b?.name || '')}" placeholder="ex. Hydro-Québec, Internet, Loyer"></label>
      <div class="row2">
        <label class="field"><span>Montant habituel ($)</span><input name="amount" inputmode="decimal" value="${b?.amount != null && b?.amount !== '' ? esc(amtStr(b.amount)) : ''}" placeholder="optionnel"></label>
        <label class="field"><span>Échéance</span><input name="dueDate" type="date" required value="${esc(b?.dueDate || todayISO())}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Revient</span><select name="recurrence">
          ${Object.entries(REC).map(([k, v]) => `<option value="${k}" ${(b?.recurrence || 'monthly') === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
        <label class="field"><span>Rappel</span><select name="remindDays">
          ${[[0, 'Le jour même'], [1, '1 jour avant'], [2, '2 jours avant'], [3, '3 jours avant'], [5, '5 jours avant'], [7, '1 semaine avant'], [14, '2 semaines avant']]
            .map(([k, v]) => `<option value="${k}" ${(b?.remindDays ?? 3) === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      </div>
      <label class="field"><span>Responsable</span><select name="owner">
        <option value="shared" ${owner === 'shared' ? 'selected' : ''}>👥 Nous deux (partagée)</option>
        ${ps.map((p) => `<option value="${esc(p.email)}" ${keyOf(owner) === p.email ? 'selected' : ''}>👤 ${esc(p.name)}</option>`).join('')}
      </select></label>
      ${ps.length >= 2 ? `
      <div class="field" id="split-wrap" ${owner === 'shared' ? '' : 'hidden'}>
        <span>Partage</span>
        <div class="split-labels"><b>${esc(ps[0].name)} <i id="pctA">${firstPct}</i> %</b><b>${esc(ps[1].name)} <i id="pctB">${100 - firstPct}</i> %</b></div>
        <input type="range" name="split" min="0" max="100" step="5" value="${firstPct}">
      </div>` : ''}
      <p class="muted tiny" id="owner-hint">${owner === 'shared' ? 'Les rappels vont à vous deux.' : 'Les rappels vont seulement à cette personne.'}</p>
      <label class="field"><span>Note</span><input name="note" maxlength="200" value="${esc(b?.note || '')}" placeholder="ex. Prélèvement auto, payer par AccèsD…"></label>
      ${b?.lastPaid ? `<p class="muted tiny">Dernier paiement : ${fmtDate(b.lastPaid)}${b.paidBy ? ' par ' + esc(nameOf(b.paidBy)) : ''}</p>` : ''}
      <div class="actions">
        ${b ? '<button type="button" class="btn danger" id="b-del">Supprimer</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Annuler</button>
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  const f = $('#f-bill');
  if (!b) setTimeout(() => f.name.focus(), 50);
  f.owner.onchange = () => {
    const shared = f.owner.value === 'shared';
    if ($('#split-wrap')) $('#split-wrap').hidden = !shared;
    $('#owner-hint').textContent = shared ? 'Les rappels vont à vous deux.' : 'Les rappels vont seulement à cette personne.';
  };
  if (f.split) f.split.oninput = () => { $('#pctA').textContent = f.split.value; $('#pctB').textContent = 100 - f.split.value; };
  f.onsubmit = (e) => {
    e.preventDefault();
    const raw = f.amount.value.replace(/\s|\$/g, '').replace(',', '.');
    const amount = raw === '' ? null : Number(raw);
    if (raw !== '' && !isFinite(amount)) { f.amount.focus(); return toast('Montant invalide'); }
    const dueDate = f.dueDate.value;
    const data = {
      name: f.name.value.trim(), amount, dueDate, recurrence: f.recurrence.value,
      remindDays: Number(f.remindDays.value), note: f.note.value.trim(),
      anchorDay: parseISO(dueDate).getDate(),
      owner: f.owner.value,
      split: f.split && f.owner.value === 'shared' ? { [ps[0].email]: Number(f.split.value), [ps[1].email]: 100 - Number(f.split.value) } : null
    };
    if (!data.name || !dueDate) return;
    if (b) write(store.update('bills', b.id, data));
    else write(store.add('bills', { ...data, paid: false, createdAt: now(), by: state.me.name }));
    close();
  };
  if (b) $('#b-del').onclick = async () => {
    close();
    if (await confirmSheet(`Supprimer « ${b.name} » ?`, 'Les paiements déjà faits restent dans le bilan.', 'Supprimer')) write(store.remove('bills', b.id));
  };
}

// ───────────────────────── réglages & notifications ─────────────────────────
function notifState() {
  if (DEMO) return { ok: false, text: 'Disponible une fois Firebase configuré.' };
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return { ok: false, text: 'Non pris en charge par ce navigateur.' };
  if (!VAPID) return { ok: false, text: 'Clé VAPID manquante dans config.js.' };
  if (Notification.permission === 'denied') return { ok: false, text: 'Bloquées. Autorise-les dans les réglages Android de l\'appli.' };
  if (Notification.permission === 'granted' && ls.get('nd-push-token')) return { ok: true, on: true, text: 'Activées sur ce téléphone.' };
  return { ok: true, on: false, text: 'Reçois un rappel avant chaque échéance.' };
}

function openSettings() {
  const ns = notifState();
  const close = openSheet(`
    <h2>Réglages</h2>
    <div class="setting">
      <div><div class="t">Ton prénom</div><div class="d">${esc(state.me.name || '—')}</div></div>
      <button class="btn small" id="s-name">Modifier</button>
    </div>
    <div class="setting">
      <div><div class="t">Rappels de factures</div><div class="d">${esc(ns.text)}</div></div>
      ${ns.ok ? (ns.on ? '<button class="btn small" id="s-test">Tester</button>' : '<button class="btn primary small" id="s-notif">Activer</button>') : ''}
    </div>
    ${installEvent ? `<div class="setting"><div><div class="t">Installer l'appli</div><div class="d">Ajoute « Nous deux » à l'écran d'accueil.</div></div><button class="btn primary small" id="s-install">Installer</button></div>` : ''}
    <div class="setting">
      <div><div class="t">${DEMO ? 'Mode démo' : 'Connecté'}</div><div class="d">${DEMO ? 'Données locales sur cet appareil' : esc(state.me.email)}</div></div>
      ${DEMO ? '' : '<button class="btn small" id="s-logout">Déconnexion</button>'}
    </div>
    <div class="actions"><button class="btn" data-close>Fermer</button></div>`);
  $('#s-notif') && ($('#s-notif').onclick = async () => { const ok = await enablePush(); if (ok) { close(); toast('Rappels activés ✓'); } });
  $('#s-test') && ($('#s-test').onclick = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Nous deux', { body: 'Les notifications fonctionnent ✓', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
  });
  $('#s-install') && ($('#s-install').onclick = async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; close(); });
  $('#s-logout') && ($('#s-logout').onclick = logout);
  $('#s-name').onclick = () => nameSheet(false);
}

async function getSWReg() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.getRegistration('./').then((r) => r || navigator.serviceWorker.ready);
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications refusées'); return false; }
    return await savePushToken();
  } catch (e) {
    console.error(e); toast("Impossible d'activer les notifications : " + (e.code || e.message)); return false;
  }
}

async function savePushToken() {
  const M = fb.msgM;
  if (!M || !(await M.isSupported())) { toast('Notifications non prises en charge ici'); return false; }
  const messaging = M.getMessaging(fb.app);
  const reg = await getSWReg();
  const token = await M.getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) return false;
  const old = ls.get('nd-push-token');
  const F = fb.fsM;
  await F.setDoc(F.doc(fb.db, 'tokens', token), { email: keyOf(state.me.email), name: state.me.name, updatedAt: now(), ua: navigator.userAgent.slice(0, 120) });
  if (old && old !== token) F.deleteDoc(F.doc(fb.db, 'tokens', old)).catch(() => {});
  ls.set('nd-push-token', token);
  M.onMessage(messaging, (p) => { const d = p.data || {}; toast(`${d.title || ''} — ${d.body || ''}`); });
  return true;
}

// Rafraîchit le jeton (il peut changer) si les notifications sont déjà permises.
function refreshPushToken() {
  if ('Notification' in window && Notification.permission === 'granted' && VAPID && ls.get('nd-push-token')) {
    savePushToken().catch((e) => console.warn('jeton push', e));
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('SW', e));
}

// ───────────────────────── feuilles, confirmations, toasts ─────────────────────────
// Le bouton « retour » d'Android ferme la feuille ouverte (une entrée d'historique par feuille).
let closeCurrentSheet = null;
let pendingBack = null, backResolve = null;
function pushSheetState() {
  const doPush = () => history.pushState({ sheet: true }, '', location.href);
  pendingBack ? pendingBack.then(doPush) : doPush();
}
function openSheet(html, onClose) {
  const replacing = !!closeCurrentSheet;
  if (replacing) closeCurrentSheet(true); // garde l'entrée d'historique existante
  const root = $('#sheet');
  root.innerHTML = `<div class="backdrop"></div><div class="panel" role="dialog" aria-modal="true"><div class="grip"></div>${html}</div>`;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  if (!replacing) pushSheetState();
  let closed = false;
  const close = (fromHistory) => {
    if (closed) return;
    closed = true;
    closeCurrentSheet = null;
    try { onClose && onClose(); } catch (e) { console.error(e); } // avant de vider : onClose lit les champs
    root.hidden = true; root.innerHTML = '';
    document.body.style.overflow = '';
    if (fromHistory !== true && history.state && history.state.sheet && !pendingBack) {
      pendingBack = new Promise((r) => (backResolve = r));
      history.back();
      setTimeout(() => { if (backResolve) { const r = backResolve; backResolve = null; pendingBack = null; r(); } }, 700);
    }
  };
  closeCurrentSheet = close;
  root.querySelector('.backdrop').onclick = () => close();
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); close(); }));
  return close;
}
window.addEventListener('popstate', () => {
  if (backResolve) { const r = backResolve; backResolve = null; pendingBack = null; r(); return; }
  if (closeCurrentSheet) closeCurrentSheet(true);
});

function confirmSheet(title, text, okLabel) {
  return new Promise((resolve) => {
    let answered = false;
    const close = openSheet(`
      <h2>${esc(title)}</h2>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="actions"><button class="btn" data-close>Annuler</button><button class="btn primary" id="c-ok">${esc(okLabel || 'OK')}</button></div>`,
      () => { if (!answered) resolve(false); });
    $('#c-ok').onclick = () => { answered = true; resolve(true); close(); };
  });
}

let toastTimer;
function toast(msg, actionLabel, onAction) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  t.hidden = false;
  if (actionLabel) t.querySelector('button').onclick = () => { t.hidden = true; onAction && onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 5000 : 2600);
}

// Rafraîchir les « dans X jours » quand on revient sur l'appli un autre jour.
document.addEventListener('visibilitychange', () => { if (!document.hidden && store) renderBills(); });

main();
