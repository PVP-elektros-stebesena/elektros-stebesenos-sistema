export const BILLING_TIMEZONE = 'Europe/Vilnius';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BILLING_TIMEZONE,
  timeZoneName: 'shortOffset',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
}

function parseOffsetMinutes(value: string): number {
  if (value === 'GMT' || value === 'UTC') return 0;

  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2] ?? '0', 10);
  const minutes = parseInt(match[3] ?? '0', 10);
  return sign * ((hours * 60) + minutes);
}

export function getBillingDateParts(date: Date): ZonedParts {
  const mapped = partsToMap(DATE_TIME_PARTS_FORMATTER.formatToParts(date));
  return {
    year: parseInt(mapped.year ?? '0', 10),
    month: parseInt(mapped.month ?? '0', 10),
    day: parseInt(mapped.day ?? '0', 10),
    hour: parseInt(mapped.hour ?? '0', 10),
    minute: parseInt(mapped.minute ?? '0', 10),
    second: parseInt(mapped.second ?? '0', 10),
  };
}

export function formatBillingDate(date: Date): string {
  return DATE_PARTS_FORMATTER.format(date);
}

function getOffsetMinutesAt(date: Date): number {
  const parts = OFFSET_FORMATTER.formatToParts(date);
  const zonePart = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return parseOffsetMinutes(zonePart);
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let i = 0; i < 4; i += 1) {
    const offsetMinutes = getOffsetMinutesAt(guess);
    const corrected = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second) - (offsetMinutes * 60_000),
    );

    if (corrected.getTime() === guess.getTime()) {
      break;
    }

    guess = corrected;
  }

  return guess;
}

export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((value) => parseInt(value, 10));
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function getBillingDayRange(date: string): { startsAt: Date; endsAt: Date } {
  const [year, month, day] = date.split('-').map((value) => parseInt(value, 10));
  const [nextYear, nextMonth, nextDay] = addDaysToDateString(date, 1)
    .split('-')
    .map((value) => parseInt(value, 10));

  return {
    startsAt: zonedDateTimeToUtc(year, month, day, 0, 0, 0),
    endsAt: zonedDateTimeToUtc(nextYear, nextMonth, nextDay, 0, 0, 0),
  };
}

export function getTomorrowBillingDate(reference = new Date()): string {
  return addDaysToDateString(formatBillingDate(reference), 1);
}

export function getExpectedQuarterHourIntervals(date: string): number {
  const range = getBillingDayRange(date);
  return Math.round((range.endsAt.getTime() - range.startsAt.getTime()) / (15 * 60_000));
}
