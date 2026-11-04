import { Router } from 'express';
import { db } from '../../config/db.js';
import { office } from '../../middleware/requireRole.js';
import { patientSchema, normalizePhone } from '../../../shared/schema.js';
import { id, query, searchFields, listResult } from '../../lib/query.js';
import { nextNumber } from '../../lib/numberGenerator.js';
import { log } from '../../lib/activity.js';
export const patientRoutes = Router();
const publicPatient = {
  id: true,
  patientCode: true,
  fullName: true,
  phone: true,
  altPhone: true,
  address: true,
  area: true,
  city: true,
  age: true,
  gender: true,
  guardianName: true,
  guardianRelation: true,
  createdAt: true,
  updatedAt: true,
};
patientRoutes.get('/lookup', office, async (req, res) => {
  const phone = normalizePhone(String(req.query.phone || ''));
  res.json(
    phone.length >= 4
      ? await db.patient.findMany({
          where: { phone: { contains: phone } },
          take: 10,
          include: { _count: { select: { requests: true } } },
        })
      : [],
  );
});
patientRoutes.get('/', async (req, res) => {
  const q = query(req, ['fullName', 'patientCode', 'createdAt']);
  const where = {
    ...searchFields(q.search, ['fullName', 'phone', 'patientCode']),
    ...(req.query.area ? { area: { equals: String(req.query.area), mode: 'insensitive' as const } } : {}),
    ...(req.user.role === 'NURSE' ? { requests: { some: { nurseId: req.user.nurseId ?? -1 } } } : {}),
  };
  const [data, total] = await db.$transaction([
    db.patient.findMany({
      where,
      select: req.user.role === 'NURSE' ? publicPatient : undefined,
      skip: q.skip,
      take: q.take,
      orderBy: q.orderBy,
    }),
    db.patient.count({ where }),
  ]);
  res.json(listResult(data, total, q));
});
patientRoutes.get('/:id', async (req, res) => {
  const patientId = id(req.params.id),
    nurse = req.user.role === 'NURSE';
  const where = {
    id: patientId,
    ...(nurse ? { requests: { some: { nurseId: req.user.nurseId ?? -1 } } } : {}),
  };
  const select = {
    ...publicPatient,
    ...(!nurse ? { medicalNotes: true } : {}),
    requests: {
      where: nurse ? { nurseId: req.user.nurseId ?? -1 } : undefined,
      include: { nurse: true, ...(!nurse ? { bill: true } : {}) },
      orderBy: { requestDate: 'desc' as const },
    },
  };
  res.json(await db.patient.findFirstOrThrow({ where, select }));
});
patientRoutes.post('/', office, async (req, res) => {
  const data = patientSchema.parse(req.body);
  res.status(201).json(
    await db.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: { ...data, patientCode: await nextNumber(tx, 'PATIENT', 'P-') },
      });
      await log(tx, req.user.id, 'CREATE', 'Patient', patient.id);
      return patient;
    }),
  );
});
patientRoutes.patch('/:id', office, async (req, res) => {
  const data = patientSchema.partial().parse(req.body);
  res.json(
    await db.$transaction(async (tx) => {
      const patient = await tx.patient.update({ where: { id: id(req.params.id) }, data });
      await log(tx, req.user.id, 'UPDATE', 'Patient', patient.id, { fields: Object.keys(data) });
      return patient;
    }),
  );
});
