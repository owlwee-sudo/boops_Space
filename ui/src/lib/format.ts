/** Mission elapsed time as DDD:HH:MM:SS. */
export function formatMet(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(days).padStart(3, "0")}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** 402 → "6h 42m". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** 0 → "now", 7 → "7 min ago", 95 → "1 h ago". */
export function formatAgo(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

export function formatSigned(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return (0).toFixed(decimals);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(decimals)}`;
}
