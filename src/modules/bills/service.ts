import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { calculateBill } from '../../lib/billCalculator.js';
import { nextNumber, karachiYear } from '../../lib/numberGenerator.js';
import { assert } from '../../lib/errors.js';
import { log } from '../../lib/activity.js';
import type { SessionUser } from '../../middleware/auth.js';
import { billSchema, chargeLinesSchema } from '../../../shared/schema.js';
export const requestInclude = {
  patient: true,
  nurse: true,
  draftCharges: true,
  items: { orderBy: { sortOrder: 'asc' as const } },
  chargeLines: { orderBy: { sortOrder: 'asc' as const } },
  bill: { include: { payments: { orderBy: { paymentDate: 'asc' as const } } } },
};
export const billInclude = {
  request: {
    include: {
      patient: true,
      nurse: true,
      items: { orderBy: { sortOrder: 'asc' as const } },
      chargeLines: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
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
    data: calculateBill(
      bill.request.items,
      { discount: bill.discount, taxPercent: bill.taxPercent, extraCharges: chargeTotal(bill.request.chargeLines) },
      bill.payments,
      bill.status === 'CANCELLED',
    ),
    include: billInclude,
  });
}
// A bill's extra charges are always the sum of the request's additional-charge lines.
export const chargeTotal = (lines: { amount: Decimal.Value }[]) =>
  lines.reduce((sum, line) => sum.add(line.amount), new Decimal(0)).toFixed(2);
export async function billCharges(
  tx: Prisma.TransactionClient,
  input: unknown,
  user: SessionUser,
  draft?: unknown,
) {
  const supplied = billSchema.partial().parse(input ?? {});
  const saved = billSchema.parse(draft ?? {});
  const data = billSchema.parse({
    ...saved,
    ...Object.fromEntries(Object.entries(supplied).filter(([, value]) => value !== undefined)),
  });
  const setting = await tx.setting.findUnique({ where: { key: 'tax_percent' } });
  const tax = Number(setting?.value || 0);
  assert(
    user.role === 'ADMIN' || supplied.taxPercent === undefined || supplied.taxPercent === tax,
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
  const { chargeLines } = z.object({ chargeLines: chargeLinesSchema.optional() }).parse(input ?? {});
  const lines = chargeLines
    ? await replaceChargeLines(tx, request.id, chargeLines, request.chargeLines, user.id)
    : request.chargeLines;
  const charges = await billCharges(tx, input, user, request.draftCharges);
  const year = karachiYear();
  const prefix = (await tx.setting.findUnique({ where: { key: 'bill_prefix' } }))?.value || 'HN';
  const bill = await tx.bill.create({
    data: {
      requestId,
      billNo: await nextNumber(tx, `BILL-${year}`, `${prefix}-${year}-`),
      ...charges,
      ...calculateBill(request.items, { ...charges, extraCharges: chargeTotal(lines) }),
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
      const amount = new Decimal(item.quantity).mul(rate).toDecimalPlaces(2);
      assert(amount.lte('9999999999.99'), 422, 'AMOUNT_TOO_LARGE', 'Line amount exceeds the supported limit.', {
        [`items.${sortOrder}.rate`]: 'Line amount exceeds the supported limit.',
      });
      return {
        serviceId: service.id,
        description: item.description ?? (same ? previous.description : service.name),
        unit: same ? previous.unit : service.unit,
        serviceDate: item.serviceDate ?? null,
        quantity: item.quantity,
        rate,
        amount: amount.toFixed(2),
        sortOrder,
      };
    }),
  );
}
// Turns submitted additional-charge lines into rows to store. A line keeps its saved rate and
// description unless new ones are sent; a new list item takes the item's name and current rate.
export async function snapshotChargeLines(
  tx: Prisma.TransactionClient,
  lines: any[],
  existing: any[],
  userId: number,
) {
  return Promise.all(
    lines.map(async (line, sortOrder) => {
      const previous = line.id ? existing.find((l) => l.id === line.id) : undefined;
      assert(!line.id || previous, 422, 'INVALID_CHARGE', 'A charge line does not belong to this request.');
      const item = line.chargeItemId
        ? await tx.chargeItem.findUniqueOrThrow({ where: { id: line.chargeItemId } })
        : null;
      assert(
        !item || item.isActive || previous?.chargeItemId === item.id,
        422,
        'INACTIVE_CHARGE_ITEM',
        'This item is inactive.',
      );
      const same = !!previous && previous.chargeItemId === (item?.id ?? null);
      const rate = line.rate ?? (same ? previous.rate : item?.defaultRate);
      const description = line.description?.trim() || (same ? previous.description : item?.name);
      assert(
        rate != null && description,
        422,
        'INVALID_CHARGE',
        'Custom charges need a description and rate.',
        description
          ? { [`chargeLines.${sortOrder}.rate`]: 'Enter a rate for this charge.' }
          : { [`chargeLines.${sortOrder}.description`]: 'Describe this charge.' },
      );
      const amount = new Decimal(line.quantity).mul(rate).toDecimalPlaces(2);
      assert(amount.lte('9999999999.99'), 422, 'AMOUNT_TOO_LARGE', 'Line amount exceeds the supported limit.', {
        [`chargeLines.${sortOrder}.rate`]: 'Line amount exceeds the supported limit.',
      });
      return {
        chargeItemId: item?.id ?? null,
        description,
        quantity: line.quantity,
        rate,
        amount: amount.toFixed(2),
        sortOrder,
        createdById: previous ? previous.createdById : userId,
      };
    }),
  );
}
export async function replaceChargeLines(
  tx: Prisma.TransactionClient,
  requestId: number,
  lines: any[],
  existing: any[],
  userId: number,
) {
  const rows = await snapshotChargeLines(tx, lines, existing, userId);
  await tx.requestCharge.deleteMany({ where: { requestId } });
  await tx.requestCharge.createMany({ data: rows.map((row) => ({ ...row, requestId })) });
  return rows;
}
