import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { SessionUser } from './auth.js';
export const requireRole =
  (...roles: SessionUser['role'][]): RequestHandler =>
  (req, _res, next) =>
    roles.includes(req.user.role)
      ? next()
      : next(new AppError(403, 'FORBIDDEN', 'Your role cannot perform this action.'));
export const office = requireRole('ADMIN', 'STAFF');
export const admin = requireRole('ADMIN');
