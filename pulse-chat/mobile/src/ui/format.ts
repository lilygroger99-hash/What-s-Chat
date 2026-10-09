const pad = (n: number) => String(n).padStart(2, '0');

export const clock = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function listTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(iso);
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

export function lastSeenText(iso: string | null): string {
  if (!iso) return 'offline';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `last seen today at ${clock(iso)}`;
  return `last seen ${listTime(iso)} at ${clock(iso)}`;
}

export const initials = (name: string, phone: string): string =>
  (name.trim()[0] ?? phone.replace('+', '')[0] ?? '?').toUpperCase();
