import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { office } from '../../middleware/requireRole.js';
import { requestSchema, requestFields, itemSchema, requestStatuses } from '../../../shared/schema.js';
import { query, id, listResult, searchFields } from '../../lib/query.js';
import { dateRange } from '../../lib/dates.js';
import { nextNumber } from '../../lib/numberGenerator.js';
import { log } from '../../lib/activity.js';
import { assert } from '../../lib/errors.js';
import {
  lockRequest,
  canEdit,
  recalculate,
  generateBill,
  snapshotItems,
  requestInclude,
  billCharges,
} from '../bills/service.js';
import { calculateBill } from '../../lib/billCalculator.js';
export const requestRoutes = Router();
const nurseInclude = {
  patient: {
    select: {
      id: true,
      patientCode: true,
      fullName: true,
      phone: true,
      address: true,
      area: true,
      city: true,
    },
  },
  nurse: { select: { id: true, fullName: true } },
  items: { select: { description: true, quantity: true, unit: true, serviceDate: true } },
};
function scope(req: any) {
  return req.user.role === 'NURSE' ? { nurseId: req.user.nurseId ?? -1 } : {};
}
requestRoutes.get('/', async (req, res) => {
  const q = query(req, ['requestNo', 'requestDate', 'status', 'createdAt'], 'requestDate');
  const where = {
    ...scope(req),
    ...(q.search
      ? {
          OR: [
            { requestNo: { contains: q.search, mode: 'insensitive' as const } },
            { patient: { ...searchFields(q.search, ['fullName', 'phone']) } },
          ],
        }
      : {}),
    ...(req.query.status ? { status: z.enum(requestStatuses).parse(req.query.status) } : {}),
    ...(req.query.patientId ? { patientId: id(req.query.patientId) } : {}),
    ...(req.query.nurseId && req.user.role !== 'NURSE' ? { nurseId: id(req.query.nurseId) } : {}),
    requestDate: dateRange(q.from, q.to),
  };
  const [data, total] = await db.$transaction([
    db.serviceRequest.findMany({
      where,
      include: req.user.role === 'NURSE' ? nurseInclude : requestInclude,
      skip: q.skip,
      take: q.take,
      orderBy: q.orderBy,
    }),
    db.serviceRequest.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
requestRoutes.get('/:id', async (req, res) =>
  res.json(
    await db.serviceRequest.findFirstOrThrow({
      where: { id: id(req.params.id), ...scope(req) },
      include: req.user.role === 'NURSE' ? nurseInclude : requestInclude,
    }),
  ),
);
requestRoutes.post('/', office, async (req, res) => {
  const input = requestSchema.parse(req.body);
  const result = await db.$transaction(
    async (tx) => {
      const patient = input.patientId
        ? await tx.patient.findUniqueOrThrow({ where: { id: input.patientId } })
        : await tx.patient.create({
            data: { ...input.patient!, patientCode: await nextNumber(tx, 'PATIENT', 'P-') },
          });
      if (input.nurseId)
        assert(
          (await tx.nurse.findUniqueOrThrow({ where: { id: input.nurseId } })).isActive,
          422,
          'INACTIVE_NURSE',
          'Choose an active nurse.',
        );
      const items = await snapshotItems(tx, input.items);
      const charges = await billCharges(tx, input.charges, req.user);
      calculateBill(items, charges);
      const request = await tx.serviceRequest.create({
        data: {
          requestNo: await nextNumber(tx, 'REQ', 'IHZ-'),
          patientId: patient.id,
          nurseId: input.nurseId,
          requestDate: input.requestDate,
          startDate: input.startDate,
          endDate: input.endDate,
          visitType: input.visitType,
          serviceAddress: input.serviceAddress || patient.address,
          notes: input.notes,
          status: input.nurseId ? 'ASSIGNED' : 'NEW',
          createdById: req.user.id,
          items: { create: items },
          draftCharges: { create: charges },
        },
      });
      await log(tx, req.user.id, 'CREATE', 'ServiceRequest', request.id, {
        requestNo: request.requestNo,
        items,
      });
      if (input.generateBill) await generateBill(tx, request.id, undefined, req.user);
      return tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude });
    },
    { timeout: 15000 },
  );
  res.status(201).json(result);
});
requestRoutes.patch('/:id', office, async (req, res) => {
  const data = requestFields
    .pick({
      nurseId: true,
      requestDate: true,
      startDate: true,
      endDate: true,
      visitType: true,
      serviceAddress: true,
      notes: true,
      status: true,
    })
    .partial()
    .parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const before = await lockRequest(tx, id(req.params.id));
    assert(before.status !== 'CANCELLED', 409, 'CANCELLED', 'Cancelled requests cannot be edited.');
    const merged = { ...before, ...data };
    assert(
      !merged.startDate || !merged.endDate || merged.endDate >= merged.startDate,
      422,
      'DATES',
      'End date must be on or after start date.',
    );
    if (data.status === 'CANCELLED')
      assert(
        !before.bill || before.bill.status === 'CANCELLED',
        409,
        'CANCEL_BILL_FIRST',
        'Cancel the bill before cancelling this request.',
      );
    if (data.nurseId)
      assert(
        (await tx.nurse.findUniqueOrThrow({ where: { id: data.nurseId } })).isActive,
        422,
        'INACTIVE_NURSE',
        'Choose an active nurse.',
      );
    if (data.nurseId && before.status === 'NEW' && !data.status) data.status = 'ASSIGNED';
    if (data.nurseId === null && before.status === 'ASSIGNED' && !data.status) data.status = 'NEW';
    assert(
      (data.status ?? before.status) !== 'ASSIGNED' || merged.nurseId,
      422,
      'NURSE_REQUIRED',
      'Assign a nurse before marking the request assigned.',
      { nurseId: 'Assign a nurse before marking the request assigned.' },
    );
    const after = await tx.serviceRequest.update({ where: { id: before.id }, data, include: requestInclude });
    await log(tx, req.user.id, 'UPDATE', 'ServiceRequest', before.id, { changes: data });
    return after;
  });
  res.json(result);
});
async function changeItems(req: any, mode: 'replace' | 'add' | 'edit' | 'delete') {
  return db.$transaction(async (tx) => {
    const request = await lockRequest(tx, id(req.params.id));
    canEdit(request.bill, req.user);
    assert(request.status !== 'CANCELLED', 409, 'CANCELLED', 'Cancelled requests cannot be edited.');
    let inputs: any[];
    if (mode === 'replace') inputs = z.array(itemSchema).max(100).parse(req.body);
    else {
      inputs = request.items.map((i) => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate) }));
      if (mode === 'add') inputs.push(itemSchema.parse(req.body));
      else {
        const itemId = id(req.params.itemId);
        assert(
          inputs.some((i) => i.id === itemId),
          404,
          'NOT_FOUND',
          'Line not found.',
        );
        inputs =
          mode === 'delete'
            ? inputs.filter((i) => i.id !== itemId)
            : inputs.map((i) => (i.id === itemId ? itemSchema.parse({ ...i, ...req.body, id: itemId }) : i));
      }
    }
    assert(inputs.length <= 100, 422, 'ITEM_LIMIT', 'Use at most 100 lines per request.');
    assert(
      !request.bill || inputs.length,
      422,
      'EMPTY_BILL',
      'A billed request must have at least one line.',
    );
    const items = await snapshotItems(tx, inputs, request.items);
    if (!request.bill) {
      const charges = await billCharges(tx, undefined, req.user, request.draftCharges);
      calculateBill(items, charges);
    }
    await tx.requestItem.deleteMany({ where: { requestId: request.id } });
    await tx.requestItem.createMany({ data: items.map((i) => ({ ...i, requestId: request.id })) });
    if (request.bill) await recalculate(tx, request.bill.id);
    await log(tx, req.user.id, 'UPDATE', 'ServiceRequest', request.id, {
      before: request.items,
      after: items,
    });
    return tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude });
  });
}
requestRoutes.put('/:id/items', office, async (req, res) => res.json(await changeItems(req, 'replace')));
requestRoutes.post('/:id/items', office, async (req, res) =>
  res.status(201).json(await changeItems(req, 'add')),
);
requestRoutes.patch('/:id/items/:itemId', office, async (req, res) =>
  res.json(await changeItems(req, 'edit')),
);
requestRoutes.delete('/:id/items/:itemId', office, async (req, res) =>
  res.json(await changeItems(req, 'delete')),
);
requestRoutes.post('/:id/bill', office, async (req, res) =>
  res
    .status(201)
    .json(await db.$transaction((tx) => generateBill(tx, id(req.params.id), req.body, req.user))),
);
