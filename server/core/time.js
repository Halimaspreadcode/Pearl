const { DRILL_END_H, DRILL_START_H } = require('./sla');

// ── REPORTING TIMEZONE ────────────────────────────────────────
// Period boundaries (a "day", a "week", a "month") must be anchored to the
// operations timezone, not to whatever the host VM happens to be set to.
// Without this, moving the app to a VM in another timezone silently shifts
// tickets into the wrong report. Defaults to UTC.
function reportTZ(cfg) {
  return (cfg && cfg.timezone) || process.env.REPORT_TZ || 'UTC';
}

// Wall-clock parts of an instant, as seen in `tz`.
function tzParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const DOW = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    dow: DOW[p.weekday],
  };
}

// Offset (ms) between `tz` and UTC at a given instant - DST aware.
function tzOffsetMs(date, tz) {
  const s = tzParts(date, tz);
  const asUTC = Date.UTC(s.year, s.month - 1, s.day, s.hour, s.minute, s.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

// The UTC instant corresponding to a wall-clock time in `tz`. Resolved in two
// passes so the offset is taken at the target instant, not at "now".
function zonedTimeToUtc(y, m, d, hh, mm, ss, ms, tz) {
  const guess = Date.UTC(y, m, d, hh, mm, ss, ms);
  const off1  = tzOffsetMs(new Date(guess), tz);
  const off2  = tzOffsetMs(new Date(guess - off1), tz);
  return guess - off2;
}

// Start of the day containing `ref`, in `tz`.
function tzStartOfDay(ref, tz) {
  const p = tzParts(ref, tz);
  return new Date(zonedTimeToUtc(p.year, p.month - 1, p.day, 0, 0, 0, 0, tz));
}
function tzEndOfDay(ref, tz) {
  const p = tzParts(ref, tz);
  return new Date(zonedTimeToUtc(p.year, p.month - 1, p.day, 23, 59, 59, 999, tz));
}
// Monday-based (ISO) start of the week containing `ref`.
function tzStartOfWeek(ref, tz) {
  const p   = tzParts(ref, tz);
  const dow = p.dow === 0 ? 7 : p.dow;          // Sun→7 so Monday is day 1
  const day = tzStartOfDay(ref, tz);
  return new Date(day.getTime() - (dow - 1) * 86400000);
}

// ISO-8601 week number of the week containing `ref`, so the Monthly report can
// label its rows with the same week numbers the Weekly report uses.
function isoWeekNumber(ref, tz) {
  const monday = tzStartOfWeek(ref, tz);
  const p = tzParts(monday, tz);
  const thursday = Date.UTC(p.year, p.month - 1, p.day) + 3 * 86400000;  // ISO: week owns its Thursday
  const t = new Date(thursday);
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / 86400000 / 7) + 1;
}

// ── WORKED TIME (MTTD / MTTR) ─────────────────────────────────
// In drill mode the team only works 08:30-17:30, so elapsed wall-clock time
// overstates how long detection/resolution actually took: a ticket raised at
// 17:00 and closed at 09:00 next morning shows 16 h elapsed but only 1 h of
// real work. Drill counts those hours every day, weekends included.
const DRILL_DAY_MS = (DRILL_END_H - DRILL_START_H) * 3600000;   // 9 h

// Minutes of the drill window elapsed between local midnight and `p`.
function drillMinutesIntoDay(p) {
  const h = p.hour + p.minute / 60 + p.second / 3600;
  if (h <= DRILL_START_H) return 0;
  if (h >= DRILL_END_H)   return DRILL_DAY_MS;
  return (h - DRILL_START_H) * 3600000;
}

// Working milliseconds between two instants, honouring work_mode.
// Computed by whole-day arithmetic rather than minute-stepping, so it stays
// O(1) regardless of how far apart the two dates are.
function workedMs(startIso, endIso, cfg) {
  const start = new Date(startIso), end = new Date(endIso);
  const ms = end - start;
  if (isNaN(ms)) return null;
  if (ms <= 0) return ms === 0 ? 0 : null;          // negative = bad data
  if ((cfg.work_mode || 'live') !== 'drill') return ms;

  const tz = reportTZ(cfg);
  const sd = tzStartOfDay(start, tz), ed = tzStartOfDay(end, tz);
  const sp = tzParts(start, tz),      ep = tzParts(end, tz);

  // Same calendar day: just the slice of the window between the two times.
  if (sd.getTime() === ed.getTime()) {
    return Math.max(0, drillMinutesIntoDay(ep) - drillMinutesIntoDay(sp));
  }

  const firstDay = DRILL_DAY_MS - drillMinutesIntoDay(sp);   // rest of day 1
  const lastDay  = drillMinutesIntoDay(ep);                  // start of day N
  const fullDays = Math.round((ed - sd) / 86400000) - 1;     // days in between
  return Math.max(0, firstDay + fullDays * DRILL_DAY_MS + lastDay);
}

module.exports = {
  reportTZ, tzParts, zonedTimeToUtc, tzStartOfDay, tzEndOfDay, tzStartOfWeek,
  isoWeekNumber, workedMs,
};
