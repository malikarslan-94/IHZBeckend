import { Router } from 'express';
import { db } from '../../config/db.js';
import { office, admin } from '../../middleware/requireRole.js';
import { nurseSchema } from '../../../shared/schema.js';
import { id, query, searchFields, listResult } from '../../lib/query.js';
import { log } from '../../lib/activity.js';
export const nurseRoutes = Router();
nurseRoutes.use(office);
nurseRoutes.get('/', async (req, res) => {
  const q = query(req, ['fullName', 'createdAt']);
  const where = {
    ...searchFields(q.search, ['fullName', 'phone']),
    ...(req.query.active !== undefined ? { isActive: req.query.active === 'true' } : {}),
  };
  const [data, total] = await db.$transaction([
    db.nurse.findMany({
      where,
      include: { _count: { select: { requests: true } } },
      skip: q.skip,
      take: q.take,
      orderBy: q.orderBy,
    }),
    db.nurse.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
nurseRoutes.get('/:id', async (req, res) =>
  res.json(
    await db.nurse.findUniqueOrThrow({
      where: { id: id(req.params.id) },
      include: { requests: { include: { patient: true, bill: true }, orderBy: { requestDate: 'desc' } } },
    }),
  ),
);
nurseRoutes.post('/', admin, async (req, res) => {
  const data = nurseSchema.parse(req.body);
  res.status(201).json(
    await db.$transaction(async (tx) => {
      const nurse = await tx.nurse.create({ data });
      await log(tx, req.user.id, 'CREATE', 'Nurse', nurse.id);
      return nurse;
    }),
  );
});
nurseRoutes.patch('/:id', admin, async (req, res) => {
  const data = nurseSchema.partial().parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const nurse = await tx.nurse.update({ where: { id: id(req.params.id) }, data });
      await log(tx, req.user.id, 'UPDATE', 'Nurse', nurse.id, { fields: Object.keys(data) });
      return nurse;
    }),
  );
});
