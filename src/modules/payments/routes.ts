import { Router } from 'express';
import { db } from '../../config/db.js';
import { office, admin } from '../../middleware/requireRole.js';
import { paymentSchema, reasonSchema } from '../../../shared/schema.js';
import { id } from '../../lib/query.js';
import { assert } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numberGenerator.js';
import { log } from '../../lib/activity.js';
import { lockBill, recalculate, billInclude } from '../bills/service.js';
import { receiptHtml } from '../../lib/pdf.js';
import { z } from 'zod';
export const paymentRoutes = Router();
paymentRoutes.use(office);
paymentRoutes.get('/bills/:id/payments', async (req, res) =>
  res.json(
    await db.payment.findMany({ where: { billId: id(req.params.id) }, orderBy: { paymentDate: 'desc' } }),
  ),
);
paymentRoutes.post('/bills/:id/payments', async (req, res) => {
  const { allowOverpayment, ...data } = paymentSchema.parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const bill = await lockBill(tx, id(req.params.id));
    assert(bill.status !== 'CANCELLED', 409, 'CANCELLED', 'Cancelled bills cannot receive payments.');
    assert(
      bill.balance.gte(data.amount) || (req.user.role === 'ADMIN' && allowOverpayment),
      422,
      'OVERPAYMENT',
      'Payment exceeds the remaining balance. An admin must explicitly allow overpayment.',
    );
    const payment = await tx.payment.create({
      data: {
        ...data,
        billId: bill.id,
        receiptNo: await nextNumber(tx, 'PAY', 'PAY-'),
        receivedById: req.user.id,
      },
    });
    const after = await recalculate(tx, bill.id);
    await log(tx, req.user.id, 'PAYMENT', 'Bill', bill.id, {
      payment,
      before: { paidAmount: bill.paidAmount, balance: bill.balance },
      after: { paidAmount: after.paidAmount, balance: after.balance },
      allowOverpayment,
    });
    return { payment, bill: after };
  });
  res.status(201).json(result);
});
paymentRoutes.delete('/payments/:id', admin, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const found = await tx.payment.findUniqueOrThrow({ where: { id: id(req.params.id) } });
      await lockBill(tx, found.billId);
      const payment = await tx.payment.delete({ where: { id: found.id } });
      const bill = await recalculate(tx, payment.billId);
      await log(tx, req.user.id, 'PAYMENT_DELETE', 'Bill', payment.billId, { payment, reason });
      return bill;
    }),
  );
});
paymentRoutes.get('/payments/:id/receipt', async (req, res) => {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: id(req.params.id) },
    include: { bill: { include: billInclude } },
  });
  const format = z.enum(['a4', 'thermal']).default('a4').parse(req.query.format);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
  );
  res.type('html').send(await receiptHtml(payment, format));
});
