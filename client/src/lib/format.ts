/** Formatting helpers used across the UI. */

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Total duration of a track list, e.g. "1 hr 12 min" / "43 min" / "3 min". */
export function formatTotalDuration(tracks: Array<{ duration: number }>): string {
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  return formatDurationSeconds(total);
}

export function formatDurationSeconds(total: number): string {
  if (!total) return '0 min';
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  const yest = new Date(now - 86_400_000);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const withinWeek = now - ts < 7 * 86_400_000;
  if (withinWeek) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function greetingForHour(hour = new Date().getHours()): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Deterministic FNV-1a hash (used by recommendation ordering + mix art). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
