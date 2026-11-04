import type { Request } from 'express';
import { z } from 'zod';
export function query(req: Request, allowedSort: string[], fallback = 'createdAt') {
  const q = z
    .object({
      search: z.string().max(150).default(''),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      sortBy: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).default('desc'),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .parse(req.query);
  return {
    ...q,
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
    orderBy: { [q.sortBy && allowedSort.includes(q.sortBy) ? q.sortBy : fallback]: q.sortDir },
  };
}
export const id = (value: unknown) => z.coerce.number().int().positive().parse(value);
export const searchFields = (term: string, fields: string[]) =>
  term ? { OR: fields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) } : {};
export function listResult(data: unknown[], total: number, q: { page: number; pageSize: number }) {
  return { data, total, page: q.page, pageSize: q.pageSize };
}
