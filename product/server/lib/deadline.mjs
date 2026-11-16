/**
 * Deadline math for application document windows.
 *
 * Deadlines are communicated to applicants as calendar dates in their agency's
 * timezone, not as UTC instants.
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

export function partsInZone(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetSecondsAt(epochSeconds, timeZone) {
  const local = partsInZone(new Date(epochSeconds * 1000), timeZone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.floor(localAsUtc / 1000) - epochSeconds;
}

export function zonedWallTimeToUtc(year, month, day, hour, minute, second, ms, timeZone) {
  const wallClockGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = offsetSecondsAt(Math.floor(wallClockGuess / 1000), timeZone);
  let utc = wallClockGuess - offset * 1000;
  const correctedOffset = offsetSecondsAt(Math.floor(utc / 1000), timeZone);
  if (correctedOffset !== offset) utc = wallClockGuess - correctedOffset * 1000;
  return new Date(utc + ms);
}

/**
 * Returns the end-of-day deadline N days after the submission date.
 */
export function computeDeadline(submittedAt, days, timeZone) {
  const year = submittedAt.getUTCFullYear();
  const month = submittedAt.getUTCMonth() + 1;
  const day = submittedAt.getUTCDate();

  const target = new Date(Date.UTC(year, month - 1, day + days));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const targetDay = target.getUTCDate();

  const endOfDay = new Date(
    Date.UTC(targetYear, targetMonth - 1, targetDay, 23, 59, 59, 999),
  );

  return {
    deadline: endOfDay.toISOString(),
    deadlineDate: `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}`,
  };
}

export function formatLocalDate(instant, timeZone) {
  const parts = partsInZone(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export const TENANT_TIMEZONES = Object.freeze({
  'agency-a': 'America/Los_Angeles',
  'agency-b': 'America/New_York',
});
