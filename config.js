// ─────────────────────────────────────────────────────────────
//  Configuration Firebase — à remplir (voir README.md, étape 2)
//  Tant que apiKey est vide, l'appli tourne en MODE DÉMO :
//  les données restent sur le téléphone et ne sont pas partagées.
//  (Ces valeurs ne sont pas secrètes : la sécurité vient des règles Firestore.)
// ─────────────────────────────────────────────────────────────
self.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Clé « Web Push » (Firebase › Paramètres du projet › Cloud Messaging ›
// Certificats Web Push › Paire de clés). Nécessaire pour les notifications.
self.VAPID_KEY = "";
