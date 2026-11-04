import { z } from 'zod';
import { calendarDateSchema } from '../../shared/schema.js';
import { AppError } from './errors.js';

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
  z.object({ from: calendarDateSchema.optional(), to: calendarDateSchema.optional() }).parse({ from, to });
  if (from && to && from > to)
    throw new AppError(422, 'DATES', 'End date must be on or after start date.', {
      to: 'End date must be on or after start date.',
    });
  const start = from ? new Date(`${from}T00:00:00+05:00`) : undefined;
  const end = to ? new Date(`${to}T23:59:59.999+05:00`) : undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}
