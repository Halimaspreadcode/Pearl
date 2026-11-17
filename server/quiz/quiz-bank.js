/**
 * BANQUE DE QUIZ INTÉGRÉE
 *
 * Vide par défaut : chaque organisation (tenant) apporte ses propres
 * contenus, créés depuis l'interface (data/quizzes.json) ou fournis par
 * un « pack métier ». Les quiz de la banque sont en lecture seule
 * (`builtin: true`) ; un quiz maison qui reprend l'id d'un quiz de la
 * banque le remplace.
 *
 * Pour livrer une banque avec un pack métier, ajouter des entrées à BANK
 * via `lvl(meta, questions, mod)`.
 */

// Barème de réussite par niveau, en %.
const PASS_MARK = { 1: 80, 2: 80, 3: 70, 4: 70, 5: 70, 6: 65 };

const LEVELS = [
  { level: 1, key: 'fondamentaux', label: 'Niveau 1 — Fondamentaux',   blurb: 'Le vocabulaire et les réflexes de base.' },
  { level: 2, key: 'pratique',     label: 'Niveau 2 — Pratique',        blurb: 'Les situations du quotidien.' },
  { level: 3, key: 'engagement',   label: 'Niveau 3 — Engagements',     blurb: 'Délais, qualité, engagements client.' },
  { level: 4, key: 'technique',    label: 'Niveau 4 — Technique',       blurb: 'Comprendre les outils et la chaîne technique.' },
  { level: 5, key: 'avance',       label: 'Niveau 5 — Avancé',          blurb: 'Analyser, diagnostiquer, prouver.' },
  { level: 6, key: 'excellence',   label: 'Niveau 6 — Excellence',      blurb: 'Amélioration continue.' },
];

const MODULES = [
  { key: 'socle', tag: '', label: 'Socle', blurb: 'Le parcours principal du niveau.' },
];

// Temps de réponse par question (s), selon le niveau.
const TIME_PER_QUESTION = { 1: 45, 2: 45, 3: 60, 4: 60, 5: 75, 6: 90 };

// Construit un quiz de niveau à partir de ses questions.
function lvl(meta, questions, mod = MODULES[0]) {
  const socle = mod.key === 'socle';
  return {
    id: socle ? `bank-l${meta.level}-${meta.key}` : `bank-l${meta.level}-${mod.key}`,
    name: socle ? meta.label : `${meta.label} · ${mod.label}`,
    description: socle ? meta.blurb : mod.blurb,
    level: meta.level,
    module: mod.key,
    pass_mark: PASS_MARK[meta.level],
    timer_mode: 'per_question',
    timer_value: TIME_PER_QUESTION[meta.level],
    builtin: true,
    default_published: socle,
    created_at: '2026-01-01T00:00:00.000Z',
    questions: questions.map((q, i) => ({
      id: `bk${meta.level}${mod.tag}${String(i + 1).padStart(3, '0')}`,
      ...q,
    })),
  };
}

const BANK = [];

function mergeWithBank(custom) {
  const list = Array.isArray(custom) ? custom : [];
  const overridden = new Set(list.map(q => q && q.id));
  const base = BANK.filter(q => !overridden.has(q.id));
  return [...base, ...list];
}

module.exports = { BANK, LEVELS, MODULES, PASS_MARK, TIME_PER_QUESTION, lvl, mergeWithBank };
