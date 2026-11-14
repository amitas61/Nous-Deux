// ─────────────────────────────────────────────────────────────
//  Configuration Firebase — à remplir (voir README.md, étape 2)
//  Tant que apiKey est vide, l'appli tourne en MODE DÉMO :
//  les données restent sur le téléphone et ne sont pas partagées.
//  (Ces valeurs ne sont pas secrètes : la sécurité vient des règles Firestore.)
// ─────────────────────────────────────────────────────────────
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6u4Mh5uB-ySsu6D2wik1Xwt00u2lVBXE",
  authDomain: "nous-deux-9e8a4.firebaseapp.com",
  projectId: "nous-deux-9e8a4",
  storageBucket: "nous-deux-9e8a4.firebasestorage.app",
  messagingSenderId: "600444055695",
  appId: "1:600444055695:web:9973a18693600edf94c0fa"
};

// Clé « Web Push » (Firebase › Paramètres du projet › Cloud Messaging ›
// Certificats Web Push › Paire de clés). Nécessaire pour les notifications.
self.VAPID_KEY = "BFEtet6glvWlYdqcKFxnCDbpUJmdc7sZIiLgC0TD0MZ-N6ERo8weo6RvAtR2rRU1hq-lEPbx56kpPH5He4f2Lvw";
self.TMDB_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiOTk4MWU5ZmYwYWM5MGY0YWExYTAxZmFjNGY4NWI3MiIsIm5iZiI6MTc5NDY3NjczMy45NjMsInN1YiI6IjZhZjg5N2ZkOGQwNTEzYzNmNzZjYzJhMSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.zS4rFLSeLwBhZmMeWEGduPYUDrKuNh74f4z92vrzQJE";
