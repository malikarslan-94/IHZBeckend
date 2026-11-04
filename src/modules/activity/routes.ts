import { Router } from 'express';
import { db } from '../../config/db.js';
import { admin } from '../../middleware/requireRole.js';
import { query, id, listResult, searchFields } from '../../lib/query.js';
import { dateRange } from '../../lib/dates.js';
export const activityRoutes = Router();
activityRoutes.use(admin);
activityRoutes.get('/', async (req, res) => {
  const q = query(req, ['createdAt', 'action', 'entityType']);
  const where = {
    ...searchFields(q.search, ['action', 'entityType']),
    ...(req.query.entityType ? { entityType: String(req.query.entityType) } : {}),
    ...(req.query.entityId ? { entityId: id(req.query.entityId) } : {}),
    ...(req.query.userId ? { userId: id(req.query.userId) } : {}),
    createdAt: dateRange(q.from, q.to),
  };
  const [data, total] = await db.$transaction([
    db.activityLog.findMany({ where, skip: q.skip, take: q.take, orderBy: q.orderBy }),
    db.activityLog.count({ where }),
  ]);
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(data.map((l) => l.userId))] } },
    select: { id: true, name: true },
  });
  res.json(
    listResult(
      data.map((l) => ({ ...l, user: users.find((u) => u.id === l.userId)?.name || String(l.userId) })),
      total,
      q,
    ),
  );
});
