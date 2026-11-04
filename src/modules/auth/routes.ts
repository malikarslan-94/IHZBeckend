import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { auth, cookieOptions, userSelect } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { loginSchema } from '../../../shared/schema.js';
import { assert } from '../../lib/errors.js';
import { log } from '../../lib/activity.js';
export const authRoutes = Router();
const dummyHash = bcrypt.hashSync('invalid-account-timing-placeholder', 12);
authRoutes.post(
  '/login',
  rateLimit({
    windowMs: 60000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Try again in one minute.' } },
  }),
  validate(loginSchema),
  async (req, res) => {
    const user = await db.user.findUnique({ where: { username: req.body.username } });
    const valid = await bcrypt.compare(req.body.password, user?.passwordHash || dummyHash);
    assert(valid && user?.isActive, 401, 'LOGIN_FAILED', 'Incorrect username or password.');
    const token = jwt.sign({ version: user.tokenVersion }, env.JWT_SECRET, {
      subject: String(user.id),
      expiresIn: '8h',
      algorithm: 'HS256',
    });
    await log(db, user.id, 'LOGIN', 'User', user.id);
    res
      .cookie('session', token, cookieOptions)
      .json(await db.user.findUnique({ where: { id: user.id }, select: userSelect }));
  },
);
authRoutes.post('/logout', (_req, res) => {
  res.clearCookie('session', { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});
authRoutes.get('/me', auth, async (req, res) =>
  res.json(await db.user.findUnique({ where: { id: req.user.id }, select: userSelect })),
);
authRoutes.post(
  '/change-password',
  auth,
  validate(z.object({ oldPassword: z.string().min(1).max(72), newPassword: z.string().min(12).max(72) })),
  async (req, res) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    assert(
      await bcrypt.compare(req.body.oldPassword, user.passwordHash),
      422,
      'PASSWORD',
      'Current password is incorrect.',
    );
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12), tokenVersion: { increment: 1 } },
      });
      await log(tx, user.id, 'UPDATE', 'User', user.id, { passwordChanged: true });
    });
    res.clearCookie('session', { ...cookieOptions, maxAge: undefined }).json({ ok: true });
  },
);
