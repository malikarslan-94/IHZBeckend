import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { admin } from '../../middleware/requireRole.js';
import { userSelect } from '../../middleware/auth.js';
import { userSchema } from '../../../shared/schema.js';
import { id, query, searchFields, listResult } from '../../lib/query.js';
import { assert } from '../../lib/errors.js';
import { log } from '../../lib/activity.js';
export const userRoutes = Router();
userRoutes.use(admin);
userRoutes.get('/', async (req, res) => {
  const q = query(req, ['name', 'username', 'role', 'createdAt']);
  const where = searchFields(q.search, ['name', 'username']);
  const [data, total] = await db.$transaction([
    db.user.findMany({ where, select: userSelect, skip: q.skip, take: q.take, orderBy: q.orderBy }),
    db.user.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
userRoutes.post('/', async (req, res) => {
  const { password, ...data } = userSchema.parse(req.body);
  assert(
    data.role !== 'NURSE' || data.nurseId,
    422,
    'NURSE_REQUIRED',
    'A nurse account must be linked to a nurse.',
  );
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        ...data,
        nurseId: data.role === 'NURSE' ? data.nurseId : null,
        passwordHash: await bcrypt.hash(password, 12),
      },
      select: userSelect,
    });
    await log(tx, req.user.id, 'CREATE', 'User', u.id, { role: u.role });
    return u;
  });
  res.status(201).json(user);
});
userRoutes.patch('/:id', async (req, res) => {
  const userId = id(req.params.id),
    data = userSchema.omit({ password: true }).partial().parse(req.body);
  assert(
    userId !== req.user.id || (data.isActive !== false && (!data.role || data.role === 'ADMIN')),
    422,
    'SELF_EDIT',
    'You cannot disable or demote your own admin account.',
  );
  const result = await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
    const merged = { ...before, ...data };
    assert(
      merged.role !== 'NURSE' || merged.nurseId,
      422,
      'NURSE_REQUIRED',
      'A nurse account must be linked to a nurse.',
    );
    const after = await tx.user.update({
      where: { id: userId },
      data: {
        ...data,
        nurseId: merged.role === 'NURSE' ? merged.nurseId : null,
        tokenVersion: { increment: 1 },
      },
      select: userSelect,
    });
    await log(tx, req.user.id, 'UPDATE', 'User', userId, { before, after });
    return after;
  });
  res.json(result);
});
userRoutes.post('/:id/reset-password', async (req, res) => {
  const { password } = z.object({ password: z.string().min(12).max(72) }).parse(req.body);
  const userId = id(req.params.id);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(password, 12), tokenVersion: { increment: 1 } },
    });
    await log(tx, req.user.id, 'UPDATE', 'User', userId, { passwordReset: true });
  });
  res.json({ ok: true });
});
