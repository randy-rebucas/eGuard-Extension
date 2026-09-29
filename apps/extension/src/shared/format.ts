/** "just now", "2 min ago", "3 h ago", "Sep 28". */
export function relativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Chrome 153" */
export function browserLabel(b: { name: string; major: number | null }): string {
  return b.major ? `${b.name} ${b.major}` : b.name;
}
