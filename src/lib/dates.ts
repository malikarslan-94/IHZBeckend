export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function dateText(value: Date | string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  })
    .format(new Date(value))
    .replace(/ /g, '-');
}
export function dateRange(from?: string, to?: string) {
  const start = from ? new Date(`${from}T00:00:00+05:00`) : undefined;
  const end = to ? new Date(`${to}T23:59:59.999+05:00`) : undefined;
  if ((start && isNaN(+start)) || (end && isNaN(+end))) throw new Error('Invalid date range');
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}
