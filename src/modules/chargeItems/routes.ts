import { Router } from 'express';
import { db } from '../../config/db.js';
import { admin } from '../../middleware/requireRole.js';
import { chargeItemSchema } from '../../../shared/schema.js';
import { id, query, searchFields, listResult } from '../../lib/query.js';
import { log } from '../../lib/activity.js';
// The list of billable items (cannula, drip set…) used for additional charges.
export const chargeItemRoutes = Router();
// Nurses pick from active items when logging what they used, so they get names only, never rates.
chargeItemRoutes.get('/', async (req, res) => {
  const nurse = req.user.role === 'NURSE';
  const q = query(req, ['name', 'defaultRate', 'createdAt'], 'name');
  const where = {
    ...searchFields(q.search, ['name']),
    ...(nurse
      ? { isActive: true }
      : req.query.active !== undefined
        ? { isActive: req.query.active === 'true' }
        : {}),
  };
  const page = { where, skip: q.skip, take: q.take, orderBy: q.orderBy };
  const [data, total] = await db.$transaction([
    nurse
      ? db.chargeItem.findMany({ ...page, select: { id: true, name: true } })
      : db.chargeItem.findMany(page),
    db.chargeItem.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
chargeItemRoutes.post('/', admin, async (req, res) => {
  const data = chargeItemSchema.parse(req.body);
  res.status(201).json(
    await db.$transaction(async (tx) => {
      const item = await tx.chargeItem.create({ data });
      await log(tx, req.user.id, 'CREATE', 'ChargeItem', item.id, item);
      return item;
    }),
  );
});
chargeItemRoutes.patch('/:id', admin, async (req, res) => {
  const data = chargeItemSchema.partial().parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const before = await tx.chargeItem.findUniqueOrThrow({ where: { id: id(req.params.id) } });
      const after = await tx.chargeItem.update({ where: { id: before.id }, data });
      await log(tx, req.user.id, 'UPDATE', 'ChargeItem', before.id, { before, after });
      return after;
    }),
  );
});
