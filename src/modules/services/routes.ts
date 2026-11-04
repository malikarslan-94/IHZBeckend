import { Router } from 'express';
import { db } from '../../config/db.js';
import { office, admin } from '../../middleware/requireRole.js';
import { serviceSchema } from '../../../shared/schema.js';
import { id, query, searchFields, listResult } from '../../lib/query.js';
import { log } from '../../lib/activity.js';
export const serviceRoutes = Router();
serviceRoutes.use(office);
serviceRoutes.get('/', async (req, res) => {
  const q = query(req, ['name', 'category', 'defaultRate', 'createdAt']);
  const where = {
    ...searchFields(q.search, ['name', 'category']),
    ...(req.query.active !== undefined ? { isActive: req.query.active === 'true' } : {}),
    ...(req.query.category ? { category: String(req.query.category) } : {}),
  };
  const [data, total] = await db.$transaction([
    db.service.findMany({ where, skip: q.skip, take: q.take, orderBy: q.orderBy }),
    db.service.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
serviceRoutes.post('/', admin, async (req, res) => {
  const data = serviceSchema.parse(req.body);
  res.status(201).json(
    await db.$transaction(async (tx) => {
      const service = await tx.service.create({ data });
      await log(tx, req.user.id, 'CREATE', 'Service', service.id, service);
      return service;
    }),
  );
});
serviceRoutes.patch('/:id', admin, async (req, res) => {
  const data = serviceSchema.partial().parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const before = await tx.service.findUniqueOrThrow({ where: { id: id(req.params.id) } });
      const after = await tx.service.update({ where: { id: before.id }, data });
      await log(tx, req.user.id, 'UPDATE', 'Service', before.id, { before, after });
      return after;
    }),
  );
});
