/**
 * Calendar days in the business's own time zone, not the server's. The
 * server runs in UTC, so "today" built from `new Date()` started at 03:00 in
 * Kenya and a sale at 01:30 counted for the day before. Every business uses
 * Kenya time for now; this is the one place to change that.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Nairobi';

const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** "YYYY-MM-DD" of `date` as a calendar day in the business time zone. */
export function businessDateKey(date: Date | string | number = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(toDate(date));
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant the business day containing `date` begins (its local
 * midnight), moved by `addDays` whole days — e.g. addDays 1 is tomorrow's
 * start, the exclusive end of today.
 */
export function startOfBusinessDay(date: Date | string | number = new Date(), addDays = 0, timeZone = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = businessDateKey(date, timeZone).split('-').map(Number);
  const wallMidnight = Date.UTC(y, m - 1, d + addDays);
  // Offset at that midnight; re-read once in case a DST change falls between.
  let t = wallMidnight - zoneOffsetMs(wallMidnight, timeZone);
  t = wallMidnight - zoneOffsetMs(t, timeZone);
  return new Date(t);
}

/** "YYYY-MM-DD" of the Sunday that starts the business week containing `date`. */
export function businessWeekKey(date: Date | string | number, timeZone = BUSINESS_TIME_ZONE): string {
  const [y, m, d] = businessDateKey(date, timeZone).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}
