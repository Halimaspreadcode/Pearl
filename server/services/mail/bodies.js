const { deriveHighlights, quietWeek } = require('../../documents/weekly-pptx');
const { readCfg } = require('../../core/store');
const { reportTZ, tzParts } = require('../../core/time');
const { slaTargetLabel } = require('../../core/sla');

// Corps du mail quotidien. Même langage visuel que le mail hebdomadaire
// (cartes, pastilles, listes aérées) plutôt qu'une copie du classeur :
// un tableau de neuf colonnes se lit mal dans un client mail, surtout sur
// téléphone. Le classeur reste en pièce jointe pour le détail.
//
// Ordre de lecture : ce qui s'est passé (phrase + chiffres), ce qui
// demande une action (ruptures SLA), puis le détail du jour. Les sections
// rédigées n'apparaissent que si elles ont du contenu — trois blocs
// « Nothing to report » d'affilée noyaient le reste.
//
// HTML de mail : tableaux et styles en ligne uniquement.
// ── PAYS D'UN RAPPORT ─────────────────────────────────────────
// Chaque envoi programmé choisit son périmètre : Sénégal, Côte d'Ivoire ou
// les deux. Le code sert aux filtres ('SN' | 'CI' | 'ALL'), le libellé au
// mail et au classeur (la ville remplace « Dakar » écrit en dur).
const PAYS = {
  SN:  { code: 'SN', en: 'Senegal', ville: 'Dakar' },
  CI:  { code: 'CI', en: "Côte d'Ivoire", ville: 'Abidjan' },
  ALL: { code: 'SN + CI', en: 'Senegal + Côte d\'Ivoire', ville: 'Dakar + Abidjan' },
};
// Valeur absente ou inconnue : Sénégal, le périmètre historique du deck.
function normPays(v) { return PAYS[v] ? v : 'SN'; }

// Un highlight clôturé n'a plus rien à signaler : il reste dans la page
// (historique de la journée) mais sort du mail et du classeur.
const HL_CLOS = /^(closed|clos|close|clôturé|cloturé|fermé|done|resolved|résolu)$/i;
function highlightsOuverts(liste) {
  return (liste || []).filter(h => h && (h.observation || h.text) && !HL_CLOS.test(String(h.status || '').trim()));
}

// Corps du daily : la même mise en page que le classeur Excel joint
// (public/js/daily-workbook.js) — bandeau rouge, bandeau noir date /
// auteur / ville, barres de section noires, en-têtes gris, tuiles de
// métriques colorées, cellules colorées selon le statut. Qui lit le mail
// puis ouvre l'Excel retrouve le même document. Tableaux et styles en
// ligne : les clients mail ignorent les feuilles de style.
function corpsDaily(d, br, _dateStr, pays = 'SN') {
  const k = d.kpis || {};
  const P = PAYS[normPays(pays)];
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FONT = 'font-family:Calibri,Arial,-apple-system,Segoe UI,Helvetica,sans-serif';
  const MONO = 'font-family:Consolas,Menlo,monospace';
  // Couleurs du classeur (daily-workbook.js), sans le canal alpha.
  const X = {
    red: '#C7000B', black: '#1A1C1E', white: '#FFFFFF', gray: '#E5E7EB', grayBg: '#F5F6F8', zebra: '#FAFAFB',
    green: '#2E7D32', greenBg: '#E8F5E9', redF: '#C62828', redBg: '#FFEBEE', orange: '#E65100', orangeBg: '#FFF3E0', blue: '#2563EB',
  };
  const cfgSla = readCfg();
  const tz = reportTZ(cfgSla);
  const cible = t => slaTargetLabel(t, cfgSla);
  const sem = v => {
    const l = String(v || '').toLowerCase();
    if (l === 'breach' || l === 'p1' || l === 'critical') return [X.redF, X.redBg];
    if (l === 'p2' || l === 'high' || l === 'open') return [X.orange, X.orangeBg];
    if (l === 'in sla' || l === 'resolved' || l === 'closed') return [X.green, X.greenBg];
    return null;
  };
  const dur = ms => {
    if (ms == null || !isFinite(ms)) return '0h 00m';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };
  // Délai restant, même écriture que la colonne « Time Left » du classeur.
  const restant = (ms, status) => {
    if (ms == null) return '-';
    const abs = Math.abs(ms), sign = ms >= 0 ? '+' : '−';
    const d2 = Math.floor(abs / 86400000), h = Math.floor((abs % 86400000) / 3600000), m = Math.floor((abs % 3600000) / 60000);
    if (status === 'Resolved' || status === 'Closed') return `${sign}${Math.floor(abs / 3600000)}h${String(m).padStart(2, '0')}m (audit)`;
    return d2 > 0 ? `${sign}${d2}d ${h}h ${String(m).padStart(2, '0')}m` : `${sign}${h}h ${String(m).padStart(2, '0')}m`;
  };

  const B = `border:1px solid ${X.gray}`;
  const td = (v, o = {}) => {
    const c = o.sem ? sem(v) : null;
    const bg = c ? c[1] : o.bg || (o.zebra ? X.zebra : X.white);
    const fg = c ? c[0] : o.color || X.black;
    return `<td${o.span ? ` colspan="${o.span}"` : ''} style="${B};background:${bg};color:${fg};padding:6px 8px;font-size:${o.size || 12}px;${
      c || o.bold ? 'font-weight:700;' : ''}${c || o.center ? 'text-align:center;' : ''}${o.mono ? MONO + ';' : ''}vertical-align:middle">${esc(v)}</td>`;
  };
  const th = (v, span) => `<td${span ? ` colspan="${span}"` : ''} style="${B};background:${X.gray};color:${X.black};padding:6px 8px;font-size:11px;font-weight:700">${esc(v)}</td>`;
  const barre = t => `<tr><td colspan="10" style="background:${X.black};color:${X.white};padding:7px 10px;font-size:12px;font-weight:700;letter-spacing:.3px">${esc(t)}</td></tr>`;
  const vide = t => `<tr><td colspan="10" style="${B};padding:8px;font-size:12px;text-align:center;color:#555">${esc(t)}</td></tr>`;
  const espace = '<tr><td colspan="10" style="height:10px;font-size:0;line-height:0">&nbsp;</td></tr>';

  let dateStr = '';
  try { dateStr = new Date(d.date).toLocaleDateString('fr-FR', { timeZone: tz }); } catch { dateStr = String(d.date || '').slice(0, 10); }
  const slaPct = k.sla_compliance != null ? `${k.sla_compliance}%` : 'N/A';

  const METRIQUES = [
    ['Opened Today', k.total, X.blue, X.grayBg, 1], ['Still Open', k.open, X.orange, X.orangeBg, 1],
    ['SLA Breach', k.breach, X.redF, X.redBg, 1], ['Backlog (all)', k.overall_open ?? '-', X.black, X.grayBg, 1],
    ['Resolved Today', k.resolved_today ?? 0, X.green, X.greenBg, 1], ['MTTD', dur(k.mttd_ms), X.black, X.grayBg, 1],
    ['MTTR', dur(k.mttr_ms), X.black, X.grayBg, 1], ['SLA %', slaPct, X.green, X.greenBg, 3],
  ];

  const today = d.today_tickets || [];
  const breaches = d.breach_tickets || [];
  const hl  = highlightsOuverts(br.highlights);
  const rk  = (br.risks || []).filter(r => r && r.description);
  const act = (br.actions || []).filter(a => a && a.action);
  const riskDesc = r => !r._auto ? (r.description || '')
    : `[${r._autoType === 'near-breach' ? 'NEAR BREACH' : 'P1/P2 OPEN'}${r._timeLeft ? ` | ${r._timeLeft}${r._autoType === 'near-breach' ? ' left' : ''}` : ''}] ${r.description || ''}`;

  const sections = {
    metrics: () => barre('GLOBAL METRICS')
      + `<tr>${METRIQUES.map(([l, , , , sp]) => th(l, sp)).join('')}</tr>`
      + `<tr>${METRIQUES.map(([, v, fg, bg, sp]) => `<td${sp > 1 ? ` colspan="${sp}"` : ''} style="${B};background:${bg};color:${fg};padding:10px 6px;font-size:20px;font-weight:700;text-align:center">${esc(v)}</td>`).join('')}</tr>`,
    today: () => barre('TODAY TT OVERVIEW')
      + `<tr>${['TT#', 'Src', 'Dom.', 'FO Owner', 'Severity', 'SLA Target', 'Time Left', 'SLA', 'Status'].map((h, i) => th(h, i === 8 ? 2 : 0)).join('')}</tr>`
      + (today.length ? today.map((t, i) => { const z = i % 2 === 1; return `<tr>${
          td(t.sn_tt || '', { zebra: z, mono: true })}${td(t.tracker || '', { zebra: z })}${td(t.domain || '', { zebra: z })}${
          td(t.fo_owner || '', { zebra: z })}${td(t.severity || '', { zebra: z, sem: true })}${td(cible(t), { zebra: z, color: X.redF, mono: true })}${
          td(restant(t.time_left_ms, t.status), { zebra: z, mono: true })}${td(t.sla_status || '', { zebra: z, sem: true })}${
          td(t.status || '', { zebra: z, sem: true, span: 2 })}</tr>`; }).join('') : vide('No tickets opened today')),
    breaches: () => barre('ACTIVE SLA BREACHES')
      + `<tr>${th('TT#')}${th('Src')}${th('Dom.')}${th('FO Owner')}${th('BO Handling')}${th('Severity')}${th('SLA Target')}${th('Overdue by', 2)}${th('Status')}</tr>`
      + (breaches.length ? breaches.map((t, i) => { const z = i % 2 === 1; return `<tr>${
          td(t.sn_tt || '', { zebra: z, mono: true })}${td(t.tracker || '', { zebra: z })}${td(t.domain || '', { zebra: z })}${
          td(t.fo_owner || '', { zebra: z })}${td(t.bo_handling || '', { zebra: z })}${td(t.severity || '', { zebra: z, sem: true })}${
          td(cible(t), { zebra: z, color: X.redF, mono: true })}${td(restant(t.time_left_ms, t.status), { zebra: z, color: X.redF, bold: true, span: 2 })}${
          td(t.status || '', { zebra: z, sem: true })}</tr>`; }).join('') : vide('No active SLA breaches')),
    highlights: () => barre('OPERATIONAL HIGHLIGHTS')
      + `<tr>${th('Source / Category', 2)}${th('Observation', 4)}${th('Priority')}${th('Status', 3)}</tr>`
      + (hl.length ? hl.map((h, i) => { const z = i % 2 === 1; return `<tr>${
          td(h.source || '', { zebra: z, span: 2 })}${td(h.observation || h.text, { zebra: z, span: 4 })}${
          td(h.priority || '', { sem: true })}${td(h.status || '', { sem: true, span: 3 })}</tr>`; }).join('') : vide('No open highlight')),
    risks: () => barre('RISKS & ISSUES')
      + `<tr>${th('#')}${th('Description', 3)}${th('FO')}${th('BO')}${th('Priority')}${th('Status', 3)}</tr>`
      + (rk.length ? rk.map((r, i) => { const z = i % 2 === 1; return `<tr>${
          td(i + 1, { zebra: z, center: true })}${td(riskDesc(r), { zebra: z, span: 3 })}${td(r.fo || '', { zebra: z })}${
          td(r.bo || '', { zebra: z })}${td(r.priority || '', { sem: true })}${td(r.status || '', { sem: true, span: 3 })}</tr>`; }).join('') : vide('No risk recorded')),
    actions: () => barre('TOMORROW PRIORITY ACTION ITEMS')
      + `<tr>${th('#')}${th('Action Item', 3)}${th('Owner')}${th('Priority')}${th('ETA', 4)}</tr>`
      + (act.length ? act.map((a, i) => { const z = i % 2 === 1; return `<tr>${
          td(i + 1, { zebra: z, center: true })}${td(a.action, { zebra: z, span: 3 })}${td(a.owner || '', { zebra: z })}${
          td(a.priority || '', { sem: true })}${td(a.eta || '', { zebra: z, span: 4 })}</tr>`; }).join('') : vide('No action recorded')),
  };

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:900px;border-collapse:collapse;${FONT};color:${X.black}">
  <tr><td colspan="10" style="background:${X.red};color:${X.white};padding:10px;font-size:17px;font-weight:700;text-align:center">DAILY REPORT</td></tr>
  <tr>
    <td colspan="3" style="background:${X.black};color:${X.white};padding:6px 10px;font-size:12px">Date : ${esc(dateStr)}</td>
    <td colspan="4" style="background:${X.black};color:${X.white};padding:6px 10px;font-size:12px;text-align:center">${esc(br.author || '')}</td>
    <td colspan="3" style="background:${X.black};color:${X.white};padding:6px 10px;font-size:12px;text-align:right">${esc(P.ville)}</td>
  </tr>
  ${espace}
  ${['metrics', 'today', 'breaches', 'highlights', 'risks', 'actions'].map(k2 => sections[k2]() + espace).join('\n  ')}
</table>`;
}

// Libellés des mails. Les destinataires (management, groupe) lisent en
// anglais : les rapports eux-mêmes le sont, un mail en français autour
// d'un deck en anglais faisait deux langues dans le même envoi.
const RAPPORT_LABELS_EN = {
  daily: 'Daily Report', weekly: 'Weekly Report', monthly: 'Monthly Report',
  absences: 'Absence Report', weekly_pptx: 'Weekly Review',
};

// Objet du mail. Modèle libre défini par planification, avec des jetons
// remplacés à l'envoi : {report} {date} {week} {month} {country}. Un modèle vide
// retombe sur « <rapport> — <date> ».
function mailSubject(kind, modele, now = new Date(), pays) {
  const label = RAPPORT_LABELS_EN[kind] || kind;
  // Sans pays (appels anciens, tests) : l'objet reste celui d'avant.
  const P = pays ? PAYS[normPays(pays)] : null;
  const tz = reportTZ(readCfg());
  const p = tzParts(now, tz);
  const pad = n => String(n).padStart(2, '0');
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  // Semaine ISO : c'est le repère qu'utilisent les revues hebdo.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const month = new Date(Date.UTC(p.year, p.month - 1, 15))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const t = String(modele || '').trim();
  if (!t) return P ? `${label} ${P.code} — ${date}` : `${label} — ${date}`;
  return t.replace(/\{report\}/gi, label).replace(/\{date\}/gi, date)
          .replace(/\{country\}/gi, P ? P.code : '')
          .replace(/\{week\}/gi, `W${pad(week)}`).replace(/\{month\}/gi, month)
          .replace(/[\r\n]+/g, ' ').slice(0, 200);
}

// Corps du mail hebdomadaire : la page « Overview » du deck, rendue en
// HTML de mail (tableaux et styles en ligne — les clients mail ignorent
// les feuilles de style). Le lecteur a les chiffres de la semaine sans
// ouvrir le PowerPoint ; le deck reste en pièce jointe pour le détail.
function corpsWeeklyOverview(data, pays = 'SN') {
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const k = data.kpis || {};
  const fmtD = v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const dur = ms => {
    if (ms == null || !isFinite(ms)) return 'n/a';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return h < 48 ? `${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}` : `${Math.round(h / 24)} d`;
  };
  const opened = k.opened_this_week ?? 0, closed = k.resolved_this_week ?? 0, net = closed - opened;
  const sla = k.sla_compliance;
  const [slaBg, slaFg] = sla == null ? ['#F3F4F6', '#1A1C1E']
    : sla >= 95 ? ['#E6F4EA', '#0B5C28'] : sla < 85 ? ['#FCE8E6', '#8C1D16'] : ['#FEF7E0', '#7A5200'];
  const wk = data.week_tickets || [];
  const rated = wk.filter(t => t.sla_status && !['N/A', 'On Hold'].includes(t.sla_status)).length;
  const p12 = wk.length ? Math.round(wk.filter(t => ['P1', 'P2'].includes(t.priority)).length / wk.length * 100) : null;
  const mttdOk = k.mttd_ms == null ? null : k.mttd_ms <= 5 * 60 * 1000;
  let highlights = [], calme = null;
  try { calme = quietWeek(data); } catch {}
  try { highlights = deriveHighlights(data) || []; } catch {}
  const FONT = "font-family:Arial,-apple-system,Segoe UI,Roboto,Helvetica,sans-serif";

  const card = (bg, fg, mute, value, label, note, kicker) => `
    <td valign="bottom" width="33%" style="background:${bg};padding:18px 18px 16px;border-radius:10px;${FONT}">
      ${kicker ? `<div style="font-size:11.5px;line-height:1.45;color:${mute};margin-bottom:26px">${esc(kicker)}</div>` : '<div style="height:44px"></div>'}
      <div style="font-size:38px;line-height:1;font-weight:700;color:${fg}">${esc(value)}</div>
      <div style="font-size:13px;font-weight:700;color:${fg};margin-top:8px">${esc(label)}</div>
      <div style="font-size:11.5px;line-height:1.45;color:${mute};margin-top:4px">${esc(note)}</div>
    </td>`;
  const sec = [
    ['Closed', String(closed), `net ${net >= 0 ? '+' : ''}${net}`, ''],
    ['SLA breaches', String(k.breach ?? 0), '', (k.breach ?? 0) > 0 ? '#C5221F' : ''],
    ['MTTR', dur(k.mttr_ms), '', ''],
    ['MTTD', dur(k.mttd_ms), mttdOk == null ? 'target 5 min' : mttdOk ? 'target 5 min · met' : 'target 5 min · missed',
      mttdOk == null ? '' : mttdOk ? '#1E8E3E' : '#C5221F'],
    ['P1/P2 share', p12 == null ? 'n/a' : `${p12}%`, `${rated}/${wk.length} rated`, ''],
  ];
  const toneCol = t => t === 'alert' ? '#C5221F' : t === 'warn' ? '#B06000' : t === 'good' ? '#1E8E3E' : '#C7000B';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:860px;${FONT};color:#1A1C1E">
  <tr><td style="padding:0 0 4px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#C7000B;font-weight:700">Weekly Report · Overview</td></tr>
  <tr><td style="font-size:24px;line-height:1.2;font-weight:700;padding-bottom:4px">What the week shows in numbers</td></tr>
  <tr><td style="font-size:12.5px;color:#6B7280;padding-bottom:18px">${esc(fmtD(data.week_start))} to ${esc(fmtD(data.week_end))} · Pearl · ${esc(PAYS[normPays(pays)].ville)}</td></tr>
  ${calme ? `
  <tr><td style="padding-bottom:14px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="background:${calme.visibility_risk ? '#FEF7E0' : '#EEF3F5'};border:1px solid ${calme.visibility_risk ? '#E0B252' : '#CFDDE2'};border-radius:10px;padding:16px 18px;${FONT}">
        <div style="font-size:14px;font-weight:700;color:#1A1C1E">${esc(calme.title)}</div>
        <div style="font-size:13px;line-height:1.5;color:#3E555C;margin-top:4px">${esc(calme.lead)}</div>
        <ul style="margin:10px 0 0;padding-left:18px;color:#3E555C;font-size:12.5px;line-height:1.55">
          ${calme.points.map(t => `<li style="margin-bottom:3px">${esc(t)}</li>`).join('')}
        </ul>
      </td></tr>
    </table>
  </td></tr>` : ''}
  <tr><td>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      ${card('#F3F4F6', '#1A1C1E', '#6B7280', opened, 'Tickets opened',
             closed || opened ? `${closed} closed over the same period, a net ${net >= 0 ? '+' : ''}${net}.` : 'No intake recorded for this period.')}
      <td width="10" style="font-size:0">&nbsp;</td>
      ${card(slaBg, slaFg, slaFg, sla == null ? 'n/a' : `${sla}%`, 'SLA compliance',
             'Share of tickets in the period meeting their target.',
             (k.breach ?? 0) > 0 ? `${k.breach} breach(es) opened this week.` : 'No SLA breach opened this week.')}
      <td width="10" style="font-size:0">&nbsp;</td>
      ${card('#C7000B', '#FFFFFF', '#F6D3D9', k.overall_open ?? 0, 'Open backlog',
             `Out of ${k.overall_total ?? 0} ticket(s) on record, all statuses.`)}
    </tr></table>
  </td></tr>
  <tr><td style="padding-top:14px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E5E7EB"><tr>
      ${sec.map(([l, v, n, c], i) => `
        <td valign="top" style="padding:12px 10px 0 ${i ? '12px' : '0'};${i ? 'border-left:1px solid #E5E7EB;' : ''}${FONT}">
          <div style="font-size:17px;font-weight:700;color:${c || '#1A1C1E'}">${esc(v)}</div>
          <div style="font-size:11.5px;color:#6B7280;margin-top:2px">${esc(l)}</div>
          ${n ? `<div style="font-size:10.5px;color:#9CA3AF;margin-top:1px">${esc(n)}</div>` : ''}
        </td>`).join('')}
    </tr></table>
  </td></tr>
  ${highlights.length && !calme ? `
  <tr><td style="padding-top:22px">
    <div style="font-size:14px;font-weight:700;margin-bottom:8px">Key highlights</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${highlights.slice(0, 6).map(h => `
        <tr><td width="18" valign="top" style="padding:7px 0 0"><div style="width:10px;height:3px;background:${toneCol(h.tone)}"></div></td>
            <td style="padding:2px 0 6px;font-size:13px;line-height:1.5;color:#374151;${FONT}">${esc(h.text)}</td></tr>`).join('')}
    </table>
  </td></tr>` : ''}
</table>`;
}

module.exports = {
  corpsDaily, RAPPORT_LABELS_EN, mailSubject, corpsWeeklyOverview, PAYS, normPays, highlightsOuverts,
};
