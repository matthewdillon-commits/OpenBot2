/**
 * Next-run times for a five-field cron, in a named timezone.
 *
 * No extra dependency: the expressions people actually write are minute/hour/dom/month/dow
 * with lists, ranges and steps. The product default is weekday-bounded, which is applied
 * after the cron tick so a daily `0 9 * * *` becomes weekdays without rewriting the string.
 */

const FIELD = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  weekday: { min: 0, max: 7 },
} as const;

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type CronSchedule = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
};

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(
      "A cron expression needs five fields: minute hour day-of-month month day-of-week.",
    );
  }
  const [minute, hour, day, month, weekday] = fields;
  return {
    minute: parseField(minute ?? "", FIELD.minute, {}),
    hour: parseField(hour ?? "", FIELD.hour, {}),
    day: parseField(day ?? "", FIELD.day, {}),
    month: parseField(month ?? "", FIELD.month, MONTH_NAMES),
    weekday: normalizeWeekday(
      parseField(weekday ?? "", FIELD.weekday, WEEKDAY_NAMES),
    ),
  };
}

/**
 * The next instant strictly after `from` that matches, or null if none in two years.
 *
 * Two years is long enough for `0 0 29 2 *` and short enough that a job which can never
 * fire is refused at create time rather than stored as standing work that never stands.
 */
export function nextCronOccurrence(
  expression: string,
  from: Date,
  timeZone: string,
  weekdayBounded = true,
): Date | null {
  if (!isValidTimeZone(timeZone)) {
    throw new CronParseError(`Unknown timezone: ${timeZone}`);
  }
  const schedule = parseCron(expression);
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);
  // Exclusive of `from`: a job that just fired must not match the same minute again.
  let cursor = new Date(start.getTime() + 60_000);

  const horizon = from.getTime() + 2 * 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= horizon) {
    const parts = zonedParts(cursor, timeZone);
    if (matches(schedule, parts, weekdayBounded)) {
      return zonedToUtc(parts, timeZone);
    }
    cursor = advance(cursor, schedule, parts, timeZone, weekdayBounded);
  }
  return null;
}

function parseField(
  raw: string,
  bounds: { min: number; max: number },
  names: Record<string, number>,
): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(`Invalid step in cron field: ${part}`);
    }
    if (rangePart === "*" || rangePart === undefined) {
      addRange(values, bounds.min, bounds.max, step);
      continue;
    }
    const [startRaw, endRaw] = rangePart.split("-");
    const start = namedOrNumber(startRaw ?? "", names, bounds);
    const end =
      endRaw === undefined ? start : namedOrNumber(endRaw, names, bounds);
    if (end < start) {
      throw new CronParseError(`Invalid range in cron field: ${part}`);
    }
    addRange(values, start, end, step);
  }
  if (values.size === 0) {
    throw new CronParseError(`Cron field matches nothing: ${raw}`);
  }
  return values;
}

function namedOrNumber(
  raw: string,
  names: Record<string, number>,
  bounds: { min: number; max: number },
): number {
  const named = names[raw.toLowerCase()];
  if (named !== undefined) return named;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new CronParseError(`Cron value out of range: ${raw}`);
  }
  return value;
}

function addRange(into: Set<number>, start: number, end: number, step: number) {
  for (let value = start; value <= end; value += step) into.add(value);
}

/** Cron treats 0 and 7 as Sunday. Collapse to 0-6 so matching is one comparison. */
function normalizeWeekday(values: Set<number>): Set<number> {
  const next = new Set<number>();
  for (const value of values) next.add(value === 7 ? 0 : value);
  return next;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const weekdayName = (map.weekday ?? "Sun").slice(0, 3).toLowerCase();
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_NAMES[weekdayName] ?? 0,
  };
}

/**
 * Turn a wall-clock in `timeZone` into a UTC instant.
 *
 * Guess UTC, read that instant back in the zone, and subtract the delta. A DST gap
 * (the clock skipped this minute) is skipped by the caller: `matches` never sees it
 * because we walk real instants, not invented wall times.
 */
function zonedToUtc(parts: ZonedParts, timeZone: string): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  const asZoned = zonedParts(new Date(utcGuess), timeZone);
  const zonedAsUtc = Date.UTC(
    asZoned.year,
    asZoned.month - 1,
    asZoned.day,
    asZoned.hour,
    asZoned.minute,
    0,
  );
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

function matches(
  schedule: CronSchedule,
  parts: ZonedParts,
  weekdayBounded: boolean,
): boolean {
  if (weekdayBounded && (parts.weekday === 0 || parts.weekday === 6)) {
    return false;
  }
  if (!schedule.month.has(parts.month)) return false;
  if (!schedule.hour.has(parts.hour)) return false;
  if (!schedule.minute.has(parts.minute)) return false;

  const dayMatches = schedule.day.has(parts.day);
  const weekdayMatches = schedule.weekday.has(parts.weekday);
  const dayIsWild = schedule.day.size === 31;
  const weekdayIsWild = schedule.weekday.size === 7;

  // Standard cron: when both day-of-month and day-of-week are restricted, either may match.
  if (!dayIsWild && !weekdayIsWild) return dayMatches || weekdayMatches;
  return dayMatches && weekdayMatches;
}

/**
 * Jump toward the next candidate instead of walking every minute.
 *
 * Wrong jumps only cost extra iterations; they must never skip a matching minute.
 * When the current minute cannot match, skip to the next matching minute or the
 * next hour. Weekend days, when bounded, jump to Monday.
 */
function advance(
  cursor: Date,
  schedule: CronSchedule,
  parts: ZonedParts,
  timeZone: string,
  weekdayBounded: boolean,
): Date {
  if (parts.weekday === 6 && (weekdayBounded || !schedule.weekday.has(6))) {
    return addZonedDays(cursor, parts, timeZone, 2);
  }
  if (parts.weekday === 0 && (weekdayBounded || !schedule.weekday.has(0))) {
    return addZonedDays(cursor, parts, timeZone, 1);
  }
  if (!schedule.month.has(parts.month)) {
    return addZonedMonths(cursor, parts, timeZone, 1);
  }
  if (!schedule.hour.has(parts.hour)) {
    const nextHour = nextInSet(schedule.hour, parts.hour, 23);
    if (nextHour !== null) {
      return atZoned(parts, timeZone, {
        hour: nextHour,
        minute: minOf(schedule.minute),
      });
    }
    return addZonedDays(cursor, parts, timeZone, 1);
  }
  if (!schedule.minute.has(parts.minute)) {
    const nextMinute = nextInSet(schedule.minute, parts.minute, 59);
    if (nextMinute !== null) {
      return atZoned(parts, timeZone, { minute: nextMinute });
    }
    const nextHour = nextInSet(schedule.hour, parts.hour, 23);
    if (nextHour !== null) {
      return atZoned(parts, timeZone, {
        hour: nextHour,
        minute: minOf(schedule.minute),
      });
    }
    return addZonedDays(cursor, parts, timeZone, 1);
  }
  return new Date(cursor.getTime() + 60_000);
}

function nextInSet(
  values: Set<number>,
  current: number,
  max: number,
): number | null {
  for (let value = current + 1; value <= max; value += 1) {
    if (values.has(value)) return value;
  }
  return null;
}

function minOf(values: Set<number>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const value of values) if (value < min) min = value;
  return min;
}

function atZoned(
  parts: ZonedParts,
  timeZone: string,
  patch: Partial<Pick<ZonedParts, "hour" | "minute">>,
): Date {
  return zonedToUtc({ ...parts, ...patch }, timeZone);
}

function addZonedDays(
  cursor: Date,
  parts: ZonedParts,
  timeZone: string,
  days: number,
): Date {
  const next = zonedToUtc(
    { ...parts, day: parts.day + days, hour: 0, minute: 0 },
    timeZone,
  );
  return next.getTime() > cursor.getTime()
    ? next
    : new Date(cursor.getTime() + 60_000);
}

function addZonedMonths(
  cursor: Date,
  parts: ZonedParts,
  timeZone: string,
  months: number,
): Date {
  const month = parts.month + months;
  const year = parts.year + Math.floor((month - 1) / 12);
  const nextMonth = ((month - 1) % 12) + 1;
  const next = zonedToUtc(
    { ...parts, year, month: nextMonth, day: 1, hour: 0, minute: 0 },
    timeZone,
  );
  return next.getTime() > cursor.getTime()
    ? next
    : new Date(cursor.getTime() + 60_000);
}
