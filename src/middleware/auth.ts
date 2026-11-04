import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import { isAllowedOrigin } from '../config/origins.js';
import { AppError } from '../lib/errors.js';
export type SessionUser = {
  id: number;
  name: string;
  username: string;
  role: 'ADMIN' | 'STAFF' | 'NURSE';
  nurseId: number | null;
  tokenVersion: number;
};
declare module 'express-serve-static-core' {
  interface Request {
    user: SessionUser;
  }
}
export const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  nurseId: true,
  isActive: true,
  createdAt: true,
} as const;
export const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
  path: '/api',
  maxAge: 8 * 60 * 60 * 1000,
};
export async function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const payload = jwt.verify(req.cookies.session || '', env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    const user = await db.user.findUnique({
      where: { id: Number(payload.sub) },
      select: { ...userSelect, tokenVersion: true },
    });
    if (!user?.isActive || user.tokenVersion !== payload.version) throw new Error('Inactive session');
    req.user = user;
    next();
  } catch {
    next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  }
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    (req.get('X-Requested-With') !== 'HomeNursing' ||
      (req.get('Origin') && !isAllowedOrigin(req.get('Origin')!)))
  )
    return next(new AppError(403, 'CSRF', 'Invalid request origin.'));
  next();
}
