const express     = require('express');
const OBJ          = require('../services/objectives');
const { readCfg } = require('../core/store');
const { addAudit } = require('../core/audit');
const { requireAdmin } = require('../auth/guards');
const { ExcelJSSrv } = require('../services/report-build');
const { commitObjectives, readSessions } = require('../services/objectives-store');

const router = express.Router();

// Équipe d'un agent (fo_trackers, Sénégal par défaut) et filtre ?team= des
// exports : une session se lit pour SN, pour CI ou pour les deux.
function equipeDe(cfg, fo) {
  return [].concat((cfg.fo_trackers || {})[fo] || 'SN').map(x => String(x).toUpperCase());
}
function filtreEquipe(req) {
  const t = String(req.query.team || 'ALL').toUpperCase();
  return ['SN', 'CI'].includes(t) ? t : 'ALL';
}
function dansEquipe(cfg, fo, team) { return team === 'ALL' || equipeDe(cfg, fo).includes(team); }

// ── Sessions trimestrielles ───────────────────────────────────
// Nommées et ouvertes à la main : le cycle réel glisse, et c'est l'admin
// qui sait quand un trimestre commence pour son équipe.

router.get('/api/objective-sessions', requireAdmin, (_req, res) => res.json(readSessions()));

router.post('/api/objective-sessions', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = {
    id: OBJ.uid('q'),
    name:  OBJ.clampStr(b.name, 120),
    start: OBJ.ISO_DATE.test(OBJ.clampStr(b.start, 10)) ? OBJ.clampStr(b.start, 10) : '',
    end:   OBJ.ISO_DATE.test(OBJ.clampStr(b.end, 10))   ? OBJ.clampStr(b.end, 10)   : '',
    state: 'open',
    created: OBJ.nowISO(),
  };
  if (!s.name)  return res.status(400).json({ error: 'A name is required.' });
  if (!s.start || !s.end) return res.status(400).json({ error: 'Start and end dates are required.' });
  if (s.end < s.start)    return res.status(400).json({ error: 'The end date falls before the start date.' });

  let conflict = null;
  commitObjectives(cfg => {
    // Une seule session ouverte à la fois : deux sessions ouvertes
    // rendraient ambigu le rattachement d'un nouvel objectif.
    if (cfg.objective_sessions.some(x => x.state === 'open')) { conflict = true; return; }
    cfg.objective_sessions.push(s);
  }).then(() => {
    if (conflict) return res.status(409).json({ error: 'A session is already open — close it first.' });
    res.status(201).json(s);
  }).catch(e => res.status(500).json({ error: e.message }));
});

// ── Reprise des objectifs existants ───────────────────────────
// Les objectifs du plan trimestriel vivent déjà dans fo_o2o[fo]
// .objectives, avec un intitulé, un KPI en texte libre, une échéance et
// parfois des jalons. Les ignorer aurait obligé chaque agent à ressaisir
// ce qui existe — et aurait fait cohabiter deux listes concurrentes.
//
// On les reprend donc tels quels dans une session que l'admin borne
// lui-même. Ils entrent `approved` : ils ont déjà été posés en
// entretien, les refaire valider n'aurait aucun sens.
//
// L'opération est idempotente par objectif : un objectif déjà repris
// (même `origin`) est laissé de côté, donc rejouer l'import ne duplique
// rien.
router.post('/api/objective-sessions/import-o2o', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name  = OBJ.clampStr(b.name, 120);
  const start = OBJ.ISO_DATE.test(OBJ.clampStr(b.start, 10)) ? OBJ.clampStr(b.start, 10) : '';
  const end   = OBJ.ISO_DATE.test(OBJ.clampStr(b.end, 10))   ? OBJ.clampStr(b.end, 10)   : '';
  const by    = OBJ.clampStr(b.by, 120) || 'admin';
  if (!name)          return res.status(400).json({ error: 'A name is required.' });
  if (!start || !end) return res.status(400).json({ error: 'Start and end dates are required.' });
  if (end < start)    return res.status(400).json({ error: 'The end date falls before the start date.' });

  let conflict = false, out = { agents: 0, objectives: 0, kpis: 0, steps: 0, skipped: 0 };
  let sess = null;

  commitObjectives(cfg => {
    if (cfg.objective_sessions.some(s => s.state === 'open')) { conflict = true; return; }
    sess = {
      id: OBJ.uid('q'), name, start, end, state: 'open',
      created: OBJ.nowISO(), imported_from: 'fo_o2o',
    };
    cfg.objective_sessions.push(sess);

    const o2o = cfg.fo_o2o || {};
    for (const [fo, entry] of Object.entries(o2o)) {
      const src = (entry && entry.objectives) || [];
      if (!src.length) continue;
      cfg.fo_objectives[fo] = cfg.fo_objectives[fo] || [];
      let added = 0;

      for (const s of src) {
        const origin = `o2o:${s.id}`;
        if (cfg.fo_objectives[fo].some(x => x.origin === origin)) { out.skipped++; continue; }

        // Le KPI du plan est une chaîne libre, souvent « 95 % · Revue des
        // tickets » : la cible et sa source séparées par un point médian.
        // On la scinde pour retrouver un vrai KPI ; à défaut, tout part
        // dans la cible, ce qui reste lisible.
        const kpis = [];
        const raw = String(s.kpi || '').trim();
        if (raw) {
          const [target, ...rest] = raw.split('·').map(x => x.trim());
          kpis.push({
            id: OBJ.uid('k'), name: 'Indicateur', target: target || raw,
            unit: '', source: rest.join(' · '), state: 'approved',
          });
        }

        // Les jalons du plan écrivent `label`, ceux de l'application
        // `title` : on lit les deux, sinon un import perd les jalons.
        const steps = (Array.isArray(s.steps) ? s.steps : []).map(st => ({
          id: OBJ.uid('s'),
          label: OBJ.clampStr(st.label ?? st.title, 300),
          // Tout jalon a une date limite : celle du plan One-to-One, sinon
          // celle de l'objectif, sinon la fin de la session.
          due: [st.due, s.due, sess.end].find(d => OBJ.ISO_DATE.test(String(d || ''))) || '',
          done: !!st.done, state: 'approved',
        }));

        const progress = ['todo', 'doing', 'done', 'dropped'].includes(s.status) ? s.status : 'todo';
        cfg.fo_objectives[fo].push({
          id: OBJ.uid('o'), session: sess.id, origin,
          title: OBJ.clampStr(s.title, 400),
          why: '',
          due: OBJ.ISO_DATE.test(String(s.due || '')) ? s.due : '',
          state: 'approved', progress,
          approved_at: OBJ.nowISO(),
          kpis, steps,
          created: s.created || OBJ.nowISO(),
          history: [OBJ.hist('import', by, 'Carried over from One-to-One')],
        });
        added++; out.objectives++;
        out.kpis += kpis.length; out.steps += steps.length;
      }
      if (added) out.agents++;
    }
  }).then(() => {
    if (conflict) return res.status(409).json({ error: 'A session is already open — close it first.' });
    addAudit('perf', sess.id, by, 'objective-session-import', out);
    res.status(201).json({ ok: true, session: sess, ...out });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Reprise dans la session déjà ouverte. Ouvrir une session sans cocher
// la reprise laissait les objectifs existants hors du flux, sans aucun
// moyen de les rattraper : l'import ne savait que créer une session, et
// le bouton disparaissait dès qu'une session était ouverte.
router.post('/api/objective-sessions/:id/import-o2o', requireAdmin, (req, res) => {
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  let missing = false, closed = false;
  const out = { agents: 0, objectives: 0, kpis: 0, steps: 0, skipped: 0 };

  commitObjectives(cfg => {
    const sess = cfg.objective_sessions.find(s => s.id === req.params.id);
    if (!sess) { missing = true; return; }
    if (sess.state !== 'open') { closed = true; return; }

    for (const [fo, entry] of Object.entries(cfg.fo_o2o || {})) {
      const src = (entry && entry.objectives) || [];
      if (!src.length) continue;
      cfg.fo_objectives[fo] = cfg.fo_objectives[fo] || [];
      let added = 0;

      for (const s of src) {
        const origin = `o2o:${s.id}`;
        if (cfg.fo_objectives[fo].some(x => x.origin === origin)) { out.skipped++; continue; }

        const kpis = [];
        const raw = String(s.kpi || '').trim();
        if (raw) {
          const [target, ...rest] = raw.split('·').map(x => x.trim());
          kpis.push({
            id: OBJ.uid('k'), name: 'Indicateur', target: target || raw,
            unit: '', source: rest.join(' · '), state: 'approved',
          });
        }
        const steps = (Array.isArray(s.steps) ? s.steps : []).map(st => ({
          id: OBJ.uid('s'),
          label: OBJ.clampStr(st.label ?? st.title, 300),
          // Tout jalon a une date limite : celle du plan One-to-One, sinon
          // celle de l'objectif, sinon la fin de la session.
          due: [st.due, s.due, sess.end].find(d => OBJ.ISO_DATE.test(String(d || ''))) || '',
          done: !!st.done, state: 'approved',
        }));
        const progress = ['todo', 'doing', 'done', 'dropped'].includes(s.status) ? s.status : 'todo';

        cfg.fo_objectives[fo].push({
          id: OBJ.uid('o'), session: sess.id, origin,
          title: OBJ.clampStr(s.title, 400),
          why: '',
          due: OBJ.ISO_DATE.test(String(s.due || '')) ? s.due : '',
          state: 'approved', progress,
          approved_at: OBJ.nowISO(),
          kpis, steps,
          created: s.created || OBJ.nowISO(),
          history: [OBJ.hist('import', by, 'Carried over from One-to-One')],
        });
        added++; out.objectives++;
        out.kpis += kpis.length; out.steps += steps.length;
      }
      if (added) out.agents++;
    }
  }).then(() => {
    if (missing) return res.status(404).json({ error: 'Unknown session.' });
    if (closed)  return res.status(409).json({ error: 'This session is closed.' });
    addAudit('perf', req.params.id, by, 'objective-session-import', out);
    res.json({ ok: true, ...out });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Aperçu avant import : combien d'objectifs seraient repris, et pour
// qui. L'admin doit savoir ce qu'il déclenche avant de le déclencher.
router.get('/api/objective-sessions/import-o2o/preview', requireAdmin, (_req, res) => {
  const cfg = readCfg();
  const already = new Set(
    Object.values(cfg.fo_objectives || {}).flat().map(o => o.origin).filter(Boolean));
  const per = [];
  let total = 0, skipped = 0;
  for (const [fo, entry] of Object.entries(cfg.fo_o2o || {})) {
    const src = (entry && entry.objectives) || [];
    const fresh = src.filter(s => !already.has(`o2o:${s.id}`));
    skipped += src.length - fresh.length;
    if (fresh.length) { per.push({ fo, count: fresh.length }); total += fresh.length; }
  }
  res.json({ total, skipped, agents: per.length, per });
});

// Suppression des objectifs de plan One-to-One jamais repris dans une
// session (ceux que compte l'aperçu ci-dessus). Les objectifs déjà repris
// restent — ils vivent aussi dans fo_objectives, les retirer du plan
// romprait leur lien d'origine. Les entretiens ne sont pas touchés.
router.delete('/api/objective-sessions/import-o2o', requireAdmin, (req, res) => {
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  const out = { agents: 0, objectives: 0 };
  commitObjectives(cfg => {
    const already = new Set(
      Object.values(cfg.fo_objectives || {}).flat().map(o => o.origin).filter(Boolean));
    for (const [fo, entry] of Object.entries(cfg.fo_o2o || {})) {
      const src = (entry && entry.objectives) || [];
      const keep = src.filter(s => already.has(`o2o:${s.id}`));
      if (keep.length === src.length) continue;
      out.objectives += src.length - keep.length;
      out.agents++;
      entry.objectives = keep;
      if (!keep.length && !(entry.meetings || []).length) delete cfg.fo_o2o[fo];
    }
  }).then(() => {
    addAudit('perf', 'o2o', by, 'o2o-objectives-delete', out);
    res.json({ ok: true, ...out });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// Clôture. Les objectifs restés en brouillon ou en attente ne
// disparaissent pas : ils sont marqués comme non retenus, pour que le
// trimestre suivant reparte d'une liste propre sans perdre la trace.
// Rapport détaillé d'une session d'objectifs. Produit à la demande, y
// compris après fermeture : c'est le bilan qu'on relit en revue de fin
// de trimestre, et qui sert de trace une fois la session soldée.
router.get('/api/objective-sessions/:id/report.xlsx', requireAdmin, async (req, res) => {
  try {
    const cfg  = readCfg();
    const sess = (cfg.objective_sessions || []).find(x => x.id === req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session inconnue' });

    const wb = new ExcelJSSrv.Workbook();
    const GRIS = 'FF37474F', BLANC = 'FFFFFFFF';
    const entete = (ws, labels, largeurs) => {
      ws.columns = largeurs.map(w => ({ width: w }));
      const r = ws.getRow(1);
      labels.forEach((l, i) => {
        const c = r.getCell(i + 1);
        c.value = l;
        c.font = { bold: true, color: { argb: BLANC } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
      });
      r.commit();
    };

    // Toutes les lignes de la session, agent par agent, déjà décorées
    // (avancement, retard, score SMART) par le même code que la page.
    const lignes = [];
    const team = filtreEquipe(req);
    for (const [fo, liste] of Object.entries(cfg.fo_objectives || {})) {
      if (!dansEquipe(cfg, fo, team)) continue;
      for (const o of (liste || [])) {
        if (o.session !== sess.id) continue;
        lignes.push({ fo, o: OBJ.decorate(o, sess) });
      }
    }

    // ── Synthèse
    const ws1 = wb.addWorksheet('Synthèse');
    entete(ws1, ['Indicateur', 'Valeur'], [40, 22]);
    const parEtat = k => lignes.filter(x => x.o.state === k).length;
    const parProg = k => lignes.filter(x => x.o.progress === k).length;
    const retard  = lignes.filter(x => x.o.late && x.o.late.overdue).length;
    const moyenne = lignes.length
      ? Math.round(lignes.reduce((a, x) => a + (x.o.progress_pct || 0), 0) / lignes.length) : 0;
    const smartMoy = lignes.length
      ? Math.round(lignes.reduce((a, x) => a + ((x.o.smart && x.o.smart.score) || 0), 0) / lignes.length) : 0;
    [
      ['Session', sess.name],
      ['Période', `${sess.start || '?'} → ${sess.end || '?'}`],
      ['État', sess.state === 'open' ? 'Ouverte' : 'Fermée'],
      ['Clôturée le', sess.closed_at ? String(sess.closed_at).slice(0, 10) : '—'],
      ['Agents concernés', new Set(lignes.map(x => x.fo)).size],
      ['Objectifs (total)', lignes.length],
      ['— approuvés', parEtat('approved')],
      ['— en attente', parEtat('submitted')],
      ['— non repris (lapsed)', parEtat('lapsed')],
      ['Terminés', parProg('done')],
      ['En cours', parProg('doing')],
      ['Abandonnés / non atteints', parProg('dropped')],
      ['En retard', retard],
      ['Avancement moyen', `${moyenne} %`],
      ['Score SMART moyen', `${smartMoy}/100`],
    ].forEach(([k, v], i) => { ws1.getRow(i + 2).values = [k, v]; });

    // ── Par agent : la vue qu'on relit en entretien individuel.
    const ws2 = wb.addWorksheet('Par agent');
    entete(ws2, ['Agent', 'Objectifs', 'Approuvés', 'Terminés', 'En retard',
                 'Avancement moyen', 'SMART moyen'], [24, 12, 12, 12, 12, 18, 14]);
    const agents = [...new Set(lignes.map(x => x.fo))].sort();
    agents.forEach((fo, i) => {
      const mine = lignes.filter(x => x.fo === fo);
      const moy = mine.length
        ? Math.round(mine.reduce((a, x) => a + (x.o.progress_pct || 0), 0) / mine.length) : 0;
      const sm = mine.length
        ? Math.round(mine.reduce((a, x) => a + ((x.o.smart && x.o.smart.score) || 0), 0) / mine.length) : 0;
      ws2.getRow(i + 2).values = [
        fo, mine.length,
        mine.filter(x => x.o.state === 'approved').length,
        mine.filter(x => x.o.progress === 'done').length,
        mine.filter(x => x.o.late && x.o.late.overdue).length,
        `${moy} %`, `${sm}/100`,
      ];
    });

    // ── Détail : une ligne par objectif, avec de quoi remonter à la
    // source de chaque chiffre de la synthèse.
    const ws3 = wb.addWorksheet('Objectifs');
    entete(ws3, ['Agent', 'Titre', 'Pourquoi', 'Échéance', 'État', 'Avancement',
                 '%', 'Retard (j)', 'SMART', 'KPI', 'Jalons', 'Origine'],
           [20, 40, 34, 13, 13, 13, 8, 11, 9, 34, 30, 14]);
    lignes
      .sort((a, b) => a.fo.localeCompare(b.fo) || String(a.o.title).localeCompare(String(b.o.title)))
      .forEach((x, i) => {
        const o = x.o;
        const kpis = (o.kpis || [])
          .map(k => [k.label, k.target, k.actual].filter(Boolean).join(' : ')).join(' | ');
        const steps = (o.steps || [])
          .map(st => `${st.done ? '[x]' : '[ ]'} ${st.label || ''}${st.due ? ' (' + st.due + ')' : ''}`)
          .join(' | ');
        ws3.getRow(i + 2).values = [
          x.fo, o.title || '', o.why || '', o.due || '', o.state || '', o.progress || '',
          o.progress_pct ?? '', (o.late && o.late.days_over) || 0,
          (o.smart && o.smart.score) ?? '', kpis, steps, o.origin || '',
        ];
      });

    // ── Historique : qui a fait quoi, et quand. Sans lui, un objectif
    // « non repris » ne dit pas s'il a été refusé ou simplement oublié.
    const ws4 = wb.addWorksheet('Historique');
    entete(ws4, ['Agent', 'Objectif', 'Date', 'Action', 'Par', 'Note'],
           [20, 34, 18, 16, 18, 44]);
    let r4 = 2;
    lignes.forEach(x => {
      (x.o.history || []).forEach(h => {
        ws4.getRow(r4++).values = [
          x.fo, x.o.title || '', String(h.at || '').slice(0, 16).replace('T', ' '),
          h.action || '', h.by || '', h.note || '',
        ];
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    const nom = `Objectifs_${String(sess.name || sess.id).replace(/[^\w.\-]/g, '_')}${team === 'ALL' ? '' : '_' + team}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.end(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bilan de session en PowerPoint. L'Excel sert au travail de détail,
// le deck à la présentation en comité : ce sont deux usages, pas deux
// versions du même document — les chiffres viennent des mêmes données.
router.get('/api/objective-sessions/:id/report.pptx', requireAdmin, async (req, res) => {
  try {
    const cfg  = readCfg();
    const sess = (cfg.objective_sessions || []).find(x => x.id === req.params.id);
    if (!sess) return res.status(404).json({ error: 'Session inconnue' });

    const team = filtreEquipe(req);
    const lignes = [];
    for (const [fo, liste] of Object.entries(cfg.fo_objectives || {})) {
      if (!dansEquipe(cfg, fo, team)) continue;
      for (const o of (liste || [])) {
        if (o.session !== sess.id) continue;
        lignes.push({ fo, o: OBJ.decorate(o, sess) });
      }
    }

    // Le deck est composé par objectives-pptx.js, sur le système visuel
    // du rapport hebdomadaire. L'effectif (« X of N agents ») est celui de
    // l'équipe choisie, pas de toute la liste.
    const { buildObjectivesPptx } = require('../documents/objectives-pptx');
    const cfgEq = { ...cfg, fo_list: (cfg.fo_list || []).filter(fo => dansEquipe(cfg, fo, team)) };
    const buf = await buildObjectivesPptx({ sess: { ...sess, team }, lignes, cfg: cfgEq });
    const nom = `Objectives_${String(sess.name || sess.id).replace(/[^\w.\-]/g, '_')}${team === 'ALL' ? '' : '_' + team}.pptx`;
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.end(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/objective-sessions/:id/close', requireAdmin, (req, res) => {
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  let missing = false, counts = { closed: 0, lapsed: 0 };

  commitObjectives(cfg => {
    const s = cfg.objective_sessions.find(x => x.id === req.params.id);
    if (!s) { missing = true; return; }
    s.state = 'closed';
    s.closed_at = OBJ.nowISO();

    for (const list of Object.values(cfg.fo_objectives)) {
      for (const o of list || []) {
        if (o.session !== s.id) continue;
        // Instantané avant fermeture : une réouverture remet l'objectif
        // exactement dans cet état (voir /reopen).
        o.closure = { session: s.id, state: o.state, progress: o.progress,
          ...(o.pending ? { pending: o.pending } : {}) };
        if (o.state === 'approved') {
          // Un objectif approuvé et non terminé se solde comme non
          // atteint : la fin du trimestre tranche.
          if (!['done', 'dropped'].includes(o.progress)) o.progress = 'dropped';
          counts.closed++;
        } else {
          o.state = 'lapsed';
          o.history.push(OBJ.hist('lapsed', by, 'Session closed before approval'));
          counts.lapsed++;
        }
        delete o.pending;
      }
    }
  }).then(() => {
    if (missing) return res.status(404).json({ error: 'Unknown session.' });
    addAudit('perf', req.params.id, by, 'objective-session-close', counts);
    res.json({ ok: true, ...counts });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// ── RÉOUVERTURE ───────────────────────────────────────────────
// Rouvre une session fermée (trimestre clos trop tôt, objectif à corriger).
// Une seule session peut être ouverte : il faut d'abord fermer l'autre.
// Chaque objectif de la session retrouve son état d'avant la fermeture :
//   · instantané `closure` posé par /close depuis le 30/09/2026 ;
//   · sinon (session fermée avant), reconstitution par l'historique :
//     avancement = dernière valeur choisie par l'admin, à défaut « en
//     cours » si un jalon est fait, sinon « à démarrer » ; un objectif
//     « non retenu » redevient soumis, refusé ou brouillon selon sa
//     dernière étape. Les modifications en attente effacées à la fermeture
//     d'alors ne peuvent pas être retrouvées.
// `end` (AAAA-MM-JJ) facultatif : nouvelle date de fin.
router.post('/api/objective-sessions/:id/reopen', requireAdmin, (req, res) => {
  const by = OBJ.clampStr((req.body || {}).by, 120) || 'admin';
  const fin = String((req.body || {}).end || '');
  if (fin && !OBJ.ISO_DATE.test(fin)) return res.status(400).json({ error: 'Invalid end date.' });
  let err = null;
  const out = { restored: 0, reconstructed: 0 };

  commitObjectives(cfg => {
    const s = cfg.objective_sessions.find(x => x.id === req.params.id);
    if (!s) { err = [404, 'Unknown session.']; return; }
    if (s.state === 'open') { err = [409, 'This session is already open.']; return; }
    const autre = cfg.objective_sessions.find(x => x.state === 'open');
    if (autre) { err = [409, `Close “${autre.name}” first: only one session can be open.`]; return; }

    s.state = 'open';
    s.reopened_at = OBJ.nowISO();
    delete s.closed_at;
    if (fin) s.end = fin;

    const derniere = (o, actions) => [...(o.history || [])].reverse().find(h => actions.includes(h.action));
    for (const list of Object.values(cfg.fo_objectives)) {
      for (const o of list || []) {
        if (o.session !== s.id) continue;
        o.history = o.history || [];
        if (o.closure && o.closure.session === s.id) {
          o.state = o.closure.state;
          o.progress = o.closure.progress;
          if (o.closure.pending) o.pending = o.closure.pending;
          delete o.closure;
          out.restored++;
        } else {
          if (o.state === 'lapsed') {
            const h = derniere(o, ['submit', 'edit-submitted', 'reject', 'approve', 'create', 'create-manager', 'edit']);
            o.state = !h ? 'draft' : ['submit', 'edit-submitted'].includes(h.action) ? 'submitted'
              : h.action === 'reject' ? 'rejected' : h.action === 'approve' ? 'approved' : 'draft';
          } else if (o.state === 'approved' && o.progress === 'dropped') {
            const h = derniere(o, ['progress']);
            if (!h || h.note !== 'dropped') {
              o.progress = h && ['todo', 'doing', 'done'].includes(h.note) ? h.note
                : (o.steps || []).some(st => st.done) ? 'doing' : 'todo';
            }
          }
          out.reconstructed++;
        }
        o.history.push(OBJ.hist('reopened', by, s.name || s.id));
      }
    }
  }).then(() => {
    if (err) return res.status(err[0]).json({ error: err[1] });
    addAudit('perf', req.params.id, by, 'objective-session-reopen', out);
    res.json({ ok: true, ...out });
  }).catch(e => res.status(500).json({ error: e.message }));
});

module.exports = router;
