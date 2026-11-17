const express     = require('express');
const { v4: uuidv4 } = require('uuid');
const { FILES, siteFile } = require('../config/paths');
const { readCfg, readTracker, withFileLock, writeTracker, readSites, siteCodes } = require('../core/store');
const { addAudit } = require('../core/audit');
const { cleanBody } = require('../core/sanitize');
const { majAttentes } = require('../core/holds');
const { enrichTicket } = require('../core/sla');

const router = express.Router();

// ── TICKETS ──────────────────────────────────────────────────
// Un tracker par site configuré (cfg.sites). `:site` est le code du site,
// en minuscules ou majuscules ; un code inconnu donne 404.
//   GET    /api/tickets              → { sites, tickets: { CODE: [...] } }
//   GET    /api/tickets/:site        → tickets du site
//   GET    /api/tickets/:site/:id
//   POST   /api/tickets/:site
//   PUT    /api/tickets/:site/:id
//   DELETE /api/tickets/:site/:id
router.get('/api/tickets', (req, res) => {
  const cfg = readCfg();
  const tickets = {};
  for (const s of readSites(cfg)) tickets[s.code] = readTracker(s.code).map(t => enrichTicket(t, cfg));
  res.json({ sites: readSites(cfg), tickets });
});

router.param('site', (req, res, next, site) => {
  const code = String(site || '').toUpperCase();
  if (!siteCodes().includes(code)) return res.status(404).json({ error: `Site inconnu : ${site}` });
  req.site = code;
  next();
});

router.get('/api/tickets/:site', (req, res) => {
  const cfg = readCfg();
  res.json(readTracker(req.site).map(t => enrichTicket(t, cfg)));
});

router.get('/api/tickets/:site/:id', (req, res) => {
  const cfg    = readCfg();
  const ticket = readTracker(req.site).find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json(enrichTicket(ticket, cfg));
});

  // Champs sans lesquels le SLA ne se calcule pas. Un ticket créé sans
  // eux passait en « N/A » et sortait de tous les taux de conformité : le
  // formulaire les exige, mais l'API les acceptait vides.
  //   creation = true  → Type et heure d'occurrence obligatoires
  //   creation = false → on refuse seulement de les vider ou de les
  //   fausser ; un ancien ticket incomplet reste modifiable (sinon un
  //   simple changement de statut deviendrait impossible) et la règle
  //   Data Quality E09 le signale pour correction.
  function champsSLAInvalides(body, cfg, creation) {
    const types = [...new Set(Object.keys(cfg.sla_hours || {})
      .map(k => k.replace(/\s+P\d$/i, '')))];
    const erreurs = [];
    const present = k => Object.prototype.hasOwnProperty.call(body, k);
    if (creation || present('type')) {
      const t = String(body.type || '').trim();
      if (!t) erreurs.push('Type is required');
      else if (types.length && !types.includes(t))
        erreurs.push(`Unknown type "${t}" (expected: ${types.join(', ')})`);
    }
    if (creation || present('occur_time')) {
      const o = body.occur_time;
      if (!o) erreurs.push('Occurrence time is required');
      else if (isNaN(new Date(o).getTime())) erreurs.push('Occurrence time is not a valid date');
    }
    return erreurs;
  }

  router.post('/api/tickets/:site', (req, res) => {
    const tracker = req.site.toLowerCase(), trackerFile = siteFile(req.site);
    const erreurs = champsSLAInvalides(req.body || {}, readCfg(), true);
    if (erreurs.length) return res.status(400).json({ error: erreurs.join(' · '), fields: erreurs });
    withFileLock(trackerFile, () => {
      const cfg     = readCfg();
      const tickets = readTracker(tracker);
      // Les périodes On Hold sont tenues par le serveur, jamais reçues du
      // client : sinon n'importe qui pourrait effacer ou inventer un gel.
      const { hold_periods: _hp, ...corps } = cleanBody(req.body);
      const ticket  = {
        id: `${tracker}-${uuidv4().slice(0,8)}`,
        created_at: new Date().toISOString(),
        ...corps,
        modified_at: null
      };
      ticket.hold_periods = majAttentes(null, ticket);
      if (['Resolved', 'Closed'].includes(ticket.status) && !ticket.close_date) ticket.close_date = ticket.created_at;
      tickets.push(ticket);
      writeTracker(tracker, tickets);
      // audit uses its own file lock internally
      withFileLock(FILES.audit, () => addAudit(tracker.toUpperCase(), ticket.id, req.body.fo_owner || 'system', 'create', ticket));
      res.status(201).json(enrichTicket(ticket, cfg));
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  router.put('/api/tickets/:site/:id', (req, res) => {
    const tracker = req.site.toLowerCase(), trackerFile = siteFile(req.site);
    const erreurs = champsSLAInvalides(req.body || {}, readCfg(), false);
    if (erreurs.length) return res.status(400).json({ error: erreurs.join(' · '), fields: erreurs });
    withFileLock(trackerFile, () => {
      const cfg     = readCfg();
      const tickets = readTracker(tracker);
      const idx     = tickets.findIndex(t => t.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const before = { ...tickets[idx] };
      // modified_at always set server-side (never trust client clock)
      const { hold_periods: _hp, ...corps } = cleanBody(req.body);
      tickets[idx] = { ...before, ...corps, modified_at: new Date().toISOString() };
      // Mise en attente / reprise : ouvre ou ferme une période On Hold, qui
      // gèle le SLA (voir core/holds.js).
      tickets[idx].hold_periods = majAttentes(before, tickets[idx]);

      // Qui a clôturé, figé au moment de la clôture. `modified_by` ne peut
      // pas servir : il est écrasé par chaque édition ultérieure, si bien
      // que le mérite de la fermeture finissait au dernier correcteur de
      // faute de frappe. On ne le pose qu'à la transition vers un état
      // clos, et on ne l'écrase jamais ensuite.
      const wasClosed = ['Resolved', 'Closed'].includes(before.status);
      const nowClosed = ['Resolved', 'Closed'].includes(tickets[idx].status);
      if (nowClosed && !wasClosed) {
        tickets[idx].closed_by = req.body.modified_by || before.assigned_to
                              || before.fo_owner || 'system';
        tickets[idx].closed_by_at = tickets[idx].modified_at;
        // Clôturé sans date de clôture : le serveur la pose, sinon le SLA
        // continuerait de courir et le ticket finirait « en rupture ».
        if (!tickets[idx].close_date) tickets[idx].close_date = tickets[idx].modified_at;
      } else if (!nowClosed && wasClosed) {
        // Réouverture : la clôture précédente ne vaut plus.
        delete tickets[idx].closed_by;
        delete tickets[idx].closed_by_at;
      }
      const changes = {};
      Object.keys(req.body).forEach(k => {
        if (String(before[k] ?? '') !== String(req.body[k] ?? ''))
          changes[k] = { from: before[k], to: req.body[k] };
      });
      writeTracker(tracker, tickets);
      withFileLock(FILES.audit, () => addAudit(tracker.toUpperCase(), req.params.id, req.body.modified_by || 'system', 'update', changes));
      res.json(enrichTicket(tickets[idx], cfg));
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  router.delete('/api/tickets/:site/:id', (req, res) => {
    const tracker = req.site.toLowerCase(), trackerFile = siteFile(req.site);
    withFileLock(trackerFile, () => {
      const tickets = readTracker(tracker);
      const idx     = tickets.findIndex(t => t.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const ticket  = tickets[idx];
      tickets.splice(idx, 1);
      writeTracker(tracker, tickets);
      withFileLock(FILES.audit, () => addAudit(tracker.toUpperCase(), req.params.id,
        req.body?.modified_by || 'system', 'delete',
        { sn_tt: ticket.sn_tt, title: ticket.title }));
      res.json({ ok: true });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

module.exports = router;
