// ══════════════════════════════════════════════════════════════
// INSIGHT DE PERFORMANCE (page My Performance, agent)
//
// Une carte sous l'en-tête de la fiche : la lecture de Pear AI sur
// la fiche de l'agent. N'apparaît que si l'admin l'a activé pour lui
// (Pear AI › Réglages › Insights des agents). Les insights sont
// générés automatiquement par le serveur : l'agent ne fait que les lire.
// En vue admin d'une fiche (_adminPerfFo), la carte montre en lecture
// seule le dernier insight généré par l'agent.
// Page en anglais, comme le reste de My Performance.
// ══════════════════════════════════════════════════════════════
const MyIns = { etat: null, busy: false, err: '', fo: null, vu: null };   // vu : insight passé affiché

function _insDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; }
}

function _insHost() {
  const r = document.getElementById('myperf-result');
  if (!r) return null;
  let h = document.getElementById('myperf-insight');
  if (!h) {
    h = document.createElement('div');
    h.id = 'myperf-insight';
    // Juste sous l'en-tête de la fiche (score et palier).
    const hero = r.querySelector('.myperf-hero');
    if (hero) hero.after(h); else (r.querySelector('.myperf-res') || r).appendChild(h);
  }
  return h;
}

async function loadMyInsight() {
  MyIns.err = ''; MyIns.vu = null;
  const adminFo = typeof _adminPerfFo !== 'undefined' ? _adminPerfFo : null;
  try {
    if (adminFo) {
      const r = await fetch(`${API}/api/ai/insights/${encodeURIComponent(adminFo)}`, { headers: AdminSession.headers(), credentials: 'same-origin' });
      const d = r.ok ? await r.json() : {};
      MyIns.etat = { admin: true, actif: true, insight: d.insight || null, historique: d.historique || [] };
    } else if (MyPerf.token) {
      const r = await fetch(`${API}/api/my-insight`, { headers: { 'X-FO-Token': MyPerf.token } });
      MyIns.etat = r.ok ? await r.json() : { actif: false };
    } else MyIns.etat = { actif: false };
  } catch { MyIns.etat = { actif: false }; }
  _insPaint();
}

// Affiche un insight passé de l'historique (le sien pour l'agent).
async function myInsightOpen(id) {
  const adminFo = typeof _adminPerfFo !== 'undefined' ? _adminPerfFo : null;
  if (!id || (MyIns.etat?.insight && MyIns.etat.insight.id === id)) { MyIns.vu = null; _insPaint(); return; }
  try {
    const r = adminFo
      ? await fetch(`${API}/api/ai/insights/${encodeURIComponent(adminFo)}/${encodeURIComponent(id)}`, { headers: AdminSession.headers(), credentials: 'same-origin' })
      : await fetch(`${API}/api/my-insight/${encodeURIComponent(id)}`, { headers: { 'X-FO-Token': MyPerf.token } });
    if (!r.ok) throw new Error('This insight could not be opened.');
    MyIns.vu = (await r.json()).insight; MyIns.err = '';
  } catch (e) { MyIns.err = e.message; }
  _insPaint();
}

const _INS_ICO = {
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
};
const _insIco = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_INS_ICO[n]}</svg>`;

function _insPaint() {
  const h = _insHost();
  if (!h) return;
  const e = MyIns.etat;
  if (!e || !e.actif) { h.innerHTML = ''; return; }
  const i = MyIns.vu || e.insight;
  const hist = e.historique || [];
  const err = MyIns.err ? `<div class="mins-err">${esc(MyIns.err)}</div>` : '';

  if (MyIns.busy) {
    h.innerHTML = `<section class="mins is-wait"><span class="mins-badge">${_insIco('spark')}</span>
      <div><b>Reading your scorecard…</b><small>This takes a few seconds.</small></div>
      <div class="mins-dots"><i></i><i></i><i></i></div></section>`;
    return;
  }

  if (!i) {
    h.innerHTML = e.admin
      ? `<section class="mins is-empty"><span class="mins-badge">${_insIco('spark')}</span>
          <div><b>No insight yet</b><small>This agent has not asked for an insight.</small></div></section>`
      : `<section class="mins is-empty"><span class="mins-badge">${_insIco('spark')}</span>
          <div><b>Your personal insight is on its way</b><small>A short reading of your scorecard: what works, where your next points are, and one step for this week. It is prepared automatically and will appear here. Only you can see it.</small></div>${err}</section>`;
    return;
  }

  const d = i.data || {};
  const ancien = MyIns.vu && (!e.insight || MyIns.vu.id !== e.insight.id);
  const date = `${_insDate(i.at)} ${String(i.at).slice(0, 4)}`;
  const choix = hist.length > 1 ? `<select class="mins-hist" onchange="myInsightOpen(this.value)" aria-label="Previous insights">
      ${hist.map(x => `<option value="${esc(x.id)}"${x.id === i.id ? ' selected' : ''}>${esc(_insDate(x.at))} ${esc(String(x.at).slice(0, 4))}${e.insight && x.id === e.insight.id ? ' · latest' : ''}</option>`).join('')}
    </select>` : '';
  // Les insights sont générés automatiquement : l'agent ne fait que lire.
  const actu = ancien ? `<button class="mins-ghost" onclick="myInsightOpen('')">Back to latest</button>` : '';

  h.innerHTML = `<section class="mins">
    <header class="mins-top">
      <span class="mins-label"><span class="mins-badge is-sm">${_insIco('spark')}</span>Insight · ${esc(date)}${e.admin ? ' · read-only' : ''}</span>
      ${choix}
    </header>
    ${d.headline ? `<h3 class="mins-title">${esc(d.headline)}</h3>` : ''}
    <div class="mins-cols">
      ${(d.strengths || []).length ? `<div class="mins-col">
        <div class="mins-k">What works</div>
        <ul class="mins-ok">${d.strengths.map(x => `<li><span class="mins-tick">${_insIco('check')}</span>${esc(x)}</li>`).join('')}</ul>
      </div>` : ''}
      ${(d.focus || []).length ? `<div class="mins-col">
        <div class="mins-k">Where to gain points</div>
        <ol class="mins-gain">${d.focus.map((f, n) => `<li><span class="mins-n">${n + 1}</span><div>
          <b>${esc(f.area || '')}</b>${f.why ? `<p>${esc(f.why)}</p>` : ''}${f.how ? `<p class="mins-how">${esc(f.how)}</p>` : ''}</div></li>`).join('')}</ol>
      </div>` : ''}
    </div>
    ${d.next_step ? `<div class="mins-week"><span class="mins-week-ico">${_insIco('target')}</span><div><span class="mins-k">This week</span><p>${esc(d.next_step)}</p></div></div>` : ''}
    ${d.encouragement ? `<p class="mins-enc">${esc(d.encouragement)}</p>` : ''}
    <footer class="mins-foot"><span>Pear AI can be wrong: talk it through with your manager.</span>${actu}</footer>
    ${err}
  </section>`;
}

// Après chaque rendu de la fiche (agent ou vue admin), la carte suit.
(function () {
  if (typeof _renderMyPerf !== 'function' || _renderMyPerf.__ins) return;
  const orig = _renderMyPerf;
  _renderMyPerf = function () {
    const out = orig.apply(this, arguments);
    MyIns.etat = null;
    _insPaint();
    loadMyInsight();
    return out;
  };
  _renderMyPerf.__ins = true;
})();
