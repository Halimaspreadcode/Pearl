// ══════════════════════════════════════════════════════════════
// ABONNEMENT AU SIÈGE
//
// Une organisation paie un nombre de sièges, au prix de son offre.
// Un siège = un membre qui peut agir (owner, admin, manager, agent) ou une
// invitation en attente pour l'un de ces rôles. Les comptes en lecture
// seule (observer) sont gratuits et illimités.
//
// L'état vit dans pearl_tenants.billing (jsonb) :
//   { plan, seats, interval: 'month'|'year', currency, history: [...] }
// Le paiement passe par un fournisseur (PEARL_BILLING_PROVIDER) ; seul
// « manual » existe pour l'instant : les changements s'appliquent tout de
// suite et la facture est émise hors de l'application.
// ══════════════════════════════════════════════════════════════
const PLANS = [
  { id: 'essentiel',  label: 'Essentiel',  price: num('PEARL_PRICE_ESSENTIEL', 9),  desc: 'Tickets, planning et rapports pour une équipe.', features: ['Modules de base', 'Rapports mensuels', 'Support par email'] },
  { id: 'business',   label: 'Business',   price: num('PEARL_PRICE_BUSINESS', 19),  desc: 'Tous les modules, plusieurs sites, diffusion automatique.', features: ['Tous les modules', 'Sites illimités', 'Diffusion des rapports', 'Domaine personnalisé'] },
  { id: 'entreprise', label: 'Entreprise', price: num('PEARL_PRICE_ENTREPRISE', 29), desc: 'Pour les grandes équipes : accompagnement et engagements.', features: ['Tout Business', "Journal d'activité complet", 'Accompagnement dédié', 'Engagement de disponibilité'] },
];
function num(k, d) { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; }

const PAID_ROLES = ['owner', 'admin', 'manager', 'agent'];
const MAX_SEATS = 10000;
const TRIAL_SEATS = 5;
const YEAR_DISCOUNT = 0.2;   // −20 % en paiement annuel

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const planOf = id => PLANS.find(p => p.id === id) || null;

// État d'abonnement complet, valeurs par défaut comprises.
function billingOf(t) {
  const b = (t && t.billing) || {};
  const plan = planOf(b.plan) || planOf(t && t.plan) || PLANS[1];
  const trial = t && t.status === 'trial';
  return {
    plan: plan.id,
    seats: Math.max(1, Math.min(MAX_SEATS, Number(b.seats) || TRIAL_SEATS)),
    interval: b.interval === 'year' ? 'year' : 'month',
    currency: b.currency || 'EUR',
    provider: process.env.PEARL_BILLING_PROVIDER || 'manual',
    trial, trial_ends_at: (t && t.trial_ends_at) || null,
    history: Array.isArray(b.history) ? b.history.slice(0, 50) : [],
  };
}

// Prix : par siège et par mois ; l'annuel est remisé.
function priceOf(b) {
  const p = planOf(b.plan) || PLANS[1];
  const unit = b.interval === 'year' ? round(p.price * (1 - YEAR_DISCOUNT)) : p.price;
  const monthly = round(unit * b.seats);
  return { unit, monthly, total: b.interval === 'year' ? round(monthly * 12) : monthly, currency: b.currency };
}
const round = x => Math.round(x * 100) / 100;

// Sièges occupés : membres payants + invitations payantes en attente.
function seatUsage(members, invites) {
  const m = (members || []).filter(x => PAID_ROLES.includes(x.role)).length;
  const i = (invites || []).filter(x => PAID_ROLES.includes(x.role)).length;
  return { members: m, invites: i, used: m + i };
}

// Refuse une opération qui ferait dépasser les sièges achetés.
function assertSeat(tenant, members, invites, role, extra = 1) {
  if (!PAID_ROLES.includes(role)) return;
  const b = billingOf(tenant);
  const u = seatUsage(members, invites);
  if (u.used + extra > b.seats) {
    throw err(`Tous les sièges sont occupés (${u.used}/${b.seats}). Ajoutez des sièges dans Organisation › Abonnement, ou invitez en lecture seule (gratuit).`, 402);
  }
}

// Nouvel état après une demande de changement (propriétaire ou console).
function applyChange(tenant, members, invites, change, by) {
  const cur = billingOf(tenant);
  const next = { ...cur };
  if (change.plan != null) {
    if (!planOf(change.plan)) throw err('Offre inconnue.');
    next.plan = change.plan;
  }
  if (change.interval != null) next.interval = change.interval === 'year' ? 'year' : 'month';
  if (change.seats != null) {
    const s = Math.floor(Number(change.seats));
    if (!Number.isFinite(s) || s < 1 || s > MAX_SEATS) throw err(`Nombre de sièges invalide (1 à ${MAX_SEATS}).`);
    const used = seatUsage(members, invites).used;
    if (s < used) throw err(`Impossible de descendre sous ${used} sièges : ils sont occupés. Retirez d'abord des membres ou des invitations.`);
    next.seats = s;
  }
  const changed = ['plan', 'seats', 'interval'].filter(k => next[k] !== cur[k]);
  if (!changed.length) return { billing: stored(cur), changed };
  const entry = { at: new Date().toISOString(), by: by || 'system' };
  for (const k of changed) entry[k] = [cur[k], next[k]];
  next.history = [entry, ...cur.history].slice(0, 50);
  return { billing: stored(next), changed, entry };
}
const stored = b => ({ plan: b.plan, seats: b.seats, interval: b.interval, currency: b.currency, history: b.history });

// Vue envoyée aux écrans (organisation et console).
function summary(tenant, members, invites) {
  const b = billingOf(tenant);
  const usage = seatUsage(members, invites);
  return { ...b, price: priceOf(b), usage, free_observers: (members || []).filter(x => x.role === 'observer').length,
    plans: PLANS.map(p => ({ ...p, year_unit: round(p.price * (1 - YEAR_DISCOUNT)) })), year_discount: YEAR_DISCOUNT };
}

module.exports = { PLANS, PAID_ROLES, TRIAL_SEATS, billingOf, priceOf, seatUsage, assertSeat, applyChange, summary, planOf };
