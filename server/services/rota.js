const { v4: uuidv4 } = require('uuid');

// Weekday-only rotation (Abidjan EMOC logic): Mon–Fri, no rest days, 3 teams
// rotate across 3 shifts. Each working day (weekends skipped), every team's
// shift index shifts by +1: team on shift[k] today moves to shift[k-1] tomorrow,
// i.e. pattern(day n)[k] = pattern(day 0)[(k + workdayIndex) % teamCount].
function generateWeekdayRotationServer(site, siteId, startDateISO, weeks) {
  const shiftDefs = site.shifts || [];
  const teams = site.teams || [];
  const teamCount = teams.length || shiftDefs.length;
  // Base pattern on day 0: which team (by index) works each shift index.
  // rota_start_offset lets the config pick which team starts on shift 0
  // without depending on the order teams were entered in.
  const startOffset = site.rota_start_offset || 0;
  const basePattern = shiftDefs.map((_, k) => (k + startOffset) % teamCount);

  const start = new Date(startDateISO);
  const dow = start.getDay();
  const diffToMon = dow === 0 ? 1 : (dow === 1 ? 0 : -(dow - 1));
  start.setDate(start.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);

  const assignments = [];
  let workdayIndex = 0;

  for (let d = 0; d < weeks * 7; d++) {
    const date = new Date(start);
    date.setDate(start.getDate() + d);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (isWeekend) continue;

    const dateISO = date.toISOString().slice(0, 10);

    shiftDefs.forEach((shiftDef, k) => {
      const teamIdx = basePattern[(k + workdayIndex) % teamCount];
      const team = teams[teamIdx];
      if (!team) return;
      (team.members || []).forEach(fo => {
        assignments.push({
          id:         uuidv4().slice(0, 8),
          fo_name:    fo,
          team_id:    team.id,
          team_name:  team.name,
          tracker:    team.tracker,
          site_id:    siteId,
          site_name:  site.name,
          shift_id:   shiftDef.id,
          shift_name: shiftDef.name || shiftDef.id,
          shift_type: `${site.name} - ${shiftDef.name || shiftDef.id} (${shiftDef.start || ''}–${shiftDef.end || ''})`,
          date:       dateISO,
          is_rest:    false,
          is_rota:    true,
          status:     'Scheduled',
          created_at: new Date().toISOString(),
        });
      });
    });

    workdayIndex++;
  }

  return assignments;
}

// ── ROTA GENERATION ───────────────────────────────────────────
// Pure algorithm: cycle 5/2, ≤40h, balanced shift rotation
// anchorOffsets: { [fo_name]: cycleOffset } — if provided, cycle continues from these offsets
// instead of being derived from teamIdx alone (used for year generation continuity).
function generateRotaServer(rotaConfig, siteId, startDateISO, weeks, anchorOffsets = {}) {
  const site = (rotaConfig.sites || []).find(s => s.id === siteId);
  if (!site) return [];

  if (site.rota_mode === 'weekday_rotation') {
    return generateWeekdayRotationServer(site, siteId, startDateISO, weeks);
  }

  const shiftDefs = site.shifts || [];
  const shiftIds  = shiftDefs.map(s => s.id);

  const start = new Date(startDateISO);
  const dow = start.getDay();
  const diffToMon = dow === 0 ? 1 : (dow === 1 ? 0 : -(dow - 1));
  start.setDate(start.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);

  const assignments = [];
  const cycle = [...shiftIds, 'rest', 'rest'];
  const cycleLen = cycle.length;

  (site.teams || []).forEach((team, teamIdx) => {
    const members = team.members || [];
    members.forEach((fo) => {
      // Use pre-computed anchor offset if available (continuity from previous period),
      // otherwise fall back to the stagger-by-team default.
      const baseOffset = (fo in anchorOffsets) ? anchorOffsets[fo] : teamIdx;

      for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
          const date = new Date(start);
          date.setDate(start.getDate() + w * 7 + d);
          const dateISO = date.toISOString().slice(0, 10);

          const dayIndex = w * 7 + d;
          const cyclePos = (dayIndex + baseOffset) % cycleLen;
          const shiftId  = cycle[cyclePos];
          const isRest   = shiftId === 'rest';

          assignments.push({
            id:         uuidv4().slice(0, 8),
            fo_name:    fo,
            team_id:    team.id,
            team_name:  team.name,
            tracker:    team.tracker,
            site_id:    siteId,
            site_name:  site.name,
            shift_id:   isRest ? 'rest' : shiftId,
            shift_name: isRest ? 'Rest' : (shiftDefs.find(s => s.id === shiftId)?.name || shiftId),
            shift_type: isRest ? 'Rest' : `${site.name} - ${shiftDefs.find(s => s.id === shiftId)?.name || shiftId} (${shiftDefs.find(s => s.id === shiftId)?.start || ''}–${shiftDefs.find(s => s.id === shiftId)?.end || ''})`,
            date:       dateISO,
            is_rest:    isRest,
            is_rota:    true,
            status:     isRest ? 'Rest' : 'Scheduled',
            created_at: new Date().toISOString(),
          });
        }
      }
    });
  });

  return assignments;
}

// Compute per-FO cycle offset from the last known rota entry before startDate.
// Returns { [fo_name]: cycleOffset } so the new generation continues seamlessly.
function computeAnchorOffsets(existingPlan, site, shiftIds, startDateISO) {
  const cycle = [...shiftIds, 'rest', 'rest'];
  const cycleLen = cycle.length;
  const offsets = {};

  (site.teams || []).forEach((team, teamIdx) => {
    (team.members || []).forEach(fo => {
      // Find the latest rota entry for this FO strictly before startDate
      const prior = existingPlan
        .filter(e => e.is_rota && e.fo_name === fo && e.site_id === site.id && e.date < startDateISO)
        .sort((a, b) => b.date.localeCompare(a.date));

      if (!prior.length) {
        offsets[fo] = teamIdx; // no history — use default stagger
        return;
      }

      const lastEntry = prior[0];
      const lastShiftId = lastEntry.shift_id || 'rest';
      const lastPosInCycle = cycle.indexOf(lastShiftId);

      // Days between lastEntry.date and startDate (which is a Monday)
      const lastDate  = new Date(lastEntry.date); lastDate.setHours(0,0,0,0);
      const startDate = new Date(startDateISO);   startDate.setHours(0,0,0,0);
      const daysDiff  = Math.round((startDate - lastDate) / 86400000);

      // The offset that, at day 0, produces lastShiftId is: lastPosInCycle - daysDiff + n*cycleLen
      // We want the baseOffset such that (0 + baseOffset) % cycleLen === nextPos
      const nextPos = (lastPosInCycle < 0 ? 0 : lastPosInCycle + daysDiff) % cycleLen;
      offsets[fo] = ((nextPos % cycleLen) + cycleLen) % cycleLen;
    });
  });

  return offsets;
}

module.exports = {
  generateRotaServer, computeAnchorOffsets,
};
