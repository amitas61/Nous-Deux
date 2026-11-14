// Envoie les rappels de factures sur vos téléphones.
// Lancé chaque matin par GitHub Actions (.github/workflows/rappels.yml).
//
// Règles d'envoi pour chaque facture non payée :
//   • X jours avant l'échéance (X = « Me rappeler » choisi dans l'appli)
//   • la veille
//   • le jour même
//   • en retard : le lendemain, puis aux 3 jours
// Une facture assignée à une seule personne ne notifie que ses téléphones ;
// une facture partagée (« Nous deux ») notifie tout le monde.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const TZ = 'America/Toronto';
const APP_URL = (process.env.APP_URL || '').replace(/\/?$/, '/');
const DRY_RUN = process.env.DRY_RUN === '1';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Secret FIREBASE_SERVICE_ACCOUNT manquant (README, étape 6).'); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const messaging = getMessaging();

const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysUntil = (iso) => Math.round((utc(iso) - utc(todayISO)) / 86400000);
const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const fmtDay = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function message(bill) {
  const d = daysUntil(bill.dueDate);
  const remind = Number(bill.remindDays ?? 3);
  let when = null;
  if (d === 0) when = "à payer aujourd'hui";
  else if (d === 1) when = 'à payer demain';
  else if (d > 1 && d === remind) when = `à payer dans ${d} jours (${fmtDay.format(new Date(utc(bill.dueDate)))})`;
  else if (d < 0 && (-d) % 3 === 1) when = `en retard de ${-d} jour${d < -1 ? 's' : ''}`;
  if (!when) return null;
  const amt = bill.amount != null && bill.amount !== '' ? `${money.format(Number(bill.amount))} — ` : '';
  return {
    title: `${d < 0 ? '⚠️' : '💸'} ${bill.name}`,
    body: `${amt}${when}${bill.note ? ` · ${bill.note}` : ''}`,
    tag: `bill-${bill.id}`,
    url: APP_URL ? `${APP_URL}#factures` : './#factures'
  };
}

const [billsSnap, tokensSnap] = await Promise.all([
  db.collection('bills').where('paid', '==', false).get(),
  db.collection('tokens').get()
]);
const tokenRows = tokensSnap.docs.map((d) => ({ token: d.id, email: String(d.get('email') || '').toLowerCase() }));
const tokens = tokenRows.map((t) => t.token);
console.log(`Aujourd'hui (${TZ}) : ${todayISO} · ${billsSnap.size} facture(s) à payer · ${tokens.length} téléphone(s)`);

const msgs = billsSnap.docs.map((d) => {
  const bill = { id: d.id, ...d.data() };
  const m = message(bill);
  if (!m) return null;
  const owner = bill.owner && bill.owner !== 'shared' ? String(bill.owner).toLowerCase() : null;
  const targets = owner ? tokenRows.filter((t) => t.email === owner).map((t) => t.token) : tokens;
  // Si la personne responsable n'a pas activé les rappels, on prévient tout le monde.
  return { m, targets: targets.length ? targets : tokens };
}).filter(Boolean);
if (!msgs.length) { console.log('Aucun rappel à envoyer aujourd\'hui.'); process.exit(0); }
if (!tokens.length) { console.log('Aucun téléphone inscrit : activez les rappels dans Réglages de l\'appli.'); process.exit(0); }

const dead = new Set();
for (const { m, targets } of msgs) {
  console.log(`→ ${m.title} : ${m.body}`);
  if (DRY_RUN) continue;
  const res = await messaging.sendEachForMulticast({
    tokens: targets,
    data: m,
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  });
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    console.warn(`  échec pour un téléphone : ${code}`);
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument')) dead.add(targets[i]);
  });
  console.log(`  envoyé à ${res.successCount}/${targets.length}`);
}
for (const t of dead) await db.collection('tokens').doc(t).delete();
if (dead.size) console.log(`${dead.size} ancien(s) jeton(s) supprimé(s).`);
