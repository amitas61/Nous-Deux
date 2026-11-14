// ─────────────────────────────────────────────────────────────
//  Nous deux — service de notifications instantanées
//  À coller dans un « Worker » Cloudflare (gratuit). Voir README, étape 10.
//
//  Variables à définir dans Cloudflare (Settings › Variables and Secrets) :
//    FIREBASE_SERVICE_ACCOUNT  (Secret) : le contenu complet du fichier .json
//    ALLOWED_ORIGIN            (Texte)  : https://TONNOMGITHUB.github.io
//
//  Sécurité : chaque demande doit venir d'une personne connectée à l'appli
//  (jeton Firebase vérifié) ET ayant un profil dans votre base. Les messages
//  sont construits ici, à partir de textes courts, et envoyés à l'autre personne.
// ─────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
    const cors = {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') return reply(200, { ok: true, service: 'nous-deux-push' });
    if (req.method !== 'POST') return reply(405, { error: 'method' });
    if (allowed && origin !== allowed) return reply(403, { error: 'origin' });

    let sa;
    try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { return reply(500, { error: 'FIREBASE_SERVICE_ACCOUNT manquant ou invalide' }); }
    const project = sa.project_id;

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: 'json' }); }

    // 1. Qui demande ? (jeton de connexion Firebase)
    let user;
    try { user = await verifyIdToken(body.idToken, project); } catch (e) { return reply(401, { error: 'auth', detail: String(e.message || e) }); }
    const email = String(user.email || '').toLowerCase();
    if (!email) return reply(401, { error: 'email' });

    try {
    const access = await getAccessToken(sa);
    const fsBase = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

    // 2. Est-ce bien l'un de vous deux ? (seuls les membres peuvent créer un profil)
    const prof = await fetch(`${fsBase}/profiles/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${access}` } });
    if (!prof.ok) return reply(403, { error: 'profil introuvable : ouvre l\'appli et entre ton prénom' });
    const profile = await prof.json();
    const name = clip(profile.fields?.name?.stringValue || email.split('@')[0], 30);

    // 3. Le message
    const listName = clip(body.listName || '', 40);
    let msg;
    if (body.kind === 'shopping') {
      msg = { title: `🛒 ${name} part à l'épicerie`, body: `Besoin de quelque chose ? Ajoute-le${listName ? ` à « ${listName} »` : ''} maintenant.`, tag: 'shopping', url: './#listes' };
    } else if (body.kind === 'added') {
      const items = (Array.isArray(body.items) ? body.items : []).map((t) => clip(t, 40)).filter(Boolean).slice(0, 10);
      if (!items.length) return reply(400, { error: 'items' });
      msg = { title: `📝 ${name} a ajouté ${items.length > 1 ? items.length + ' articles' : 'un article'}`, body: items.join(', '), tag: 'added', url: './#listes' };
    } else if (body.kind === 'note') {
      const text = clip(body.text || '', 140);
      if (!text) return reply(400, { error: 'text' });
      msg = { title: `💚 Un mot de ${name}`, body: text, tag: 'note', url: './' };
    } else return reply(400, { error: 'kind' });

    // 4. Les téléphones de l'autre personne
    const tl = await fetch(`${fsBase}/tokens?pageSize=300`, { headers: { Authorization: `Bearer ${access}` } });
    const docs = (await tl.json()).documents || [];
    const targets = docs
      .map((d) => ({ name: d.name, token: decodeURIComponent(d.name.split('/').pop()), email: String(d.fields?.email?.stringValue || '').toLowerCase() }))
      .filter((t) => t.email !== email);

    let sent = 0;
    for (const t of targets) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: t.token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '3600' } } } })
      });
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 400) {
        // Jeton périmé : on le retire.
        await fetch(`https://firestore.googleapis.com/v1/${t.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${access}` } });
      }
    }
    return reply(200, { sent, targets: targets.length });
    } catch (e) {
      return reply(500, { error: 'serveur', detail: String(e.message || e) });
    }
  }
};

const clip = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// ── Outils JWT (RS256) avec WebCrypto ──
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc.encode(s));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

let jwksCache = { keys: null, exp: 0 };
async function verifyIdToken(token, project) {
  if (!token || typeof token !== 'string') throw new Error('jeton manquant');
  const [h, p, s] = token.split('.');
  if (!s) throw new Error('jeton mal formé');
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  const t = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256') throw new Error('alg');
  if (payload.aud !== project || payload.iss !== `https://securetoken.google.com/${project}`) throw new Error('projet');
  if (!payload.exp || payload.exp < t - 60 || (payload.iat || 0) > t + 300) throw new Error('expiré');
  if (!payload.sub) throw new Error('sub');
  if (!jwksCache.keys || jwksCache.exp < Date.now()) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    jwksCache = { keys: (await r.json()).keys, exp: Date.now() + 3600000 };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('clé inconnue');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('signature');
  return payload;
}

let accessCache = { token: null, exp: 0 };
async function getAccessToken(sa) {
  if (accessCache.token && accessCache.exp > Date.now() + 60000) return accessCache.token;
  const t = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claim}`));
  const jwt = `${head}.${claim}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const out = await r.json();
  if (!out.access_token) throw new Error('accès Google refusé : ' + JSON.stringify(out));
  accessCache = { token: out.access_token, exp: Date.now() + (out.expires_in || 3600) * 1000 };
  return accessCache.token;
}
