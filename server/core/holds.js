// ── PÉRIODES « ON HOLD » ──────────────────────────────────────
// Un ticket On Hold est gelé : son SLA s'arrête au moment de la mise en
// attente et reprend à la sortie, sans que le temps passé en attente soit
// décompté. Il n'est donc jamais compté en rupture tant qu'il est gelé.
//
// Chaque ticket porte la liste de ses périodes d'attente :
//   hold_periods: [{ from: ISO, to: ISO | null }]   (to = null : en cours)
// Liste tenue par le serveur à chaque changement de statut — jamais par le
// client — et reconstituée une fois depuis l'audit pour les tickets
// antérieurs à cette règle.
//
// Fonctions pures : aucune lecture de fichier ici, pour pouvoir les tester.

const ON_HOLD = 'On Hold';

// Périodes d'un ticket, normalisées et triées. Un ticket On Hold sans
// période ouverte (donnée ancienne, migration pas encore passée) reçoit une
// période ouverte depuis sa dernière modification : mieux vaut geler à une
// date approximative que laisser courir un SLA censé être arrêté.
function periodesAttente(ticket) {
  const liste = (Array.isArray(ticket.hold_periods) ? ticket.hold_periods : [])
    .filter(p => p && p.from && !isNaN(new Date(p.from).getTime()))
    .map(p => ({ from: new Date(p.from).getTime(), to: p.to ? new Date(p.to).getTime() : null }))
    .sort((a, b) => a.from - b.from);
  if (ticket.status === ON_HOLD && !liste.some(p => p.to === null)) {
    const depuis = ticket.hold_since || ticket.modified_at || ticket.open_date || ticket.created_at;
    const ms = new Date(depuis).getTime();
    if (!isNaN(ms)) liste.push({ from: ms, to: null });
  }
  return liste;
}

// Nouvelle liste de périodes après une écriture (création ou modification).
function majAttentes(avant, apres, maintenant = new Date()) {
  const iso = maintenant.toISOString();
  const periodes = (avant && Array.isArray(avant.hold_periods) ? avant.hold_periods : [])
    .map(p => ({ from: p.from, to: p.to ?? null }));
  const etaitGele = !!avant && avant.status === ON_HOLD;
  const estGele   = apres.status === ON_HOLD;
  const ouverte   = periodes.find(p => p.to === null);
  if (!etaitGele && estGele && !ouverte) periodes.push({ from: iso, to: null });
  if (etaitGele && !estGele) {
    if (ouverte) ouverte.to = iso;
    // Gelé avant la tenue des périodes : on ne sait pas depuis quand, on
    // borne sur la dernière modification connue.
    else periodes.push({ from: avant.modified_at || iso, to: iso });
  }
  return periodes;
}

// Reconstitution depuis l'audit : on rejoue les changements de statut du
// ticket dans l'ordre. `audit` = entrées de ce ticket (tous types).
function reconstruireAttentes(ticket, audit) {
  const evts = (audit || [])
    .filter(a => a && a.ts)
    .map(a => {
      const c = a.changes || {};
      // Création : `changes` est le ticket lui-même ; modification : { status: { from, to } }.
      const statut = a.action === 'create' ? c.status
        : (c.status && typeof c.status === 'object') ? c.status.to : undefined;
      return { ts: new Date(a.ts).getTime(), statut };
    })
    .filter(e => e.statut !== undefined && !isNaN(e.ts))
    .sort((a, b) => a.ts - b.ts);

  const periodes = [];
  let ouverte = null;
  for (const e of evts) {
    if (e.statut === ON_HOLD && !ouverte) { ouverte = { from: new Date(e.ts).toISOString(), to: null }; periodes.push(ouverte); }
    else if (e.statut !== ON_HOLD && ouverte) { ouverte.to = new Date(e.ts).toISOString(); ouverte = null; }
  }
  // L'audit est borné (2 000 entrées) : il peut ne plus contenir la mise en
  // attente d'un ticket ancien. Le statut actuel fait foi.
  if (ticket.status === ON_HOLD && !ouverte) {
    periodes.push({ from: ticket.modified_at || ticket.open_date || ticket.created_at || new Date().toISOString(), to: null });
  }
  if (ticket.status !== ON_HOLD && ouverte) ouverte.to = ticket.modified_at || ticket.close_date || ouverte.from;
  return periodes;
}

module.exports = { ON_HOLD, periodesAttente, majAttentes, reconstruireAttentes };
