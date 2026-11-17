const { readAudit, writeAudit } = require('./store');

// ── AUDIT HELPER ─────────────────────────────────────────────
function addAudit(tracker, ticket_id, user, action, changes) {
  const audit = readAudit();
  audit.unshift({
    id: require('crypto').randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    tracker, ticket_id, user, action, changes
  });
  if (audit.length > 2000) audit.splice(2000);
  writeAudit(audit);
}

module.exports = {
  addAudit,
};
