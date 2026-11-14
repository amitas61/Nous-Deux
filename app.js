// Nous deux — listes, notes et factures partagées.
const CFG = self.FIREBASE_CONFIG || {};
const VAPID = self.VAPID_KEY || '';
const PUSH_URL = self.PUSH_URL || '';
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
  lists: [], items: [], notes: [], bills: [], payments: [], profiles: [], freq: [], catmap: [], pings: [], movies: [],
  loaded: { lists: false, items: false, notes: false, bills: false, payments: false, profiles: false, freq: false, catmap: false, pings: false, movies: false },
  filmView: 'towatch',
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
      freq: [['Lait 2 %', 9, 'laitier'], ['Bananes', 7, 'fruits'], ['Œufs', 6, 'laitier'], ['Pain tranché', 6, 'pain'], ['Café', 4, 'epicerie'], ['Yogourt grec', 4, 'laitier'], ['Poulet', 3, 'viande'], ['Papier de toilette', 2, 'hygiene']]
        .map(([text, count, cat], i) => ({ id: docId(itemKey(text)), text, count, cat, last: now() - i * 86400000 })),
      catmap: [],
      movies: [
        { id: uid(), tmdbId: 27205, type: 'movie', title: 'Inception', year: '2010', poster: null, overview: 'Dom Cobb est un voleur expérimenté dans l\'art périlleux de l\'extraction.', rating: 8.4, status: 'towatch', addedBy: 'elle@demo', addedAt: now() - 5000, votes: {} },
        { id: uid(), tmdbId: 1396, type: 'tv', title: 'Breaking Bad', year: '2008', poster: null, overview: 'Un professeur de chimie se lance dans la fabrication de méthamphétamine.', rating: 8.9, status: 'towatch', addedBy: 'toi@demo', addedAt: now() - 9000, votes: {} },
        { id: uid(), tmdbId: 120, type: 'movie', title: 'Le Seigneur des anneaux', year: '2001', poster: null, overview: '', rating: 8.4, status: 'seen', seenAt: now() - 86400000, addedBy: 'toi@demo', addedAt: now() - 99999, votes: { 'toi@demo': 1, 'elle@demo': -1 } }
      ],
      pings: [{ id: 'elle@demo', at: now() - 4 * 60000, listName: 'Épicerie', done: false }],
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
  ['listes', 'notes', 'factures', 'films'].forEach((t) => ($('#v-' + t).hidden = !inApp || state.tab !== t));
}

async function main() {
  registerSW();
  wireStatic();
  const h = location.hash.slice(1);
  if (['listes', 'notes', 'factures', 'films'].includes(h)) state.tab = h;

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
  for (const col of ['lists', 'items', 'notes', 'bills', 'payments', 'freq', 'catmap', 'pings', 'movies']) {
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
    if (['listes', 'notes', 'factures', 'films'].includes(h) && h !== state.tab) setTab(h, true);
  });

  // Listes
  $('#add-item').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#item-input');
    const text = input.value.trim();
    if (!text || !state.currentList) return;
    input.value = '';
    addItem(text);
  };
  $('#btn-shop').onclick = startShopping;
  wireFilms();
  wireLongPress($('#v-listes'));
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
  ['listes', 'notes', 'factures', 'films'].forEach((t) => ($('#v-' + t).hidden = t !== tab));
  if (!noHash || location.hash.slice(1) !== tab) history.replaceState(history.state, '', '#' + tab);
  window.scrollTo(0, 0);
}

function render(col) {
  if (['lists', 'items', 'freq', 'catmap', 'pings'].includes(col)) renderLists();
  if (col === 'notes') renderNotes();
  if (col === 'movies') renderFilms();
  if (col === 'bills' || col === 'payments') renderBills();
}

// ───────────────────────── LISTES ─────────────────────────
// Rayons, dans l'ordre d'un supermarché typique au Québec.
const AISLES = [
  ['fruits', '🥦', 'Fruits et légumes'],
  ['pain', '🥖', 'Boulangerie'],
  ['viande', '🥩', 'Viandes et poissons'],
  ['laitier', '🧀', 'Produits laitiers et œufs'],
  ['epicerie', '🥫', 'Épicerie'],
  ['collation', '🍪', 'Collations'],
  ['boisson', '🧃', 'Boissons'],
  ['surgele', '🧊', 'Surgelés'],
  ['hygiene', '🧴', 'Hygiène et beauté'],
  ['menage', '🧽', 'Entretien ménager'],
  ['pharma', '💊', 'Pharmacie'],
  ['bebe', '🐾', 'Bébé et animaux'],
  ['autre', '🛒', 'Autres']
];
const AISLE = Object.fromEntries(AISLES.map(([k, e, n], i) => [k, { emoji: e, name: n, order: i }]));
const KW = {
  fruits: 'pomme,poire,banane,orange,clementine,mandarine,citron,lime,raisin,fraise,framboise,bleuet,mure,canneberge,mangue,ananas,kiwi,melon,cantaloup,pasteque,avocat,tomate,concombre,laitue,salade,epinard,brocoli,chou,chou-fleur,carotte,celeri,oignon,echalote,ail,patate,pomme de terre,patate douce,poivron,piment,champignon,courgette,zucchini,aubergine,haricot vert,mais en epi,radis,betterave,persil,coriandre,basilic,menthe,ciboulette,aneth,gingembre,legume,fruit,petits fruits,cerise,peche,nectarine,prune,pamplemousse,grenade,roquette,kale,asperge,poireau,courge,citrouille,navet,panais,germe,fines herbes',
  pain: 'pain,baguette,croissant,bagel,tortilla,wrap,pita,muffin,brioche,naan,chausson,gateau,pain hamburger,pain hot-dog,pain a hot-dog,pain tranche,petit pain,english muffin,croute a pizza',
  viande: 'poulet,boeuf,porc,jambon,bacon,saucisse,saucisson,steak,viande,boeuf hache,porc hache,hache,dinde,agneau,veau,saumon,truite,poisson,crevette,petoncle,homard,tilapia,morue,aiglefin,filet,cotelette,cuisse,poitrine,aile,roti,pepperoni,salami,charcuterie,tofu,smoked meat,creton,pate de foie,hot-dog,wiener',
  laitier: 'lait,creme,creme sure,creme fouettee,beurre,fromage,yogourt,yaourt,oeuf,cheddar,mozzarella,parmesan,feta,cottage,ricotta,brie,camembert,suisse,gouda,margarine,kefir,fromage en grains,lait d\'avoine,lait d\'amande,boisson d\'amande,boisson de soya,fromage a la creme,philadelphia',
  epicerie: 'pate,pates,spaghetti,macaroni,penne,fusilli,lasagne,nouille,riz,quinoa,couscous,farine,sucre,cassonade,sel,poivre,huile,huile d\'olive,vinaigre,sauce,sauce tomate,sauce soya,ketchup,moutarde,mayonnaise,mayo,relish,conserve,soupe,bouillon,cereale,cereales,gruau,avoine,miel,sirop,sirop d\'erable,confiture,beurre d\'arachide,nutella,epice,cannelle,paprika,cumin,origan,thon,sardine,haricots,feves,lentille,pois chiche,noix,amande,arachide,cafe,the,tisane,levure,bicarbonate,poudre a pate,pate de tomate,tomates en des,lait de coco,cornichon,olive,salsa,vanille,chapelure,bouillon de poulet,kraft dinner,pouding,jello,gelee',
  collation: 'chips,croustille,croustilles,biscuit,biscuits,craquelin,craquelins,chocolat,bonbon,bonbons,popcorn,mais souffle,barre tendre,barre granola,barre,noix melangees,gomme,jujube,reglisse,bretzel,nachos,doritos,oreo,dessert',
  boisson: 'jus,jus d\'orange,eau,eau gazeuse,eau petillante,liqueur,boisson gazeuse,boisson,biere,vin,cidre,kombucha,gatorade,perrier,cola,coke,pepsi,limonade,the glace,boisson energisante',
  surgele: 'surgele,surgeles,congele,congeles,glace,creme glacee,pizza,frites,pizza congelee,popsicle,sorbet,legumes surgeles,fruits congeles,pogo,croquettes,nuggets,lasagne congelee,gaufre',
  hygiene: 'savon,savon a main,gel douche,shampoing,shampooing,revitalisant,dentifrice,brosse a dent,brosse a dents,soie dentaire,rince-bouche,deodorant,rasoir,lame,papier de toilette,papier toilette,papier hygienique,mouchoir,mouchoirs,kleenex,coton,coton-tige,q-tips,tampon,tampons,serviette sanitaire,serviettes sanitaires,creme solaire,lotion,creme hydratante,maquillage,vernis',
  menage: 'detergent,detersif,savon a vaisselle,savon a linge,tablette lave-vaisselle,lave-vaisselle,javel,eau de javel,nettoyant,windex,lysol,essuie-tout,papier essuie-tout,sac poubelle,sacs poubelle,sac a ordures,sacs a ordures,sac compost,sacs compost,sacs ziploc,ziploc,papier aluminium,papier d\'aluminium,papier parchemin,pellicule,pellicule plastique,eponge,eponges,assouplissant,feuilles assouplissantes,ampoule,pile,piles,chiffon,gants',
  pharma: 'tylenol,advil,motrin,ibuprofene,acetaminophene,vitamine,vitamines,medicament,pansement,diachylon,sirop contre la toux,antihistaminique,reactine,gravol,thermometre,ordonnance',
  bebe: 'couche,couches,lingette,lingettes,lait maternise,formule,puree bebe,nourriture pour chat,nourriture pour chien,bouffe a chat,bouffe a chien,litiere,gateries,croquettes pour chat,croquettes pour chien'
};
const norm = (s) => String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
// Clé d'un article : sans quantités ni unités (« 2 x Lait 2 % 4L » → « lait »).
function itemKey(text) {
  return norm(text)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(x|%|kg|g|lb|lbs|l|ml|oz|un|pqt|paquet|paquets|boite|boites|sac|sacs|douzaine)?\b/g, ' ')
    .replace(/^(x|de|des|du|la|le|les|un|une)\s+/, '')
    .replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 80);
}
const KW_LIST = Object.entries(KW).flatMap(([cat, list]) => list.split(',').map((k) => [norm(k), cat])).sort((a, b) => b[0].length - a[0].length);
function guessAisle(text) {
  const k = itemKey(text);
  if (!k) return 'autre';
  const mem = state.catmap.find((c) => c.id === docId(k));
  if (mem && AISLE[mem.cat]) return mem.cat;
  for (const [kw, cat] of KW_LIST) {
    const re = new RegExp(`(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|x)?($|[^a-z])`);
    if (re.test(k)) return cat;
  }
  return 'autre';
}
// Identifiant de document Firestore sûr à partir d'une clé d'article.
const docId = (k) => k.replace(/[^a-z0-9-]/g, '_').slice(0, 120) || '_';

function sortedLists() { return [...state.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }

function addItem(text, listId = state.currentList) {
  text = text.trim();
  if (!text || !listId) return;
  const cat = guessAisle(text);
  write(store.add('items', { listId, text, done: false, by: state.me.name, byEmail: keyOf(state.me.email), cat, createdAt: now() }));
  bumpFreq(text, cat);
  notifyShopper(text, listId);
}

// Articles fréquents : un compteur par article.
function bumpFreq(text, cat) {
  const k = itemKey(text);
  if (!k) return;
  const id = docId(k);
  const prev = state.freq.find((f) => f.id === id);
  write(store.set('freq', id, { text: prev?.text && prev.count > 1 ? prev.text : text, count: (prev?.count || 0) + 1, last: now(), cat, hidden: false }));
}
function frequentFor(listId) {
  const inList = new Set(state.items.filter((i) => i.listId === listId && !i.done).map((i) => docId(itemKey(i.text))));
  const day = 86400000;
  return state.freq
    .filter((f) => !f.hidden && f.count >= 2 && !inList.has(f.id) && !inList.has(docId(itemKey(f.text))))
    .map((f) => ({ ...f, score: f.count / (1 + (now() - (f.last || 0)) / (30 * day)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function renderLists() {
  if (!state.loaded.lists) return;
  const lists = sortedLists();
  const empty = lists.length === 0;
  $('#lists-empty').hidden = !empty;
  $('#list-body').hidden = empty;
  $('.chips-row').hidden = empty;
  if (empty) { $('#shop-banner').hidden = true; return; }

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
  const byAisle = cur.sort !== 'recent';
  $('#item-input').placeholder = `Ajouter à « ${cur.name} »…`;

  renderShopping(cur);

  // Pastilles « souvent achetés »
  const freq = frequentFor(cur.id);
  const fr = $('#freq-row');
  fr.hidden = !freq.length;
  fr.innerHTML = freq.length ? `<div class="freq-title">Souvent achetés</div><div class="chips freq">${freq.map((f) => `<button class="chip small" data-freq="${esc(f.id)}">+ ${esc(f.text)}</button>`).join('')}</div>` : '';
  $('#freq-list').innerHTML = state.freq.filter((f) => !f.hidden).slice(0, 300).map((f) => `<option value="${esc(f.text)}"></option>`).join('');

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
  if (byAisle && todo.length) {
    const groups = {};
    todo.forEach((i) => { const c = AISLE[i.cat] ? i.cat : guessAisle(i.text); (groups[c] ||= []).push(i); });
    const order = Object.keys(groups).sort((a, b) => AISLE[a].order - AISLE[b].order);
    ul.className = 'aisles';
    ul.innerHTML = order.map((c) => `
      <li class="aisle"><div class="aisle-head">${AISLE[c].emoji} ${esc(AISLE[c].name)} <span>${groups[c].length}</span></div>
        <ul class="items">${groups[c].sort((a, b) => a.text.localeCompare(b.text, 'fr')).map(itemHTML).join('')}</ul></li>`).join('');
  } else {
    ul.className = 'items';
    ul.innerHTML = todo.map(itemHTML).join('');
  }

  const ds = $('#done-section');
  const hint = byAisle && todo.length && !ls.get('nd-hint-aisle') ? `<p class="hint">💡 Appui long sur un article pour le modifier ou changer son rayon. <button class="link-btn" data-hint-ok>OK</button></p>` : '';
  if (!todo.length && !done.length) {
    ds.innerHTML = `<div class="empty"><div class="empty-emoji">✨</div><p>Liste vide. Ajoute un premier article ci-dessus.</p></div>`;
  } else if (!todo.length && done.length) {
    ds.innerHTML = `<div class="empty" style="padding:20px"><p>Tout est coché 🎉</p></div>` + doneBlock(done, itemHTML);
  } else {
    ds.innerHTML = hint + (done.length ? doneBlock(done, itemHTML) : '');
  }

  const onItemClick = (e) => {
    if (suppressClick) { suppressClick = false; return; }
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
    if (e.target.closest('[data-hint-ok]')) { ls.set('nd-hint-aisle', true); return renderLists(); }
    if (e.target.closest('.toggle-done')) { state.showDone = !state.showDone; ls.set('nd-showdone', state.showDone); return renderLists(); }
    if (e.target.closest('.clear-done')) {
      const ids = done.map((i) => i.id);
      write(store.removeMany('items', ids));
      toast(`${ids.length} article${ids.length > 1 ? 's' : ''} retiré${ids.length > 1 ? 's' : ''}`);
      return;
    }
    onItemClick(e);
  };
  fr.onclick = (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const b = e.target.closest('[data-freq]'); if (!b) return;
    const f = state.freq.find((x) => x.id === b.dataset.freq);
    if (f) { addItem(f.text); toast(`« ${f.text} » ajouté`); }
  };
}

// Appui long : sur un article (modifier / rayon) ou une pastille fréquente (retirer des suggestions).
let suppressClick = false;
function wireLongPress(root) {
  let timer = null, startX = 0, startY = 0;
  root.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.item, [data-freq]');
    if (!target) return;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 800);
      if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
      if (target.dataset.freq) freqMenu(target.dataset.freq);
      else itemSheet(state.items.find((i) => i.id === target.dataset.id));
    }, 500);
  });
  const cancel = (e) => { if (timer && (e.type !== 'pointermove' || Math.hypot(e.clientX - startX, e.clientY - startY) > 10)) { clearTimeout(timer); timer = null; } };
  ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach((t) => root.addEventListener(t, cancel));
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.item, [data-freq]')) e.preventDefault(); });
}

function itemSheet(it) {
  if (!it) return;
  const cur = AISLE[it.cat] ? it.cat : guessAisle(it.text);
  const close = openSheet(`
    <h2>Modifier l'article</h2>
    <form id="f-item" autocomplete="off">
      <label class="field"><span>Article</span><input name="text" required maxlength="200" value="${esc(it.text)}"></label>
      <div class="field"><span>Rayon</span>
        <div class="aisle-pick">${AISLES.map(([k, e, n]) => `<button type="button" data-cat="${k}" class="${k === cur ? 'sel' : ''}">${e} ${esc(n)}</button>`).join('')}</div>
      </div>
      <div class="actions"><button type="button" class="btn danger" id="i-del">Supprimer</button><span class="spacer"></span><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`);
  const f = $('#f-item');
  let cat = cur;
  $('.aisle-pick').onclick = (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    cat = b.dataset.cat;
    $$('.aisle-pick button').forEach((x) => x.classList.toggle('sel', x === b));
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const text = f.text.value.trim();
    if (!text) return;
    write(store.update('items', it.id, { text, cat }));
    if (cat !== cur || text !== it.text) {
      const k = itemKey(text);
      // On retient le rayon choisi pour la prochaine fois.
      if (k && cat !== cur) write(store.set('catmap', docId(k), { cat, text }));
    }
    close();
  };
  $('#i-del').onclick = () => { close(); write(store.remove('items', it.id)); toast(`« ${it.text} » supprimé`); };
}

async function freqMenu(id) {
  const f = state.freq.find((x) => x.id === id);
  if (!f) return;
  if (await confirmSheet(`Retirer « ${f.text} » des suggestions ?`, 'Il ne sera plus proposé dans « Souvent achetés ». S\'il est ajouté souvent à nouveau, il reviendra.', 'Retirer')) {
    write(store.set('freq', id, { hidden: true, count: 0 }));
  }
}

// ── « Je pars à l'épicerie » ──
// Chaque personne a un document pings/<courriel> : le dernier départ annoncé.
const PING_TTL = 2 * 3600000;
function activePing(fromMe) {
  const me = keyOf(state.me.email);
  return state.pings
    .filter((p) => (fromMe ? p.id === me : p.id !== me) && now() - (p.at || 0) < PING_TTL && !p.done)
    .sort((a, b) => b.at - a.at)[0];
}
function renderShopping(cur) {
  const other = activePing(false);
  const mine = activePing(true);
  const banner = $('#shop-banner');
  const dismissed = ls.get('nd-ping-dismissed', 0);
  if (other && other.at > dismissed) {
    banner.hidden = false;
    banner.innerHTML = `<span>🛒 <b>${esc(nameOf(other.id))}</b> part à l'épicerie${other.listName ? ` (${esc(other.listName)})` : ''} · ${timeAgo(other.at)}.<br>Ajoute ce qui manque !</span><button class="link-btn" data-ping-ok>OK</button>`;
    banner.onclick = (e) => { if (e.target.closest('[data-ping-ok]')) { ls.set('nd-ping-dismissed', other.at); renderLists(); } };
  } else banner.hidden = true;

  const btn = $('#btn-shop');
  btn.classList.toggle('active', !!mine);
  btn.innerHTML = mine
    ? `<span>🛒 Tu es à l'épicerie · prévenu ${timeAgo(mine.at)}</span><b>J'ai fini</b>`
    : `<span>🛒 Je pars à l'épicerie</span><b>Prévenir ${esc(otherName())}</b>`;
}
function otherName() {
  const o = people().find((p) => p.email !== keyOf(state.me.email));
  return o ? o.name : "l'autre";
}

// ── SMS : chacun entre SON numéro et SON message dans les Réglages ──
const DEFAULT_SMS = "🛒 Je pars à l'épicerie ({liste}). Besoin de quelque chose ? Ajoute-le dans Nous deux !";
const myProfile = () => state.profiles.find((p) => p.id === keyOf(state.me.email)) || {};
const otherProfile = () => state.profiles.find((p) => p.id !== keyOf(state.me.email)) || null;
function normPhone(s) {
  let d = String(s || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(d)) d = '+1' + d;
  else if (/^1\d{10}$/.test(d)) d = '+' + d;
  return d;
}
function fmtPhone(s) {
  const m = String(s || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `${m[1]} ${m[2]}-${m[3]}` : (s || '');
}
function smsText(listName) {
  const tpl = myProfile().shopMsg || DEFAULT_SMS;
  const other = otherProfile();
  return tpl
    .replace(/\{liste\}/gi, listName || 'épicerie')
    .replace(/\{prénom\}|\{prenom\}/gi, other?.name || '')
    .replace(/\s+\(\)/g, '').trim();
}
function openSms(listName) {
  const other = otherProfile();
  const to = other?.phone ? encodeURIComponent(other.phone) : '';
  // Android ouvre l'appli Messages avec le numéro et le texte déjà remplis.
  location.href = `sms:${to}?body=${encodeURIComponent(smsText(listName))}`;
}

async function startShopping() {
  const cur = state.lists.find((l) => l.id === state.currentList);
  const me = keyOf(state.me.email);
  const mine = activePing(true);
  if (mine) { write(store.set('pings', me, { done: true })); toast('Bonne fin de journée 🛍️'); return; }
  // Le SMS doit s'ouvrir tout de suite, pendant le toucher (Android l'exige).
  const sms = myProfile().smsOn !== false && !DEMO;
  if (sms) openSms(cur?.name || '');
  write(store.set('pings', me, { at: now(), listId: cur?.id || null, listName: cur?.name || '', done: false }));
  const sent = await pushNow({ kind: 'shopping', listName: cur?.name || '' });
  if (!sms) toast(sent ? `${otherName()} a reçu une notification ✓` : `${otherName()} le verra en ouvrant l'appli ✓`);
  else if (DEMO) toast('Mode démo : Messages s\'ouvrirait ici');
}

function smsSheet() {
  const p = myProfile();
  const other = otherProfile();
  const close = openSheet(`
    <h2>SMS « Je pars à l'épicerie »</h2>
    <form id="f-sms" autocomplete="off">
      <label class="check"><input type="checkbox" name="on" ${p.smsOn !== false ? 'checked' : ''}> Ouvrir Messages quand je touche le bouton</label>
      <label class="field"><span>Mon numéro de cellulaire</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="514 555-1234" value="${esc(fmtPhone(p.phone))}"></label>
      <p class="muted tiny">C'est ${other ? esc(other.name) : "l'autre"} qui l'utilisera pour t'écrire. ${other ? (other.phone ? `✓ Le numéro de ${esc(other.name)} est déjà enregistré.` : `${esc(other.name)} n'a pas encore entré son numéro : Messages s'ouvrira sans destinataire.`) : ''}</p>
      <label class="field"><span>Mon message</span><textarea name="msg" rows="3" maxlength="300">${esc(p.shopMsg || DEFAULT_SMS)}</textarea></label>
      <div class="tags">Insérer : <button type="button" data-tag="{liste}">{liste}</button> <button type="button" data-tag="{prénom}">{prénom}</button> <button type="button" class="link-btn" data-reset>Message par défaut</button></div>
      <div class="preview"><span>Aperçu</span><p id="sms-prev"></p></div>
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`);
  const f = $('#f-sms');
  const prev = () => {
    const tpl = f.msg.value || DEFAULT_SMS;
    const cur = state.lists.find((l) => l.id === state.currentList);
    $('#sms-prev').textContent = tpl.replace(/\{liste\}/gi, cur?.name || 'Épicerie').replace(/\{prénom\}|\{prenom\}/gi, other?.name || 'Elle');
  };
  f.msg.oninput = prev; prev();
  $('.tags').onclick = (e) => {
    const t = e.target.closest('[data-tag]');
    if (t) { const i = f.msg.selectionStart ?? f.msg.value.length; f.msg.value = f.msg.value.slice(0, i) + t.dataset.tag + f.msg.value.slice(f.msg.selectionEnd ?? i); f.msg.focus(); prev(); }
    if (e.target.closest('[data-reset]')) { f.msg.value = DEFAULT_SMS; prev(); }
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const phone = normPhone(f.phone.value);
    if (f.phone.value.trim() && !/^\+\d{8,15}$/.test(phone)) { f.phone.focus(); return toast('Numéro invalide'); }
    const msg = f.msg.value.trim();
    write(store.set('profiles', keyOf(state.me.email), { phone, shopMsg: msg && msg !== DEFAULT_SMS ? msg : '', smsOn: f.on.checked, updatedAt: now() }));
    close();
    toast('Enregistré ✓');
  };
}

// Quand l'autre est à l'épicerie et que j'ajoute un article, on le prévient tout de suite.
let addedQueue = [], addedTimer = null;
function notifyShopper(text, listId) {
  const p = activePing(false);
  if (!p || !PUSH_URL) return;
  addedQueue.push(text);
  clearTimeout(addedTimer);
  addedTimer = setTimeout(() => {
    const items = addedQueue.splice(0);
    const list = state.lists.find((l) => l.id === listId);
    pushNow({ kind: 'added', items, listName: list?.name || '' });
  }, 4000); // regroupe les ajouts faits d'affilée
}

// Notification instantanée via le petit service « Worker » (optionnel, voir guide).
async function pushNow(payload) {
  if (!PUSH_URL || DEMO || !fb?.auth?.currentUser) return false;
  try {
    const idToken = await fb.auth.currentUser.getIdToken();
    const res = await fetch(PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, idToken }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) console.warn('push', out);
    return res.ok && out.sent > 0;
  } catch (e) { console.warn('push', e); return false; }
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
  const byAisle = l.sort !== 'recent';
  const close = openSheet(`
    <h2>${esc(l.name)}</h2>
    <div class="menu-list">
      <button data-a="sort">${byAisle ? '🕒 Trier par ordre d\'ajout' : '🥦 Trier par rayon'}</button>
      <button data-a="rename">✏️ Renommer la liste</button>
      <button data-a="uncheck">↺ Tout décocher</button>
      <button data-a="delete" class="danger">🗑️ Supprimer la liste</button>
    </div>`);
  $('#sheet .menu-list').onclick = async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    close();
    if (a === 'sort') write(store.update('lists', id, { sort: byAisle ? 'recent' : 'aisle' }));
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
  renderFilms();
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

// ───────────────────────── FILMS (TMDB) ─────────────────────────
// Données : The Movie Database (TMDB). « Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB. »
const TMDB_KEY = self.TMDB_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const DEMO_MOVIES = [
  { id: 438631, media_type: 'movie', title: 'Dune', release_date: '2021-09-15', vote_average: 7.8, overview: "Paul Atréides, jeune homme brillant au destin hors du commun, doit se rendre sur la planète la plus dangereuse de l'univers.", poster_path: null },
  { id: 693134, media_type: 'movie', title: 'Dune : Deuxième partie', release_date: '2024-02-27', vote_average: 8.2, overview: "Paul Atréides s'unit à Chani et aux Fremen pour mener la révolte.", poster_path: null },
  { id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20', vote_average: 8.9, overview: 'Un professeur de chimie atteint d\'un cancer se lance dans la fabrication de méthamphétamine.', poster_path: null },
  { id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-15', vote_average: 8.4, overview: 'Dom Cobb est un voleur expérimenté dans l\'art périlleux de l\'extraction.', poster_path: null }
];

async function tmdb(path, params = {}) {
  if (!TMDB_KEY) throw new Error('nokey');
  const url = new URL('https://api.themoviedb.org/3' + path);
  Object.entries({ language: 'fr-CA', ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = {};
  if (TMDB_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + TMDB_KEY; // jeton « lecture » (v4)
  else url.searchParams.set('api_key', TMDB_KEY);                               // clé classique (v3)
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('tmdb ' + r.status);
  return r.json();
}

function poster(path, size = 'w185') {
  return path ? `<img src="${TMDB_IMG}${size}${esc(path)}" alt="" loading="lazy">` : `<div class="noposter">🎬</div>`;
}
const mTitle = (r) => r.title || r.name || '';
const mYear = (r) => String(r.release_date || r.first_air_date || '').slice(0, 4);

function renderFilms() {
  const v = $('#v-films');
  if (!v) return;
  const view = state.filmView;
  const all = state.movies;
  const towatch = all.filter((m) => m.status !== 'seen').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const seen = all.filter((m) => m.status === 'seen').sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
  const list = view === 'seen' ? seen : towatch;

  $('#films-seg').innerHTML = `
    <button data-fview="towatch" class="${view !== 'seen' ? 'on' : ''}">À voir${towatch.length ? ` (${towatch.length})` : ''}</button>
    <button data-fview="seen" class="${view === 'seen' ? 'on' : ''}">Vus${seen.length ? ` (${seen.length})` : ''}</button>`;
  $('#btn-pick').hidden = view === 'seen' || towatch.length < 2;

  const me = keyOf(state.me.email);
  $('#films-grid').innerHTML = list.map((m) => {
    const votes = Object.entries(m.votes || {}).filter(([, v]) => v);
    return `
      <button class="film" data-mid="${esc(m.id)}">
        <div class="pst">${poster(m.poster)}<span class="type">${m.type === 'tv' ? 'Série' : 'Film'}</span>${m.rating ? `<span class="rate">★ ${Number(m.rating).toFixed(1)}</span>` : ''}</div>
        <div class="ft">${esc(m.title)}</div>
        <div class="fs">${esc(m.year || '')}${view === 'seen' && votes.length ? ' · ' + votes.map(([e, v]) => `${esc(nameOf(e).charAt(0))}${v > 0 ? '👍' : '👎'}`).join(' ') : (m.addedBy && m.addedBy !== me ? ' · par ' + esc(nameOf(m.addedBy)) : '')}</div>
      </button>`;
  }).join('');
  $('#films-empty').hidden = list.length > 0;
  $('#films-empty').innerHTML = view === 'seen'
    ? '<div class="empty-emoji">🍿</div><p>Aucun film vu pour l\'instant.</p>'
    : `<div class="empty-emoji">🎬</div><p>Cherchez un film ou une série ci-dessus<br>pour l'ajouter à votre liste « À voir ».</p>${TMDB_KEY || DEMO ? '' : '<p class="error">Clé TMDB manquante dans config.js (voir le guide).</p>'}`;
}

let searchTimer = null, searchSeq = 0;
function wireFilms() {
  const input = $('#film-search');
  const box = $('#film-results');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    searchTimer = setTimeout(() => runSearch(q), 350);
  });
  $('#film-search-form').onsubmit = (e) => { e.preventDefault(); const q = input.value.trim(); if (q) runSearch(q); input.blur(); };
  box.onclick = (e) => {
    const b = e.target.closest('[data-add]');
    const row = e.target.closest('[data-res]');
    if (!row) return;
    const r = lastResults[Number(row.dataset.res)];
    if (b) { addMovie(r); b.textContent = '✓ Ajouté'; b.disabled = true; }
    else filmDetail(null, r);
  };
  $('#films-seg').onclick = (e) => {
    const b = e.target.closest('[data-fview]');
    if (b) { state.filmView = b.dataset.fview; renderFilms(); }
  };
  $('#films-grid').onclick = (e) => {
    const c = e.target.closest('[data-mid]');
    if (c) filmDetail(state.movies.find((m) => m.id === c.dataset.mid));
  };
  $('#btn-pick').onclick = pickMovie;
  document.addEventListener('click', (e) => { if (!e.target.closest('#film-search-form, #film-results')) { box.hidden = true; } });
  input.addEventListener('focus', () => { if (box.innerHTML) box.hidden = false; });
}

let lastResults = [];
async function runSearch(q) {
  const seq = ++searchSeq;
  const box = $('#film-results');
  box.hidden = false;
  box.innerHTML = '<div class="res-msg">Recherche…</div>';
  let results;
  try {
    if (!TMDB_KEY && DEMO) results = DEMO_MOVIES.filter((m) => norm(mTitle(m)).includes(norm(q)));
    else results = ((await tmdb('/search/multi', { query: q, include_adult: 'false', region: 'CA' })).results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
  } catch (e) {
    if (seq !== searchSeq) return;
    box.innerHTML = `<div class="res-msg error">${e.message === 'nokey' ? 'Clé TMDB manquante dans config.js (voir le guide).' : 'Recherche impossible. Vérifie la connexion ou la clé TMDB.'}</div>`;
    return;
  }
  if (seq !== searchSeq) return;
  lastResults = results.slice(0, 12);
  const have = new Set(state.movies.map((m) => m.type + ':' + m.tmdbId));
  box.innerHTML = lastResults.length ? lastResults.map((r, i) => `
    <div class="res" data-res="${i}">
      <div class="rp">${poster(r.poster_path, 'w92')}</div>
      <div class="ri"><b>${esc(mTitle(r))}</b><span>${r.media_type === 'tv' ? 'Série' : 'Film'}${mYear(r) ? ' · ' + mYear(r) : ''}${r.vote_average ? ' · ★ ' + r.vote_average.toFixed(1) : ''}</span></div>
      ${have.has(r.media_type + ':' + r.id) ? '<button class="btn small" disabled>✓ Déjà là</button>' : '<button class="btn small primary" data-add>+ À voir</button>'}
    </div>`).join('') + '<div class="tmdb-credit">Données : TMDB</div>' : '<div class="res-msg">Aucun résultat.</div>';
}

function addMovie(r) {
  const doc = {
    tmdbId: r.id, type: r.media_type === 'tv' ? 'tv' : 'movie', title: mTitle(r), year: mYear(r),
    poster: r.poster_path || null, overview: String(r.overview || '').slice(0, 1200), rating: r.vote_average || null,
    status: 'towatch', addedBy: keyOf(state.me.email), addedAt: now(), votes: {}
  };
  write(store.add('movies', doc));
  toast(`« ${doc.title} » ajouté à À voir ✓`);
}

async function filmDetail(m, r) {
  // m : film de notre liste ; r : résultat de recherche pas encore ajouté
  const data = m || { tmdbId: r.id, type: r.media_type === 'tv' ? 'tv' : 'movie', title: mTitle(r), year: mYear(r), poster: r.poster_path, overview: r.overview, rating: r.vote_average };
  const me = keyOf(state.me.email);
  const myVote = m?.votes?.[me] || 0;
  const close = openSheet(`
    <div class="fd">
      <div class="fd-top">
        <div class="fd-p">${poster(data.poster, 'w342')}</div>
        <div>
          <h2>${esc(data.title)}</h2>
          <p class="muted">${data.type === 'tv' ? 'Série' : 'Film'}${data.year ? ' · ' + esc(data.year) : ''}${data.rating ? ' · ★ ' + Number(data.rating).toFixed(1) : ''}</p>
          <div id="fd-extra" class="muted tiny">…</div>
        </div>
      </div>
      ${data.overview ? `<p class="fd-ov">${esc(data.overview)}</p>` : ''}
      <div id="fd-where"></div>
      ${m && m.status === 'seen' ? `
        <div class="fd-votes"><span>Ton avis :</span>
          <button data-vote="1" class="${myVote > 0 ? 'sel' : ''}">👍 Aimé</button>
          <button data-vote="-1" class="${myVote < 0 ? 'sel' : ''}">👎 Bof</button>
        </div>
        ${Object.entries(m.votes || {}).filter(([e, v]) => e !== me && v).map(([e, v]) => `<p class="muted tiny">${esc(nameOf(e))} : ${v > 0 ? '👍 a aimé' : '👎 bof'}</p>`).join('')}` : ''}
      <div class="actions">
        ${m ? `<button class="btn danger" id="fd-del">Retirer</button><span class="spacer"></span>
               ${m.status === 'seen' ? '<button class="btn" id="fd-unseen">↺ À revoir</button>' : '<button class="btn primary" id="fd-seen">✓ On l\'a vu</button>'}`
            : `<span class="spacer"></span><button class="btn primary" id="fd-add">+ À voir</button>`}
      </div>
      <p class="tmdb-credit">Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB. Diffusion : JustWatch.</p>
    </div>`);
  if (m) {
    $('#fd-del').onclick = async () => { close(); if (await confirmSheet(`Retirer « ${m.title} » ?`, '', 'Retirer')) write(store.remove('movies', m.id)); };
    $('#fd-seen') && ($('#fd-seen').onclick = () => { write(store.update('movies', m.id, { status: 'seen', seenAt: now() })); close(); toast('Bon film ? Donne ton avis dans « Vus » 🍿'); });
    $('#fd-unseen') && ($('#fd-unseen').onclick = () => { write(store.update('movies', m.id, { status: 'towatch', seenAt: null })); close(); });
    $$('#sheet [data-vote]').forEach((b) => (b.onclick = () => {
      const v = Number(b.dataset.vote);
      write(store.update('movies', m.id, { votes: { ...(m.votes || {}), [me]: myVote === v ? 0 : v } }));
      close();
    }));
  } else $('#fd-add').onclick = () => { addMovie(r); close(); };

  // Détails : durée / saisons, genres, où regarder au Canada.
  if (!TMDB_KEY) { $('#fd-extra').textContent = ''; return; }
  try {
    const [det, prov] = await Promise.all([
      tmdb(`/${data.type}/${data.tmdbId}`),
      tmdb(`/${data.type}/${data.tmdbId}/watch/providers`).catch(() => null)
    ]);
    const ex = $('#fd-extra'); if (!ex) return;
    const bits = [];
    if (det.runtime) bits.push(`${Math.floor(det.runtime / 60)} h ${String(det.runtime % 60).padStart(2, '0')}`);
    if (det.number_of_seasons) bits.push(`${det.number_of_seasons} saison${det.number_of_seasons > 1 ? 's' : ''}`);
    if (det.genres?.length) bits.push(det.genres.slice(0, 3).map((g) => g.name).join(', '));
    ex.textContent = bits.join(' · ');
    const ca = prov?.results?.CA;
    const subs = ca?.flatrate || [];
    const rent = [...(ca?.rent || []), ...(ca?.buy || [])].filter((p, i, a) => a.findIndex((x) => x.provider_id === p.provider_id) === i);
    const where = $('#fd-where'); if (!where) return;
    where.innerHTML = (subs.length || rent.length) ? `
      ${subs.length ? `<div class="where"><span>📺 Inclus avec</span>${subs.slice(0, 6).map((p) => `<span class="prov"><img src="${TMDB_IMG}w45${esc(p.logo_path)}" alt="">${esc(p.provider_name)}</span>`).join('')}</div>` : ''}
      ${rent.length ? `<div class="where"><span>💳 Location / achat</span>${rent.slice(0, 4).map((p) => `<span class="prov"><img src="${TMDB_IMG}w45${esc(p.logo_path)}" alt="">${esc(p.provider_name)}</span>`).join('')}</div>` : ''}`
      : '<p class="muted tiny">Pas offert en diffusion au Canada pour l\'instant.</p>';
  } catch { const ex = $('#fd-extra'); if (ex) ex.textContent = ''; }
}

function pickMovie() {
  const pool = state.movies.filter((m) => m.status !== 'seen');
  if (!pool.length) return;
  let last = null;
  const show = () => {
    let m;
    do { m = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && m === last);
    last = m;
    const close = openSheet(`
      <div class="pick">
        <p class="muted">Ce soir, on regarde…</p>
        <div class="pick-p">${poster(m.poster, 'w342')}</div>
        <h2>${esc(m.title)}</h2>
        <p class="muted">${m.type === 'tv' ? 'Série' : 'Film'}${m.year ? ' · ' + esc(m.year) : ''}</p>
        <div class="actions" style="justify-content:center"><button class="btn" id="pk-again">🎲 Un autre</button><button class="btn primary" id="pk-ok">🍿 Parfait !</button></div>
      </div>`);
    $('#pk-again').onclick = () => { close(); setTimeout(show, 80); };
    $('#pk-ok').onclick = () => { close(); filmDetail(m); };
  };
  show();
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
      <div><div class="t">SMS « Je pars à l'épicerie »</div><div class="d">${myProfile().smsOn === false ? 'Désactivé' : (myProfile().phone ? 'Mon numéro : ' + esc(fmtPhone(myProfile().phone)) : 'Entre ton numéro et ton message')}</div></div>
      <button class="btn small" id="s-sms">Modifier</button>
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
  $('#s-sms').onclick = smsSheet;
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && store) { renderBills(); renderLists(); } });
setInterval(() => { if (store && !document.hidden && state.tab === 'listes' && state.pings.length) renderLists(); }, 60000);

main();
