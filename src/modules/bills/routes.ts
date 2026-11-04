import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { office, admin } from '../../middleware/requireRole.js';
import { billSchema, billStatuses, reasonSchema } from '../../../shared/schema.js';
import { query, id, listResult, searchFields } from '../../lib/query.js';
import { dateRange } from '../../lib/dates.js';
import { log } from '../../lib/activity.js';
import { assert } from '../../lib/errors.js';
import { lockBill, canEdit, recalculate, billInclude } from './service.js';
import { billHtml, createPdf } from '../../lib/pdf.js';
export const billRoutes = Router();
billRoutes.use(office);
billRoutes.get('/', async (req, res) => {
  const q = query(req, ['billNo', 'billDate', 'total', 'balance', 'status'], 'billDate');
  const where = {
    ...(q.search
      ? {
          OR: [
            { billNo: { contains: q.search, mode: 'insensitive' as const } },
            { request: { patient: searchFields(q.search, ['fullName', 'phone']) } },
          ],
        }
      : {}),
    ...(req.query.status ? { status: z.enum(billStatuses).parse(req.query.status) } : {}),
    billDate: dateRange(q.from, q.to),
    request: {
      ...(req.query.patientId ? { patientId: id(req.query.patientId) } : {}),
      ...(req.query.nurseId ? { nurseId: id(req.query.nurseId) } : {}),
    },
  };
  const [data, total] = await db.$transaction([
    db.bill.findMany({ where, include: billInclude, skip: q.skip, take: q.take, orderBy: q.orderBy }),
    db.bill.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
billRoutes.get('/:id', async (req, res) =>
  res.json(await db.bill.findUniqueOrThrow({ where: { id: id(req.params.id) }, include: billInclude })),
);
billRoutes.patch('/:id', async (req, res) => {
  const data = billSchema.partial().parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const before = await lockBill(tx, id(req.params.id));
      canEdit(before, req.user);
      assert(
        req.user.role === 'ADMIN' || data.taxPercent === undefined || before.taxPercent.eq(data.taxPercent),
        403,
        'TAX_ROLE',
        'Only an admin can change the tax rate.',
      );
      await tx.bill.update({ where: { id: before.id }, data });
      const after = await recalculate(tx, before.id);
      await log(tx, req.user.id, 'UPDATE', 'Bill', before.id, { before, after });
      return after;
    }),
  );
});
billRoutes.post('/:id/cancel', admin, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const before = await lockBill(tx, id(req.params.id));
      assert(before.status !== 'CANCELLED', 409, 'CANCELLED', 'Bill is already cancelled.');
      const after = await tx.bill.update({
        where: { id: before.id },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      await log(tx, req.user.id, 'CANCEL', 'Bill', before.id, { before, after });
      return after;
    }),
  );
});
billRoutes.get('/:id/:output', async (req, res, next) => {
  const output = String(req.params.output);
  if (!['pdf', 'print', 'preview'].includes(output)) return next();
  const format = z.enum(['a4', 'thermal']).default('a4').parse(req.query.format);
  const bill = await db.bill.findUniqueOrThrow({ where: { id: id(req.params.id) }, include: billInclude });
  const html = await billHtml(bill, format, output === 'print');
  if (output === 'pdf') {
    res
      .type('pdf')
      .attachment(`${bill.billNo}-${format}.pdf`)
      .send(await createPdf(html, format));
  } else {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
    );
    res.type('html').send(html);
  }
});
