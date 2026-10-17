export interface PlaytimeUnits {
  hour: string;
  minute: string;
  lessThanMinute: string;
  none: string;
}

/** Compact, human playtime: `42 h 15 min`, `45 min`, `<1 min`. */
export function formatPlaytime(seconds: number, units: PlaytimeUnits): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return units.none;
  if (seconds < 60) return units.lessThanMinute;

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} ${units.minute}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} ${units.hour}`;
  }
  // Large values read better rounded to a five-minute bucket.
  const rounded = Math.round(minutes / 5) * 5;
  if (rounded === 60) return `${hours + 1} ${units.hour}`;
  if (rounded === 0) return `${hours} ${units.hour}`;
  return `${hours} ${units.hour} ${rounded} ${units.minute}`;
}

/** Clock style duration for session rows: `1:05:12`, `5:12`. */
export function formatClockDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

export function formatAbsoluteDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Relative "last played" label. `Intl.RelativeTimeFormat` is used instead of
 * hand-written plural keys so EN and PL plural rules stay correct.
 */
export function formatRelativeDate(
  iso: string | null,
  locale: string,
  neverLabel: string,
  reference: number = Date.now(),
): string {
  if (iso === null) return neverLabel;
  const difference = Date.parse(iso) - reference;
  if (Number.isNaN(difference)) return neverLabel;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const absolute = Math.abs(difference);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (absolute < 45 * minute) return formatter.format(Math.round(difference / minute), "minute");
  if (absolute < 22 * hour) return formatter.format(Math.round(difference / hour), "hour");
  if (absolute < 7 * day) return formatter.format(Math.round(difference / day), "day");
  if (absolute < 5 * week) return formatter.format(Math.round(difference / week), "week");
  if (absolute < 11 * month) return formatter.format(Math.round(difference / month), "month");
  return formatter.format(Math.round(difference / year), "year");
}

/** `0.86` → `86%`. */
export function formatConfidence(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)}%`;
}
