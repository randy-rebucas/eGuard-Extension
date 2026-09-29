import type { BrowserProtectionPolicy } from "@eguard/schemas";

type Schedule = NonNullable<BrowserProtectionPolicy["schedule"]>;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes since midnight at `now` in `timeZone`; falls back to UTC if the zone is unknown. */
export function minutesInZone(now: Date, timeZone: string): number {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * Whether focus hours are on at `now`, in the family's time zone. Start is inclusive, end exclusive;
 * a window like 21:00–06:00 runs overnight.
 */
export function isScheduleActive(schedule: Schedule | null, now: Date): boolean {
  if (!schedule?.enabled) return false;
  const start = toMinutes(schedule.startTime);
  const end = toMinutes(schedule.endTime);
  if (start === end) return false;
  const t = minutesInZone(now, schedule.timezone);
  return start < end ? t >= start && t < end : t >= start || t < end;
}
