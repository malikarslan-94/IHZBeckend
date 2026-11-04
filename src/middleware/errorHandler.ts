import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError)
    return void res.status(422).json({
      error: {
        code: 'VALIDATION',
        message: 'Please check the highlighted fields.',
        fields: Object.fromEntries(err.issues.map((i) => [i.path.join('.'), i.message])),
      },
    });
  if (err instanceof AppError)
    return void res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, fields: err.fields } });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const messages: Record<string, [number, string]> = {
      P2002: [409, 'A record with these details already exists.'],
      P2025: [404, 'Record not found.'],
      P2003: [422, 'The selected record does not exist.'],
      P2034: [409, 'Another change happened at the same time. Please try again.'],
      P2028: [503, 'The database is busy. Please try again.'],
    };
    const [status, message] = messages[err.code] || [500, 'Database operation failed.'];
    return void res.status(status).json({ error: { code: err.code, message } });
  }
  if (err.code === 'LIMIT_FILE_SIZE')
    return void res
      .status(413)
      .json({ error: { code: 'FILE_SIZE', message: 'Logo must be smaller than 1 MB.' } });
  if (err instanceof SyntaxError || err.status === 413)
    return void res
      .status(err.status || 400)
      .json({ error: { code: 'BAD_REQUEST', message: 'Invalid or oversized request.' } });
  console.error('Request failed:', err instanceof Error ? err.name : 'Unknown error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
