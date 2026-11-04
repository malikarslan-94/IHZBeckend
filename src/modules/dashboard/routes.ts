import { Router } from 'express';
import { db } from '../../config/db.js';
import { office } from '../../middleware/requireRole.js';
import { dayKey, dateRange } from '../../lib/dates.js';
import { billInclude } from '../bills/service.js';
export const dashboardRoutes = Router();
dashboardRoutes.use(office);
dashboardRoutes.get('/', async (_req, res) => {
  const range = dateRange(dayKey(), dayKey());
  const [newRequests, activeRequests, received, outstanding, latestBills, oldestBills] =
    await db.$transaction([
      db.serviceRequest.count({ where: { requestDate: range } }),
      db.serviceRequest.count({ where: { status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: { paymentDate: range, bill: { status: { not: 'CANCELLED' } } },
      }),
      db.bill.aggregate({
        _sum: { balance: true },
        where: { status: { in: ['UNPAID', 'PARTIAL'] }, balance: { gt: 0 } },
      }),
      db.bill.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: billInclude }),
      db.bill.findMany({
        take: 5,
        where: { status: { in: ['UNPAID', 'PARTIAL'] }, balance: { gt: 0 } },
        orderBy: { billDate: 'asc' },
        include: billInclude,
      }),
    ]);
  res.json({
    newRequests,
    activeRequests,
    received: received._sum.amount || 0,
    outstanding: outstanding._sum.balance || 0,
    latestBills,
    oldestBills,
  });
});
