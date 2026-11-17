// ── DÉMARRAGE ─────────────────────────────────────────────────
// Toutes les déclarations `const`/`let` de l'application (AdminSession, SidePanel,
// NF…) sont désormais évaluées : init() peut les lire sans risque.
// Ce fichier est chargé en tout dernier, après shell-hooks.js et
// password-eye.js : quand une réponse réseau reprend init() après un
// `await`, tous les scripts de la page sont déjà évalués.
init();

