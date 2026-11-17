function saveWeeklyForm() {
  weeklyForm.author = document.getElementById('wk-author')?.value ?? weeklyForm.author;
  for (let i = 0; i < weeklyForm.highlights.length; i++) {
    weeklyForm.highlights[i] = {
      source:      document.getElementById(`wk-hl-src-${i}`)?.value ?? weeklyForm.highlights[i].source,
      observation: document.getElementById(`wk-hl-obs-${i}`)?.value ?? weeklyForm.highlights[i].observation,
      priority:    document.getElementById(`wk-hl-pri-${i}`)?.value ?? weeklyForm.highlights[i].priority,
      status:      document.getElementById(`wk-hl-sta-${i}`)?.value ?? weeklyForm.highlights[i].status,
    };
  }
  for (let i = 0; i < weeklyForm.risks.length; i++) {
    weeklyForm.risks[i] = {
      description: document.getElementById(`wk-risk-desc-${i}`)?.value ?? weeklyForm.risks[i].description,
      fo:          document.getElementById(`wk-risk-fo-${i}`)?.value ?? weeklyForm.risks[i].fo,
      bo:          document.getElementById(`wk-risk-bo-${i}`)?.value ?? weeklyForm.risks[i].bo,
      priority:    document.getElementById(`wk-risk-pri-${i}`)?.value ?? weeklyForm.risks[i].priority,
      status:      document.getElementById(`wk-risk-sta-${i}`)?.value ?? weeklyForm.risks[i].status,
      _auto:       weeklyForm.risks[i]._auto,
      _autoType:   weeklyForm.risks[i]._autoType,
      _timeLeft:   weeklyForm.risks[i]._timeLeft,
    };
  }
  for (let i = 0; i < weeklyForm.actions.length; i++) {
    weeklyForm.actions[i] = {
      action:   document.getElementById(`wk-act-item-${i}`)?.value ?? weeklyForm.actions[i].action,
      owner:    document.getElementById(`wk-act-own-${i}`)?.value ?? weeklyForm.actions[i].owner,
      priority: document.getElementById(`wk-act-pri-${i}`)?.value ?? weeklyForm.actions[i].priority,
      eta:      document.getElementById(`wk-act-eta-${i}`)?.value ?? weeklyForm.actions[i].eta,
    };
  }
  ['highlights','risks','actions'].forEach(section => {
    const prefix = { highlights: 'wk-hl', risks: 'wk-risk', actions: 'wk-act' }[section];
    weeklyForm.customCols[section].forEach(c => {
      weeklyForm[section].forEach((row, i) => {
        row[c.id] = document.getElementById(`${prefix}-${c.id}-${i}`)?.value ?? row[c.id];
      });
    });
  });
  weeklyForm.highlights = trimEmptyRows(weeklyForm.highlights, RPT_EMPTY_ROW.highlights);
  weeklyForm.risks      = trimEmptyRows(weeklyForm.risks, RPT_EMPTY_ROW.risks);
  weeklyForm.actions    = trimEmptyRows(weeklyForm.actions, RPT_EMPTY_ROW.actions);
  /* Commentaire du manager : un seul bloc de texte libre, pas un tableau
     de lignes comme les autres sections. Il est malgré tout rangé dans un
     tableau à une entrée, parce que c'est la forme que `form.notes` a
     toujours eue côté serveur (weekly-pptx.js accepte un tableau de
     chaînes ou d'objets `{note}`) : changer le contrat aurait cassé les
     brouillons déjà enregistrés. Vide, le tableau reste vide — la slide
     affiche alors son texte de repli. */
  const noteEl = document.getElementById('wk-notes');
  if (noteEl) {
    const txt = noteEl.value.trim();
    weeklyForm.notes = txt ? [{ note: txt }] : [];
  }
  saveReportDraft('weekly', weeklyAnchorDate);
}
function seedWeeklyHighlightsFromObs(observations) {
  // Always seed from observations (overwrites empty and existing rows)
  const rows = Math.max(weeklyForm.highlights.length, observations.length, 1);
  weeklyForm.highlights = Array(rows).fill(null).map((_, i) => {
    const o = observations[i];
    if (o) {
      const text = o.author ? `[${o.author}] ${o.observation || ''}` : (o.observation || '');
      return { source: o.source || '', observation: text, priority: o.priority || '', status: o.status || 'Open' };
    }
    return weeklyForm.highlights[i] || { source: '', observation: '', priority: '', status: '' };
  });
  weeklyForm.highlights = trimEmptyRows(weeklyForm.highlights, RPT_EMPTY_ROW.highlights);
}
function collectWeeklyForm() {
  saveWeeklyForm();
  return {
    highlights: weeklyForm.highlights.map(r => ({ ...r })),
    risks:      weeklyForm.risks.map(r => ({ ...r })),
    actions:    weeklyForm.actions.map(r => ({ ...r })),
    notes:      weeklyForm.notes.map(r => ({ ...r })),
  };
}

function saveMonthlyForm() {
  monthlyForm.author = document.getElementById('mo-author')?.value ?? monthlyForm.author;
  for (let i = 0; i < monthlyForm.highlights.length; i++) {
    monthlyForm.highlights[i] = {
      source:      document.getElementById(`mo-hl-src-${i}`)?.value ?? monthlyForm.highlights[i].source,
      observation: document.getElementById(`mo-hl-obs-${i}`)?.value ?? monthlyForm.highlights[i].observation,
      priority:    document.getElementById(`mo-hl-pri-${i}`)?.value ?? monthlyForm.highlights[i].priority,
      status:      document.getElementById(`mo-hl-sta-${i}`)?.value ?? monthlyForm.highlights[i].status,
    };
  }
  for (let i = 0; i < monthlyForm.risks.length; i++) {
    monthlyForm.risks[i] = {
      description: document.getElementById(`mo-risk-desc-${i}`)?.value ?? monthlyForm.risks[i].description,
      fo:          document.getElementById(`mo-risk-fo-${i}`)?.value ?? monthlyForm.risks[i].fo,
      bo:          document.getElementById(`mo-risk-bo-${i}`)?.value ?? monthlyForm.risks[i].bo,
      priority:    document.getElementById(`mo-risk-pri-${i}`)?.value ?? monthlyForm.risks[i].priority,
      status:      document.getElementById(`mo-risk-sta-${i}`)?.value ?? monthlyForm.risks[i].status,
      _auto:       monthlyForm.risks[i]._auto,
      _autoType:   monthlyForm.risks[i]._autoType,
      _timeLeft:   monthlyForm.risks[i]._timeLeft,
    };
  }
  for (let i = 0; i < monthlyForm.actions.length; i++) {
    monthlyForm.actions[i] = {
      action:   document.getElementById(`mo-act-item-${i}`)?.value ?? monthlyForm.actions[i].action,
      owner:    document.getElementById(`mo-act-own-${i}`)?.value ?? monthlyForm.actions[i].owner,
      priority: document.getElementById(`mo-act-pri-${i}`)?.value ?? monthlyForm.actions[i].priority,
      eta:      document.getElementById(`mo-act-eta-${i}`)?.value ?? monthlyForm.actions[i].eta,
    };
  }
  ['highlights','risks','actions'].forEach(section => {
    const prefix = { highlights: 'mo-hl', risks: 'mo-risk', actions: 'mo-act' }[section];
    monthlyForm.customCols[section].forEach(c => {
      monthlyForm[section].forEach((row, i) => {
        row[c.id] = document.getElementById(`${prefix}-${c.id}-${i}`)?.value ?? row[c.id];
      });
    });
  });
  monthlyForm.highlights = trimEmptyRows(monthlyForm.highlights, RPT_EMPTY_ROW.highlights);
  monthlyForm.risks      = trimEmptyRows(monthlyForm.risks, RPT_EMPTY_ROW.risks);
  monthlyForm.actions    = trimEmptyRows(monthlyForm.actions, RPT_EMPTY_ROW.actions);
  saveReportDraft('monthly', `${monthlyYear}-${String(monthlyMonth).padStart(2,'0')}`);
}

let weeklyAnchorDate = new Date().toISOString().slice(0,10);

function changeWeek(delta) {
  saveWeeklyForm();
  const d = new Date(weeklyAnchorDate);
  d.setDate(d.getDate() + delta * 7);
  weeklyAnchorDate = d.toISOString().slice(0,10);
  loadReportDraft('weekly', weeklyAnchorDate);
  renderPage_weekly();
}

function goToWeek() {
  saveWeeklyForm();
  const v = document.getElementById('weekly-sel-date')?.value;
  if (v) { weeklyAnchorDate = v; loadReportDraft('weekly', weeklyAnchorDate); renderPage_weekly(); }
}

async function renderPage_weekly() {
  await ensureReportLayoutLoaded();
  saveWeeklyForm();
  // Le périmètre suit le sélecteur de site : sans ce paramètre, le
  // serveur retombait sur SN et basculer sur CI ou Global ne changeait
  // rien à l'écran.
  const rptCountry = typeof getActiveCountry === 'function' ? getActiveCountry() : 'ALL';
  const data = await fetch(`${API}/api/reports/weekly?date=${weeklyAnchorDate}&country=${rptCountry}`).then(r => r.json());
  seedWeeklyHighlightsFromObs(data.observations_open || []);
  weeklyForm.risks = seedRisksFromTickets(weeklyForm.risks);
  lastWeeklyReport = data;

  const dateSel = document.getElementById('weekly-sel-date');
  if (dateSel) dateSel.value = weeklyAnchorDate;

  const { locale, tz } = getLangConfig();
  const wkStart = new Date(data.week_start).toLocaleDateString(locale, { timeZone: tz });
  const wkEnd   = new Date(data.week_end).toLocaleDateString(locale, { timeZone: tz });
  const wkLabel = `Week of ${wkStart} to ${wkEnd}`;
  document.getElementById('weekly-report-date').textContent = wkLabel;

  const k = data.kpis;
  const domRows  = Object.entries(data.by_domain || {}).sort((a, b) => b[1] - a[1]);
  const prioRows = Object.entries(data.by_priority || {}).sort((a, b) => ['P1','P2','P3','P4'].indexOf(a[0]) - ['P1','P2','P3','P4'].indexOf(b[0]));
  const foList   = data.fo_list || state.config.fo_list || [];

  /* ── Récap bento ──────────────────────────────────────────────
     Les listings "Active Tickets" et "Tickets Opened This Week"
     reprenaient ligne à ligne ce que les trackers affichent déjà, avec
     filtres et tri en plus. La page devient un récapitulatif au format
     du dashboard : cartes blanches à filet, le chiffre clé se distingue
     par son corps. La saisie (highlights, risques, actions) reste,
     c'est elle qui alimente le PPTX et l'Excel. */
  rcCatReset();
  const net = (k.resolved_this_week || 0) - (k.total || 0);
  const activeList = data.active_tickets || [];
  const closeRate = (k.total || 0)
    ? Math.round(((k.resolved_this_week || 0) / k.total) * 100) : null;
  const wkTk = data.week_tickets || [];
  const wkP12 = wkTk.length
    ? Math.round((wkTk.filter(t => ['P1', 'P2'].includes(t.priority)).length / wkTk.length) * 100) : null;
  const slaTone = k.sla_compliance == null ? 'warn'
    : k.sla_compliance >= 95 ? 'good' : k.sla_compliance < 85 ? 'alert' : 'warn';

  const sec_metrics = `<div class="rc rc-bento">
    ${rcCard({ variant: 'dark', span: 2,
      title: 'Weekly Volume', sub: 'Opened, closed and in progress',
      body: rcHero({
        label: 'Tickets opened this week',
        value: k.total ?? 0,
        delta: (k.total || k.resolved_this_week)
          ? { text: (net >= 0 ? '+' : '') + net, tone: net >= 0 ? 'good' : 'alert' } : null,
        note: `${k.resolved_this_week ?? 0} closed · ${activeList.length} in progress`,
      }) + `<div class="rc-kpis" style="margin-top:26px;grid-template-columns:1fr 1fr">
        ${rcTile({ label: 'MTTR', value: formatDuration(k.mttr_ms), note: 'mean time to resolve' })}
        ${rcTile({ label: 'MTTD', value: formatDuration(k.mttd_ms), note: 'mean time to detect' })}
      </div>` })}

    ${rcCard({ title: 'SLA Compliance', sub: 'Over tickets opened in the period', span: 2,
      icon: 'gauge', iconTone: 'accent',
      body: `<div style="margin-top:auto">
        ${rcStat({ label: 'SLA Compliance',
                   value: k.sla_compliance == null ? 'n/a' : k.sla_compliance,
                   unit: k.sla_compliance == null ? '' : '%',
                   note: `${(k.total || 0) - (k.breach || 0)}/${k.total || 0} within target`,
                   pct: k.sla_compliance, tone: slaTone })}
        ${rcStat({ label: 'Closure Rate',
                   value: closeRate == null ? 'n/a' : closeRate,
                   unit: closeRate == null ? '' : '%',
                   note: `${k.resolved_this_week ?? 0} closed of ${k.total ?? 0} opened`,
                   pct: closeRate,
                   tone: closeRate == null ? 'warn' : closeRate >= 100 ? 'good' : closeRate < 70 ? 'alert' : 'warn' })}
      </div>
      <div class="rc-card-foot">${k.breach ?? 0} rupture(s) SLA · part P1/P2 ${
        wkP12 == null ? 'n/a' : wkP12 + '%'} · encours global ${k.overall_open ?? 0}${
        k.closed_without_date ? ` · <span title="Clôture datée par la dernière modification. Renseigner la Close Date dans le tracker.">${k.closed_without_date} fermé(s) sans Close Date</span>` : ''}</div>` })}

    ${rcCard({ title: 'Weekly Insights', sub: 'Derived automatically', span: 4, variant: 'plain',
      icon: 'trend', iconTone: 'accent',
      body: rcInsights(rcDeriveInsights(data, k.total || 0, k.resolved_this_week || 0, activeList)) })}
  </div>${rptMetricsNote('week')}`;

  /* Breakdown : mêmes cartes qu'avant, mais bâties comme la carte
     « Ticket volume » du dashboard — les colonnes donnent la forme, la
     répartition classée posée dessous donne les chiffres. Auparavant il
     fallait survoler une barre pour connaître un effectif, ce qui ne
     fonctionne ni sur un rapport imprimé ni sur un écran projeté. */
  const prioColor = p => ({ P1: 'var(--m3-error,#C7000B)', P2: '#E8710A', P3: '#1A73E8' }[p]
                          || 'var(--m3-on-surf-var)');
  const sec_breakdown = `<div class="rc rc-bento">
    ${rcCard({ title: 'By Domain', sub: `Weekly volume · ${domRows.length} domain(s)`, span: 2,
      icon: 'layers',
      body: rcBars(domRows, rcCatColor) + rcBreak(domRows, rcCatColor) })}
    ${rcCard({ title: 'By Priority', sub: 'Weekly volume', span: 2,
      body: rcBars(prioRows, prioColor) + rcBreak(prioRows, prioColor) })}
  </div>`;

  const sec_fo = `<div class="rc rc-bento">
    ${rcCard({ sub: 'Workload carried and share closed',
      span: 4, variant: 'plain', icon: 'users',
      body: rcFoRanking(data.by_fo, data.fo_list || state.config.fo_list || []) })}
  </div>`;

  const sec_highlights = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH}" colspan="2">Source / Category</th>
            <th style="${RPT_TH}" colspan="4">Observation</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${weeklyForm.customCols.highlights.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('weekly','highlights','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${weeklyForm.highlights.map((r, i) => `
            <tr>
              <td style="${RPT_TD}" colspan="2">${rptInp(`wk-hl-src-${i}`, r.source, 'Source...')}</td>
              <td style="${RPT_TD}" colspan="4">${rptInp(`wk-hl-obs-${i}`, r.observation, 'Observation...')}</td>
              <td style="${RPT_TD}">${rptSel(`wk-hl-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`wk-hl-sta-${i}`, r.status, STA_OPTS)}</td>
              ${weeklyForm.customCols.highlights.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`wk-hl-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('weeklyHighlights')}${rptAddColBtn('weekly','highlights')}</div>`;

  const sec_risks = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Description</th>
            <th style="${RPT_TH}">FO</th>
            <th style="${RPT_TH}">BO</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="2">Status</th>
            ${weeklyForm.customCols.risks.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('weekly','risks','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${weeklyForm.risks.map((r, i) => `
            <tr${r._auto ? ' style="background:rgba(37,99,235,.05)"' : ''}>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${r._auto ? rptAutoDescCell(`wk-risk-desc-${i}`, r, 'Description...') : rptInp(`wk-risk-desc-${i}`, r.description, 'Description...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`wk-risk-fo-${i}`, r.fo || '', 'FO...')}</td>
              <td style="${RPT_TD};min-width:110px">${rptInp(`wk-risk-bo-${i}`, r.bo || '', 'BO...')}</td>
              <td style="${RPT_TD}">${rptSel(`wk-risk-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="2">${rptSel(`wk-risk-sta-${i}`, r.status, STA_OPTS)}</td>
              ${weeklyForm.customCols.risks.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`wk-risk-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('weeklyRisks')}${rptAddColBtn('weekly','risks')}</div>`;

  const sec_actions = `<div style="overflow-x:auto"><table style="${RPT_TBL.replace('border-radius:0 0 8px 8px','border-radius:0')}">
          <thead><tr>
            <th style="${RPT_TH};width:40px">#</th>
            <th style="${RPT_TH}" colspan="3">Action Item</th>
            <th style="${RPT_TH}">Owner</th>
            <th style="${RPT_TH}">Priority</th>
            <th style="${RPT_TH}" colspan="3">ETA</th>
            ${weeklyForm.customCols.actions.map(c => `<th style="${RPT_TH};white-space:nowrap">${esc(c.label)} <span onclick="removeReportCustomCol('weekly','actions','${c.id}')" title="Supprimer" style="cursor:pointer;opacity:.6">×</span></th>`).join('')}
            <th style="${RPT_TH};width:1%"></th>
          </tr></thead>
          <tbody>${weeklyForm.actions.map((r, i) => `
            <tr>
              <td style="${RPT_TD};font-family:'DM Mono',monospace;color:var(--mute);background:var(--bg2);text-align:center">${i + 1}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`wk-act-item-${i}`, r.action, 'Action...')}</td>
              <td style="${RPT_TD}">${rptInp(`wk-act-own-${i}`, r.owner, 'Owner...')}</td>
              <td style="${RPT_TD}">${rptSel(`wk-act-pri-${i}`, r.priority, PRI_OPTS)}</td>
              <td style="${RPT_TD}" colspan="3">${rptInp(`wk-act-eta-${i}`, r.eta, 'ETA...')}</td>
              ${weeklyForm.customCols.actions.map(c => `<td style="${RPT_TD};min-width:120px">${rptInp(`wk-act-${c.id}-${i}`, r[c.id], '')}</td>`).join('')}
              <td style="${RPT_TD}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div><div style="padding:6px 0;display:flex;gap:14px">${rptAddRowBtn('weeklyActions')}${rptAddColBtn('weekly','actions')}</div>`;

  /* Commentaire du manager : champ libre, pas un tableau. C'est le seul
     endroit du rapport où l'on écrit en prose — la slide « Commentary » du
     deck reprend ce texte tel quel, et affichait jusqu'ici un texte de
     repli faute de saisie possible. */
  const wkNoteVal = (weeklyForm.notes || [])
    .map(n => (typeof n === 'string' ? n : (n && (n.note || n.text)) || ''))
    .filter(t => String(t).trim()).join('\n');
  const sec_notes = `<div style="padding:12px 2px 4px">
          <textarea class="rpt-in" id="wk-notes" rows="4" oninput="rptGrow(this)"
            placeholder="Commentaire libre : lecture de la semaine, décisions attendues, points à porter en revue…"
            style="min-height:92px;line-height:1.5">${esc(wkNoteVal)}</textarea>
          <div style="margin-top:6px;font-size:11px;color:var(--mute)">
            Repris tel quel sur la slide «&nbsp;Commentary&nbsp;» du PPTX. Laissé vide, la slide affiche un texte par défaut.
          </div>
        </div>`;

  const wkBodies = { metrics: sec_metrics, breakdown: sec_breakdown, fo: sec_fo, highlights: sec_highlights, risks: sec_risks, actions: sec_actions, notes: sec_notes };
  const wkExtraStyle = { metrics: ';margin-top:0' };

  // Plus de cadre imprimé : le bandeau titre, la barre auteur/site et le
  // panneau latéral doublonnaient l'en-tête de page. Le contenu occupe
  // désormais toute la largeur. `weeklyForm.author` reste alimenté par
  // défaut — il part dans le PPTX et l'Excel.
  if (!weeklyForm.author) weeklyForm.author = rptDefaultAuthor();
  document.getElementById('weekly-report-content').innerHTML =
    getOrderedSections('weekly').map(([key, title], idx) => {
      const titles = { metrics: 'Weekly Summary', breakdown: 'Breakdown', fo: 'Performance Front Office', highlights: 'Operational Highlights', risks: 'Risks &amp; Issues', actions: 'Next Week Actions', notes: 'Manager Commentary' };
      return rptSection('weekly', key, titles[key] || title, wkBodies[key], idx === 0 ? ';margin-top:0' : (wkExtraStyle[key] || ''));
    }).join('');
  setTimeout(() => { document.querySelectorAll('#weekly-report-content textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }, 0);
}

