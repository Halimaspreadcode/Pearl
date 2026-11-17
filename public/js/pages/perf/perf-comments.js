// ── Commentaires de la notation mensuelle ─────────────────────
// Écrit directement dans fo_scorecards[mois][fo]._notes. Chaque geste
// persiste : un commentaire saisi ne dépend pas du bouton « Enregistrer »
// de la notation, qui ne concerne que les six critères chiffrés.
async function _perfCommitNotes(mutate) {
  const fo = perfUI.fo, month = perfUI.month;
  if (!fo || !month) return false;
  const cards = JSON.parse(JSON.stringify(_perfScorecards()));
  cards[month] = cards[month] || {};
  const card = cards[month][fo] = cards[month][fo] || {};
  // Première écriture : la note héritée devient une vraie entrée.
  card._notes = _noteList(card)
    .map(n => n.id === 'legacy' ? { ...n, id: 'n' + Date.now().toString(36) } : n);
  delete card._note;
  mutate(card._notes);
  if (!card._notes.length) delete card._notes;
  if (!Object.keys(card).length) delete cards[month][fo];

  const cfg = { ...state.config, fo_scorecards: cards };
  const res = await fetch(`${API}/api/config`, {
    method: 'PUT', headers: AdminSession.headers({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin', body: JSON.stringify(cfg) });
  if (!res.ok) { toast('Server error', 'error'); return false; }
  await loadConfig();
  renderPerfSheet();
  return true;
}

// ── Gestionnaires communs aux deux fils ───────────────────────
// Le namespace dit d'où vient l'appel : « pn » = commentaires du mois,
// « on-<idObjectif> » = suivi d'un objectif personnel. Une seule
// implémentation sert les deux, seule la cible de l'écriture change.
function _ntTarget(ns) {
  if (ns === 'pn') {
    return { commit: mutate => _perfCommitNotes(mutate) };
  }
  if (ns.startsWith('on-')) {
    const objId = ns.slice(3);
    return { commit: mutate => _o2oCommitNotes(objId, mutate) };
  }
  return null;
}

async function ntAdd(ns) {
  const ta = document.getElementById(`${ns}-new`);
  const text = (ta?.value || '').trim();
  if (!text) { ta?.focus(); return; }
  const t = _ntTarget(ns);
  if (t && await t.commit(list => list.push(_noteNew(text))))
    toast('Comment added', 'success');
}

// L'édition se fait sur place : le texte cède la place à un champ, sans
// boîte de dialogue ni changement d'écran.
function ntEdit(ns, id)   { _ntToggleEdit(ns, id, true); }
function ntCancel(ns, id) { _ntToggleEdit(ns, id, false); }

async function ntSave(ns, id) {
  const ta = document.getElementById(`${ns}-ta-${id}`);
  const text = (ta?.value || '').trim();
  if (!text) { toast('Empty comment', 'error'); return; }
  const t = _ntTarget(ns);
  if (t && await t.commit(list => {
    const n = list.find(x => x.id === id);
    if (n) { n.text = text.slice(0, 4000); n.edited = true; n.at = n.at || new Date().toISOString(); }
  })) toast('Comment edited', 'success');
}

async function ntDel(ns, id) {
  if (!confirm('Delete this comment?')) return;
  const t = _ntTarget(ns);
  if (t && await t.commit(list => {
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list.splice(i, 1);
  })) toast('Comment deleted', 'success');
}

const NT_FNS = { add: 'ntAdd', edit: 'ntEdit', save: 'ntSave', cancel: 'ntCancel', del: 'ntDel' };

// Bascule affichage / édition d'une entrée, commune aux deux fils.
function _ntToggleEdit(ns, id, on) {
  const body = document.getElementById(`${ns}-body-${id}`);
  const edit = document.getElementById(`${ns}-edit-${id}`);
  if (!body || !edit) return;
  body.hidden = on;
  edit.hidden = !on;
  if (on) {
    const ta = document.getElementById(`${ns}-ta-${id}`);
    ta?.focus();
    // Curseur en fin de texte plutôt qu'au début.
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

