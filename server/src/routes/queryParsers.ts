export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; statusCode: 400; body: { error: string; message: string } };

function parseFinitePositiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function parseOptionalDeviceId(raw: string | undefined): ParseResult<number | undefined> {
  if (raw == null || raw.trim() === '') {
    return { ok: true, value: undefined };
  }

  const value = parseFinitePositiveInteger(raw.trim());
  if (value == null) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'INVALID_DEVICE_ID',
        message: 'deviceId must be a positive integer',
      },
    };
  }

  return { ok: true, value };
}

export function parseRequiredDeviceId(raw: string | undefined): ParseResult<number> {
  if (raw == null || raw.trim() === '') {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'MISSING_DEVICE_ID',
        message: 'deviceId query parameter is required',
      },
    };
  }

  const parsed = parseOptionalDeviceId(raw);
  if (!parsed.ok || parsed.value == null) {
    return parsed as ParseResult<number>;
  }

  return { ok: true, value: parsed.value };
}

function parseDateInternal(raw: string, fieldName: string): ParseResult<Date> {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'INVALID_DATE',
        message: `${fieldName} must be a valid ISO date string`,
      },
    };
  }

  return { ok: true, value: date };
}

export function parseOptionalDate(
  raw: string | undefined,
  fieldName: string,
): ParseResult<Date | undefined> {
  if (raw == null || raw.trim() === '') {
    return { ok: true, value: undefined };
  }

  const parsed = parseDateInternal(raw.trim(), fieldName);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

export function parseDateOrDefault(
  raw: string | undefined,
  fallback: Date,
  fieldName: string,
): ParseResult<Date> {
  if (raw == null || raw.trim() === '') {
    return { ok: true, value: fallback };
  }

  return parseDateInternal(raw.trim(), fieldName);
}

export function validateAscendingRange(
  from: Date,
  to: Date,
  fromFieldName: string = 'from',
  toFieldName: string = 'to',
): ParseResult<true> {
  if (from >= to) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'INVALID_RANGE',
        message: `"${fromFieldName}" must be before "${toFieldName}"`,
      },
    };
  }

  return { ok: true, value: true };
}
