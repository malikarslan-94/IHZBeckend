import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { calculateBill } from '../../lib/billCalculator.js';
import { nextNumber, karachiYear } from '../../lib/numberGenerator.js';
import { assert } from '../../lib/errors.js';
import { log } from '../../lib/activity.js';
import type { SessionUser } from '../../middleware/auth.js';
import { billSchema } from '../../../shared/schema.js';
export const requestInclude = {
  patient: true,
  nurse: true,
  items: { orderBy: { sortOrder: 'asc' as const } },
  bill: { include: { payments: { orderBy: { paymentDate: 'asc' as const } } } },
};
export const billInclude = {
  request: { include: { patient: true, nurse: true, items: { orderBy: { sortOrder: 'asc' as const } } } },
  payments: { orderBy: { paymentDate: 'asc' as const } },
};
// Always lock the request first: line edits, payments and bill changes share this lock.
export async function lockRequest(tx: Prisma.TransactionClient, requestId: number) {
  await tx.$queryRaw`SELECT id FROM "ServiceRequest" WHERE id=${requestId} FOR UPDATE`;
  return tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude });
}
export async function lockBill(tx: Prisma.TransactionClient, billId: number) {
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, select: { requestId: true } });
  await lockRequest(tx, bill.requestId);
  return tx.bill.findUniqueOrThrow({ where: { id: billId }, include: billInclude });
}
export function canEdit(bill: { paidAmount: Prisma.Decimal; status: string } | null, user: SessionUser) {
  if (!bill) return;
  assert(bill.status !== 'CANCELLED', 409, 'CANCELLED', 'Cancelled bills cannot be edited.');
  assert(
    user.role === 'ADMIN' || bill.paidAmount.eq(0),
    403,
    'PAID_LOCK',
    'Only an admin can edit charges or lines after a payment.',
  );
}
export async function recalculate(tx: Prisma.TransactionClient, billId: number) {
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: billInclude });
  return tx.bill.update({
    where: { id: billId },
    data: calculateBill(bill.request.items, bill, bill.payments, bill.status === 'CANCELLED'),
    include: billInclude,
  });
}
export async function billCharges(tx: Prisma.TransactionClient, input: unknown, user: SessionUser) {
  const data = billSchema.parse(input ?? {});
  const setting = await tx.setting.findUnique({ where: { key: 'tax_percent' } });
  const tax = Number(setting?.value || 0);
  assert(
    user.role === 'ADMIN' || data.taxPercent === undefined || data.taxPercent === tax,
    403,
    'TAX_ROLE',
    'Only an admin can change the tax rate.',
  );
  return { ...data, taxPercent: data.taxPercent ?? tax };
}
export async function generateBill(
  tx: Prisma.TransactionClient,
  requestId: number,
  input: unknown,
  user: SessionUser,
) {
  const request = await lockRequest(tx, requestId);
  assert(!request.bill, 409, 'BILL_EXISTS', 'This request already has a bill.');
  assert(request.status !== 'CANCELLED', 409, 'CANCELLED', 'A cancelled request cannot be billed.');
  assert(request.items.length, 422, 'EMPTY_BILL', 'Add at least one service before generating a bill.');
  const charges = await billCharges(tx, input, user);
  const year = karachiYear();
  const prefix = (await tx.setting.findUnique({ where: { key: 'bill_prefix' } }))?.value || 'HN';
  const bill = await tx.bill.create({
    data: {
      requestId,
      billNo: await nextNumber(tx, `BILL-${year}`, `${prefix}-${year}-`),
      ...charges,
      ...calculateBill(request.items, charges),
      createdById: user.id,
    },
    include: billInclude,
  });
  await log(tx, user.id, 'CREATE', 'Bill', bill.id, { after: bill });
  return bill;
}
export async function snapshotItems(tx: Prisma.TransactionClient, items: any[], existing: any[] = []) {
  return Promise.all(
    items.map(async (item, sortOrder) => {
      const previous = item.id ? existing.find((i) => i.id === item.id) : undefined;
      assert(!item.id || previous, 422, 'INVALID_ITEM', 'A line does not belong to this request.');
      const service = await tx.service.findUniqueOrThrow({ where: { id: item.serviceId } });
      assert(
        service.isActive || previous?.serviceId === service.id,
        422,
        'INACTIVE_SERVICE',
        'This service is inactive.',
      );
      const same = previous?.serviceId === service.id;
      const rate = item.rate ?? (same ? previous.rate : service.defaultRate);
      return {
        serviceId: service.id,
        description: item.description ?? (same ? previous.description : service.name),
        unit: same ? previous.unit : service.unit,
        serviceDate: item.serviceDate ?? null,
        quantity: item.quantity,
        rate,
        amount: new Decimal(item.quantity).mul(rate).toDecimalPlaces(2).toFixed(2),
        sortOrder,
      };
    }),
  );
}
