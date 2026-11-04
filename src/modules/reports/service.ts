import { db } from '../../config/db.js';
import { Decimal } from 'decimal.js';
import { dateRange, dayKey } from '../../lib/dates.js';
import { assert } from '../../lib/errors.js';
export const sum = (values: unknown[]) =>
  values.reduce<Decimal>((s, n) => s.add(String(n ?? 0)), new Decimal(0)).toFixed(2);
export async function report(name: string, from?: string, to?: string) {
  const range = dateRange(from, to);
  assert(
    !range.gte || !range.lte || range.gte <= range.lte,
    422,
    'DATES',
    'End date must be on or after start date.',
  );
  if (name === 'outstanding')
    return db.bill
      .findMany({
        where: { status: { in: ['UNPAID', 'PARTIAL'] }, balance: { gt: 0 }, billDate: range },
        include: {
          request: {
            include: {
              patient: { select: { fullName: true, phone: true } },
              nurse: { select: { fullName: true } },
            },
          },
        },
        orderBy: { billDate: 'asc' },
      })
      .then((bills) =>
        bills.map((b) => ({
          billNo: b.billNo,
          billId: b.id,
          date: dayKey(b.billDate),
          patient: b.request.patient.fullName,
          phone: b.request.patient.phone,
          total: b.total.toFixed(2),
          paid: b.paidAmount.toFixed(2),
          balance: b.balance.toFixed(2),
        })),
      );
  const [bills, payments, requestCount] = await db.$transaction([
    db.bill.findMany({
      where: { status: { not: 'CANCELLED' }, billDate: range },
      include: { request: { include: { nurse: true, items: { include: { service: true } } } } },
    }),
    db.payment.findMany({ where: { paymentDate: range, bill: { status: { not: 'CANCELLED' } } } }),
    db.serviceRequest.count({ where: { requestDate: range } }),
  ]);
  if (name === 'summary')
    return {
      billed: sum(bills.map((b) => b.total)),
      received: sum(payments.map((p) => p.amount)),
      outstanding: sum(bills.map((b) => Decimal.max(0, b.balance))),
      billCount: bills.length,
      requestCount,
    };
  if (name === 'daily-income') {
    const dates = [
      ...new Set([...bills.map((b) => dayKey(b.billDate)), ...payments.map((p) => dayKey(p.paymentDate))]),
    ].sort();
    return dates.map((date) => ({
      date,
      billed: sum(bills.filter((b) => dayKey(b.billDate) === date).map((b) => b.total)),
      received: sum(payments.filter((p) => dayKey(p.paymentDate) === date).map((p) => p.amount)),
    }));
  }
  if (name === 'by-service') {
    const items = bills.flatMap((b) => b.request.items);
    return [...new Set(items.map((i) => i.serviceId))].map((serviceId) => {
      const group = items.filter((i) => i.serviceId === serviceId);
      return {
        service: group[0].service.name,
        quantity: sum(group.map((i) => i.quantity)),
        amount: sum(group.map((i) => i.amount)),
      };
    });
  }
  if (name === 'by-nurse')
    return [...new Set(bills.map((b) => b.request.nurseId))].map((nurseId) => {
      const group = bills.filter((b) => b.request.nurseId === nurseId);
      return {
        nurse: group[0].request.nurse?.fullName || 'Unassigned',
        requests: group.length,
        visits: sum(
          group.flatMap((b) => b.request.items.filter((i) => i.unit === 'PER_VISIT').map((i) => i.quantity)),
        ),
        amountBilled: sum(group.map((b) => b.total)),
      };
    });
  assert(false, 404, 'NOT_FOUND', 'Report not found.');
}
