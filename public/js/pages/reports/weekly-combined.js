/* ── Weekly Performance, tous les sites ───────────────────────
   Deck de revue présenté aux deux équipes (server/documents/
   weekly-combined-pptx.js). Avant de générer, on demande les
   explications : le serveur dit ce qui sort de l'ordinaire (pics
   d'activité, absences, incidents de plateforme) et propose ce
   que les Observations en disent déjà.

   L'export est bloqué tant qu'un point requis n'est ni expliqué ni
   marqué « Not needed » : un pic dû à une simple migration planifiée
   n'a pas toujours besoin d'un paragraphe, mais la décision de passer
   doit être prise, pas subie. Les commentaires facultatifs se passent
   librement.

   Les textes sont gardés en brouillon local, par semaine : on prépare la
   revue en plusieurs fois sans tout ressaisir. */

const WkC = { analysis: null, texts: {}, skipped: new Set() };

// Commentaires facultatifs : un espace par page, rempli ou laissé en
// pointillés pour la séance.
// Un espace « semaine prochaine » par site de l'analyse.
function _wkcOptional() {
  return [
    ['summary',   'Key takeaways', 'Side-by-side figures'],
    ['breakdown', 'Where the load came from', 'Breakdown by domain'],
    ['trend',     'What the trend says', 'Eight-week trend'],
    ...((WkC.analysis && WkC.analysis.sites) || []).slice(0, 4).map(s => [`next-${s.code}`, `Next week: ${s.ville}`, 'Focus and actions']),
  ];
}

function _wkcDraftKey() { return `wkc-draft-${WkC.analysis?.week_start?.slice(0, 10) || ''}`; }
function _wkcLoadDraft() {
  try { return JSON.parse(localStorage.getItem(_wkcDraftKey()) || '{}') || {}; } catch { return {}; }
}
function _wkcSaveDraft() {
  try {
    localStorage.setItem(_wkcDraftKey(), JSON.stringify({ texts: WkC.texts, skipped: [...WkC.skipped] }));
  } catch { /* stockage indisponible */ }
}

function _wkcModal() {
  let el = document.getElementById('wkc-modal');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'modal-overlay';
  el.id = 'wkc-modal';
  el.innerHTML = `
    <div class="modal wkc-modal">
      <div class="modal-header">
        <div class="modal-title">Weekly Performance: all sites
          <span id="wkc-period" class="text-muted" style="font-weight:400;font-size:12px;margin-left:8px"></span></div>
        <button class="modal-close" onclick="closeModal('wkc-modal')">&times;</button>
      </div>
      <div class="modal-body" id="wkc-body"></div>
      <div class="modal-footer">
        <span id="wkc-left" class="wkc-left"></span>
        <button class="btn btn-ghost" onclick="closeModal('wkc-modal')">Close</button>
        <button class="btn btn-primary" id="wkc-gen" onclick="generateWeeklyCombined()">PPTX preview</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

async function openWeeklyCombined() {
  const modal = _wkcModal();
  const body = document.getElementById('wkc-body');
  body.innerHTML = '<div class="wkc-loading">Analysing the week…</div>';
  modal.classList.add('open');
  try {
    const date = typeof weeklyAnchorDate === 'string' ? weeklyAnchorDate : '';
    const res = await fetch(`${API}/api/reports/weekly-combined?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('Analysis failed');
    WkC.analysis = await res.json();
  } catch (e) {
    body.innerHTML = `<div class="wkc-loading">${esc(e.message || 'Server unreachable')}</div>`;
    return;
  }
  // Brouillon de la semaine, sinon les propositions tirées des Observations.
  // Les premiers brouillons rangeaient les textes à plat, sans `texts`.
  const raw = _wkcLoadDraft();
  const draft = raw.texts || raw;
  WkC.skipped = new Set(Array.isArray(raw.skipped) ? raw.skipped : []);
  WkC.texts = {};
  (WkC.analysis.to_explain || []).forEach(it => {
    WkC.texts[it.key] = draft[it.key] ?? it.suggestion ?? '';
  });
  _wkcOptional().forEach(([k]) => { WkC.texts[k] = draft[k] ?? ''; });
  [...(WkC.analysis.sites || []).map(s => `activity-${s.code}`), 'attendance'].forEach(k => {
    if (!(k in WkC.texts)) WkC.texts[k] = draft[k] ?? '';
  });
  _wkcRender();
}

function _wkcRender() {
  const a = WkC.analysis;
  const body = document.getElementById('wkc-body');
  if (!a || !body) return;
  const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  document.getElementById('wkc-period').textContent = `${fmt(a.week_start)} → ${fmt(a.week_end)}`;

  const field = (key, title, hint, required) => {
    const skipped = required && WkC.skipped.has(key);
    const missing = required && !skipped && !String(WkC.texts[key] || '').trim();
    return `
    <div class="wkc-item${missing ? ' is-missing' : ''}${skipped ? ' is-skipped' : ''}" data-key="${esc(key)}">
      <div class="wkc-item-top">
        <div class="wkc-item-t">${required ? `<span class="wkc-req">${skipped ? 'Not needed' : 'Required'}</span>` : ''}${esc(String(title).replace(/\s*[\u2014\u2013]\s*/g, ' - '))}</div>
        ${required ? `<button type="button" class="btn btn-ghost btn-sm wkc-skip" onclick="wkcToggleSkip('${esc(key)}')">${
          skipped ? 'Explain it' : 'Not needed'}</button>` : ''}
      </div>
      ${hint ? `<div class="wkc-item-h">${esc(hint)}</div>` : ''}
      ${skipped ? '' : `<textarea class="form-control" rows="2" placeholder="${required
          ? 'Explain what happened: cause, impact, what was done.'
          : 'Optional: left as blank lines on the slide.'}"
        oninput="wkcSet('${esc(key)}', this.value, this)">${esc(WkC.texts[key] || '')}</textarea>`}
    </div>`;
  };

  const req = a.to_explain || [];
  const sites = a.sites || [];
  // Pas de pic sur un site : la page d'activité garde un espace libre.
  const calmes = sites.filter(s => !s.peaks.length && !s.week_peak);
  const att = a.attendance || {};

  body.innerHTML = `
    <div class="wkc-sum">
      ${sites.map(s => `<div class="wkc-site">
        <b>${esc(s.ville)}</b>
        <span>${s.kpis.opened_this_week ?? 0} opened · ${s.kpis.resolved_this_week ?? 0} resolved ·
          SLA ${s.kpis.sla_compliance == null ? 'n/a' : Math.round(s.kpis.sla_compliance) + '%'}</span>
      </div>`).join('')}
      <div class="wkc-site"><b>Team attendance</b>
        <span>${att.presence_rate ?? 'n/a'}% presence · ${att.absence_days ?? 0} absence day(s)</span></div>
    </div>

    <div class="wkc-sec-t">To explain <span>${req.length}</span></div>
    <div class="wkc-sec-d">Activity peaks, absences and platform incidents must be explained before
      the export, or marked as not needed. Suggestions come from the Observations of the week:
      edit them freely.</div>
    ${req.length ? req.map(it => field(it.key, it.title,
        it.kind === 'outage' ? 'Platform incident from Observations' : '', true)).join('')
      : '<div class="wkc-none">Nothing unusual this week: no peak, no absence, no platform incident.</div>'}

    <div class="wkc-sec-t">Commentary <span>optional, can be skipped</span></div>
    ${_wkcOptional().map(([k, t, h]) => field(k, t, h, false)).join('')}
    ${calmes.map(s => field(`activity-${s.code}`, `${s.ville}: weekly activity`, 'No peak this week', false)).join('')}
    ${att.required ? '' : field('attendance', 'Team attendance', 'Full attendance this week', false)}`;
  _wkcCountLeft();
}

function wkcSet(key, value, el) {
  WkC.texts[key] = value;
  _wkcSaveDraft();
  const item = el?.closest('.wkc-item');
  if (item && item.querySelector('.wkc-req')) item.classList.toggle('is-missing', !value.trim());
  _wkcCountLeft();
}

function wkcToggleSkip(key) {
  if (WkC.skipped.has(key)) WkC.skipped.delete(key); else WkC.skipped.add(key);
  _wkcSaveDraft();
  // Re-rendu complet : la zone de texte apparaît ou disparaît. On garde
  // la position de défilement, sinon la fenêtre remonte en haut.
  const body = document.getElementById('wkc-body');
  const top = body ? body.scrollTop : 0;
  _wkcRender();
  if (body) body.scrollTop = top;
}

function _wkcMissing() {
  return (WkC.analysis?.to_explain || []).filter(it => it.required
    && !WkC.skipped.has(it.key) && !String(WkC.texts[it.key] || '').trim());
}

function _wkcCountLeft() {
  const el = document.getElementById('wkc-left');
  if (!el) return;
  const n = _wkcMissing().length;
  el.textContent = n
    ? `${n} point${n > 1 ? 's' : ''} to explain or mark as not needed before export`
    : 'Ready to export';
  el.classList.toggle('is-missing', !!n);
  // Pas d'export tant qu'un point requis reste ouvert.
  const btn = document.getElementById('wkc-gen');
  if (btn && btn.textContent !== 'Generating…') btn.disabled = !!n;
}

async function generateWeeklyCombined() {
  const manquants = _wkcMissing();
  if (manquants.length) {
    // Amène l'utilisateur au premier point à traiter.
    document.querySelector(`.wkc-item[data-key="${CSS.escape(manquants[0].key)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Fill in the required explanations or mark them as not needed', 'error');
    return;
  }
  const btn = document.getElementById('wkc-gen');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const res = await fetch(`${API}/api/reports/weekly-combined.pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: typeof weeklyAnchorDate === 'string' ? weeklyAnchorDate : '',
        form: {
          author: (typeof weeklyForm === 'object' && weeklyForm.author)
            || (typeof rptDefaultAuthor === 'function' ? rptDefaultAuthor() : ''),
          explanations: WkC.texts,
          skipped: [...WkC.skipped],
        },
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'PPTX generation failed');
    }
    // Même aperçu que le Weekly Report : on relit le vrai fichier avant
    // de le télécharger, sous son propre nom.
    weeklyPptxBlob = await res.blob();
    weeklyPptxName = `Pearl_Weekly_Performance_${WkC.analysis.week_start.slice(0, 10)}.pptx`;
    closeModal('wkc-modal');
    const modal = document.getElementById('pptx-preview-modal');
    const body = document.getElementById('pptx-preview-body');
    if (modal && body && typeof renderPptxPreview === 'function') {
      body.innerHTML = '<div class="pptx-preview-loading">Rendering preview…</div>';
      modal.classList.add('open');
      const count = await renderPptxPreview(weeklyPptxBlob, body, { scale: 96 });
      const cnt = document.getElementById('pptx-preview-count');
      if (cnt) cnt.textContent = `${count} slide${count > 1 ? 's' : ''}`;
    } else {
      downloadWeeklyPptx();
    }
  } catch (e) {
    toast(e.message || 'Server unreachable', 'error');
  } finally {
    if (btn) btn.textContent = 'PPTX preview';
    _wkcCountLeft();
  }
}
