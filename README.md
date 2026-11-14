# Nous deux 💚

Une petite appli Android pour vous deux :

- **Listes** partagées (épicerie, Costco, pharmacie…), synchronisées en direct. Tu coches un article au magasin et il se coche aussi sur le téléphone de ta conjointe.
- **Notes** partagées (code Wi-Fi, idées cadeaux, recettes…), avec couleurs et épingles.
- **Factures** avec échéances, factures récurrentes (mensuelles, aux 2 semaines, annuelles…) et **notifications sur vos deux téléphones** avant l'échéance.

L'appli fonctionne aussi hors ligne, par exemple au sous-sol de l'épicerie. Tout se synchronise au retour du réseau.

**Coût : 0 $.** Firebase (gratuit, plan Spark) garde les données et envoie les notifications. GitHub (gratuit) héberge l'appli et lance les rappels chaque matin.

> 💡 **Pour l'essayer tout de suite :** ouvre `index.html` à travers un petit serveur local (ou publie-le sur GitHub Pages, étape 7) sans remplir `config.js`. L'appli démarre alors en **mode démo**, avec des données d'exemple gardées seulement sur l'appareil.

---

## Installation (environ 30 minutes, une seule fois)

Tu as besoin d'un ordinateur pour la configuration. Ensuite, tout se passe sur les téléphones.

### Étape 1 — Mettre les fichiers sur GitHub

1. Crée un compte gratuit sur <https://github.com> si tu n'en as pas.
2. Clique sur **+** › **New repository**. Nom : `nous-deux`, visibilité **Public**. C'est nécessaire pour l'hébergement gratuit, et vos données ne sont **pas** dans le dépôt : elles sont dans Firebase et protégées. Clique sur **Create repository**.
3. Clique sur **uploading an existing file**, glisse **tout le contenu** du dossier `nous-deux` dans la page, puis clique sur **Commit changes**.
4. ⚠️ Le dossier `.github` est caché sur certains ordinateurs et peut ne pas avoir été téléversé. Vérifie qu'il apparaît dans le dépôt. S'il est absent, clique sur **Add file › Create new file**, tape le nom `.github/workflows/rappels.yml`, colle le contenu du fichier `rappels.yml`, puis clique sur **Commit**.

### Étape 2 — Créer le projet Firebase

1. Va sur <https://console.firebase.google.com> avec ton compte Google, puis clique sur **Créer un projet**. Nom : `nous-deux`. Tu peux désactiver Google Analytics, ce n'est pas utile ici.
2. Sur la page d'accueil du projet, clique sur l'icône **Web `</>`**. Surnom : `nous-deux`. Ne coche **pas** « Firebase Hosting ». Clique sur **Enregistrer l'application**.
3. Firebase affiche un bloc `const firebaseConfig = { apiKey: "...", ... }`. Dans GitHub, ouvre `config.js` et clique sur le crayon ✏️. Copie chaque valeur entre les guillemets correspondants : `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`. Clique sur **Commit changes**.

> Ces valeurs ne sont pas secrètes. Ce sont les règles de l'étape 4 qui protègent vos données.

### Étape 3 — Créer vos deux comptes

1. Dans Firebase, va dans **Créer › Authentication › Commencer**.
2. Onglet **Mode de connexion** › **Adresse e-mail/Mot de passe** › active le premier interrupteur seulement › **Enregistrer**.
3. Onglet **Utilisateurs** › **Ajouter un utilisateur** : entre ton courriel et un mot de passe (au moins 6 caractères). Recommence pour ta conjointe, avec son adresse (Outlook, Gmail ou autre, peu importe).

> 🔒 Ne mets **jamais** les mots de passe dans `config.js` ou un autre fichier du dépôt : le dépôt est public, n'importe qui pourrait les lire. Donne son mot de passe à ta conjointe de vive voix ; elle pourra le changer avec « Mot de passe oublié ? ». Chrome propose d'enregistrer le mot de passe à la première connexion, et ensuite vous restez connectés.

*Facultatif — connexion avec Google en plus :* même onglet, active **Google**. Puis **Paramètres › Domaines autorisés › Ajouter un domaine** : `TONNOMGITHUB.github.io`.

### Étape 4 — Créer la base de données et la protéger

1. Va dans **Créer › Firestore Database › Créer une base de données**.
2. Emplacement : **`northamerica-northeast1 (Montréal)`**, puis **Suivant**. Choisis **Démarrer en mode production**, puis **Créer**.
3. Ouvre l'onglet **Règles**. Efface tout et colle le contenu de `firestore.rules`, puis **remplace les deux adresses** par les deux courriels de l'étape 3. Clique sur **Publier**.

> Seuls ces deux comptes peuvent lire et écrire vos données. Toute autre personne qui trouverait l'adresse de l'appli verra « Accès refusé ».

### Étape 5 — Clé pour les notifications

1. Dans Firebase, clique sur ⚙️ (en haut à gauche) › **Paramètres du projet** › onglet **Cloud Messaging**.
2. Vérifie que **API Firebase Cloud Messaging (V1)** est **activée**. Si ce n'est pas le cas, clique sur ⋮ › *Gérer l'API dans la console Google Cloud* › **Activer**.
3. Plus bas, dans **Configuration Web › Certificats Web Push**, clique sur **Générer une paire de clés**.
4. Copie la clé, une longue chaîne qui commence souvent par `B…`. Colle-la dans `config.js` sur GitHub, dans `self.VAPID_KEY = "…";`, puis clique sur **Commit**.

### Étape 6 — Autoriser GitHub à envoyer les rappels

1. Dans Firebase, va dans ⚙️ › **Paramètres du projet** › onglet **Comptes de service**, puis clique sur **Générer une nouvelle clé privée**. Un fichier `.json` est téléchargé.
2. Dans GitHub, ouvre ton dépôt et va dans **Settings › Secrets and variables › Actions › New repository secret**.
   - Name : `FIREBASE_SERVICE_ACCOUNT`
   - Secret : ouvre le fichier `.json` avec un éditeur de texte (Bloc-notes, TextEdit…), copie **tout** son contenu et colle-le ici.
   - Clique sur **Add secret**.
3. 🔒 **Supprime ensuite le fichier `.json` de ton ordinateur.** Ne le mets jamais dans le dépôt.

### Étape 7 — Publier l'appli

1. Dans GitHub, va dans **Settings › Pages**.
2. Source : **Deploy from a branch**, Branch : **main**, dossier **/ (root)**, puis clique sur **Save**.
3. Après 1 ou 2 minutes, l'adresse s'affiche : **`https://TONNOMGITHUB.github.io/nous-deux/`**.

### Étape 8 — Installer sur vos deux téléphones Android

Fais ces étapes sur ton téléphone, puis sur celui de ta conjointe :

1. Ouvre l'adresse de l'étape 7 dans **Chrome**.
2. Entre ton courriel et ton mot de passe (étape 3), puis touche **Se connecter**. Accepte quand Chrome propose d'enregistrer le mot de passe.
3. Installe l'appli : menu **⋮** de Chrome › **Installer l'application** (ou « Ajouter à l'écran d'accueil »). L'icône « Nous deux » apparaît avec tes applis.
4. Ouvre l'appli depuis l'icône, touche ⚙️ **Réglages › Rappels de factures › Activer**, puis **Autoriser**.
5. Touche **Tester** : une notification doit apparaître. ✅

### Étape 9 — Tester les rappels de factures

1. Dans l'appli, ajoute une facture avec une échéance **demain**.
2. Dans GitHub, va dans **Actions › Rappels de factures › Run workflow**. Si GitHub te le demande, active d'abord les workflows avec le bouton vert.
3. Après environ 30 secondes, vous recevez tous les deux la notification. Le journal de l'exécution montre ce qui a été envoyé.

Ensuite, c'est automatique : **chaque matin vers 8 h** (9 h l'été), vous recevez une notification :

- *X jours avant* l'échéance (le délai choisi dans « Me rappeler »),
- *la veille*,
- *le jour même*,
- puis, si elle est *en retard*, le lendemain et ensuite aux 3 jours, jusqu'à ce que quelqu'un touche **✓ Payée**.

Pour une facture récurrente, **✓ Payée** fait passer automatiquement l'échéance à la prochaine date (le mois suivant, par exemple).


### Étape 10 (optionnel) — Notifications instantanées

Les rappels de factures partent une fois par matin. Pour le bouton **« Je pars à l'épicerie »**, l'autre doit être prévenu **tout de suite**. Sans cette étape, le bouton fonctionne quand même : l'autre voit un bandeau en ouvrant l'appli. Avec elle, son téléphone reçoit une vraie notification instantanée. Et pendant que tu magasines, tu es averti dès qu'elle ajoute un article.

On utilise un petit service gratuit, un **Worker Cloudflare** (100 000 envois par jour gratuits, sans carte de crédit).

1. **Nouvelle clé Firebase :** Firebase › ⚙️ Paramètres › **Comptes de service** › **Générer une nouvelle clé privée**. Un fichier `.json` est téléchargé.
2. **Compte Cloudflare :** crée un compte gratuit sur <https://dash.cloudflare.com/sign-up>.
3. **Créer le Worker :** dans le menu de gauche, va dans **Compute (Workers)** › **Workers & Pages** › **Create** › **Start with Hello World!**. Nom : `nous-deux-push`, puis **Deploy**.
4. **Coller le code :** clique sur **Edit code**. Efface tout et colle le contenu du fichier `worker/worker.js`, puis clique sur **Deploy** (en haut à droite).
5. **Les réglages du Worker :** reviens à la page du Worker › **Settings** › **Variables and Secrets** › **Add**.
   - Type **Secret**, nom `FIREBASE_SERVICE_ACCOUNT`, valeur : **tout** le contenu du fichier `.json`.
   - Type **Text**, nom `ALLOWED_ORIGIN`, valeur : `https://TONNOMGITHUB.github.io` (sans `/nous-deux` à la fin).
   - Clique sur **Deploy** ou **Save**.
6. 🔒 Supprime le fichier `.json` de ton ordinateur.
7. **L'adresse du Worker :** elle est affichée sur sa page, du genre `https://nous-deux-push.TONNOM.workers.dev`. Ouvre-la dans ton navigateur : tu dois voir `{"ok":true,"service":"nous-deux-push"}`.
8. **Brancher l'appli :** sur GitHub, ouvre `config.js` ✏️ et ajoute cette ligne tout en bas :
   ```js
   self.PUSH_URL = "https://nous-deux-push.TONNOM.workers.dev";
   ```
   Puis clique sur **Commit changes**.

Dans l'appli, ⚙️ Réglages › « Notifications instantanées » indique alors **Activées**.

**Pour tester :** les deux téléphones doivent avoir touché **Activer** dans les Réglages. Ferme l'appli sur le téléphone de ta conjointe. Sur le tien, touche **🛒 Je pars à l'épicerie** : elle reçoit la notification en quelques secondes.

---

## Utilisation au quotidien

| Je veux… | Comment |
|---|---|
| Ajouter un article | Tape-le dans la barre du haut et appuie sur Entrée. Le clavier reste ouvert pour enchaîner les articles. |
| Cocher / décocher | Touche l'article. |
| Supprimer un article | Touche le **×**. Le bouton « Annuler » permet de le récupérer pendant 5 secondes. |
| Vider les articles achetés | **Retirer les cochés**. |
| Créer une autre liste | La pastille **+ Liste**. |
| Renommer ou supprimer une liste | Touche la pastille de la liste **déjà sélectionnée**. |
| Modifier une facture | Touche la facture. |
| Marquer une facture payée | **✓ Payée**, puis confirme le montant et qui a payé. |
| Voir qui a payé quoi | Factures › **Bilan**. |
| Prévenir l'autre que je pars à l'épicerie | **🛒 Je pars à l'épicerie**, en haut de la liste. |
| Envoyer un SMS en partant | ⚙️ Réglages › **SMS « Je pars à l'épicerie »** : entre ton numéro et ton message, une seule fois. Ensuite, le bouton ouvre Messages avec tout déjà rempli. |
| Ajouter un article fréquent | Touche une pastille de **Souvent achetés**. |
| Changer le rayon d'un article | **Appui long** sur l'article. L'appli s'en souvient pour la prochaine fois. |
| Trier par ordre d'ajout plutôt que par rayon | Touche la pastille de la liste sélectionnée › **Trier par ordre d'ajout**. |

Le petit point à côté de ⚙️ est **vert** quand l'appli est synchronisée et **orange** quand elle est hors ligne. Les changements faits hors ligne sont envoyés automatiquement plus tard.

## Modifier l'appli plus tard

Change un fichier sur GitHub (le crayon ✏️), puis **Commit**. La nouvelle version arrive sur les téléphones à la prochaine ouverture de l'appli, parfois au bout de 2 ouvertures.

## Dépannage

- **« Courriel ou mot de passe incorrect »** : vérifie le compte dans Firebase › Authentication › Utilisateurs. Pour changer un mot de passe : « Mot de passe oublié ? » dans l'appli.
- **« La connexion par courriel n'est pas activée »** : refais l'étape 3, point 2.
- **« Ce domaine n'est pas autorisé »** (connexion Google seulement) : ajoute le domaine, étape 3 (facultatif).
- **« Accès refusé »** : le courriel n'est pas exactement celui inscrit dans les règles (étape 4). Vérifie l'orthographe, en minuscules.
- **Pas de bouton « Activer » pour les notifications** : la clé `VAPID_KEY` est vide dans `config.js` (étape 5).
- **Notifications bloquées** : dans Android, va dans Paramètres › Applis › Nous deux (ou Chrome) › Notifications › Autoriser.
- **Aucun rappel le matin** : dans GitHub, va dans **Actions** et ouvre la dernière exécution pour lire le journal. Si c'est écrit « Aucun téléphone inscrit », refais l'étape 8, point 4.
- **Rappels en pause** : GitHub met en pause les tâches automatiques d'un dépôt public inactif depuis 60 jours. Le workflow fait lui-même un petit commit tous les 45 jours pour l'éviter. Si GitHub t'envoie quand même un courriel à ce sujet, va dans Actions › Rappels de factures › **Enable workflow**.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js`, `styles.css` | L'appli elle-même |
| `config.js` | **Tes** clés Firebase (étapes 2 et 5) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur le téléphone, mode hors ligne, notifications |
| `firestore.rules` | Qui a accès aux données (étape 4) |
| `scripts/send-reminders.mjs` | Calcule et envoie les rappels |
| `.github/workflows/rappels.yml` | Lance le script chaque matin |
