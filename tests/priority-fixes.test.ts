import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This suite requires an explicit test database rather than loading a production .env.
const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.');
const schema = `test_priority_${Date.now()}`;
const url = new URL(connection);
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'priority-regression-test-secret-not-for-production';
const { db } = await import('../src/config/db.js');
const { app } = await import('../src/app.js');
const admin = request.agent(app), staff = request.agent(app), nurse = request.agent(app);
const header = { 'X-Requested-With': 'HomeNursing' };
const password = 'Priority-Test-Password-2026!';
let serviceId: number, nurseId: number, patientId: number;
beforeAll(async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, stdio: 'pipe',
  });
  nurseId = (await db.nurse.create({ data: { fullName: 'Priority Nurse', phone: '03001234561' } })).id;
  patientId = (await db.patient.create({ data: { patientCode: 'PRIORITY-P1', fullName: 'Priority Patient', phone: '03001234567', address: 'Priority Test Address' } })).id;
  serviceId = (await db.service.create({ data: { name: 'Priority Service', category: 'Nursing', unit: 'PER_VISIT', defaultRate: 600 } })).id;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.createMany({ data: [
    { name: 'Priority Admin', username: 'priorityadmin', passwordHash, role: 'ADMIN' },
    { name: 'Priority Staff', username: 'prioritystaff', passwordHash, role: 'STAFF' },
    { name: 'Priority Nurse', username: 'prioritynurse', passwordHash, role: 'NURSE', nurseId },
  ] });
  await db.setting.createMany({ data: [{ key: 'tax_percent', value: '15' }, { key: 'bill_prefix', value: 'TEST' }] });
  for (const [agent, username] of [[admin, 'priorityadmin'], [staff, 'prioritystaff'], [nurse, 'prioritynurse']] as const)
    expect((await agent.post('/api/auth/login').set(header).send({ username, password })).status).toBe(200);
});
afterAll(async () => {
  if (!/^test_priority_\d+$/.test(schema)) throw new Error('Unsafe test schema');
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
});
const payload = (extra: Record<string, unknown> = {}) => ({ patientId, visitType: 'SINGLE_VISIT', items: [{ serviceId, quantity: 1 }], ...extra });

describe.sequential('Priority billing and validation regressions', () => {
  it.each(['admin', 'staff'] as const)('%s gets identical tax for immediate and delayed billing', async (role) => {
    const agent = role === 'admin' ? admin : staff;
    const immediate = await agent.post('/api/requests').set(header).send(payload({ generateBill: true }));
    const draft = await agent.post('/api/requests').set(header).send(payload());
    expect(immediate.status).toBe(201); expect(draft.status).toBe(201);
    const delayed = await agent.post(`/api/requests/${draft.body.id}/bill`).set(header).send({ taxPercent: '' });
    expect(delayed.status).toBe(201);
    expect(immediate.body.bill.taxPercent).toBe('15'); expect(delayed.body.taxPercent).toBe('15');
    expect(immediate.body.bill.total).toBe('690'); expect(delayed.body.total).toBe('690');
  });
  it('retains saved charges, tax and notes across reads and billing', async () => {
    const created = await admin.post('/api/requests').set(header).send(payload({ charges: { extraCharges: 123, discount: 23, taxPercent: 15, extraChargesNote: 'Travel', notes: 'Draft invoice note' } }));
    expect(created.status).toBe(201);
    const reopened = await staff.get(`/api/requests/${created.body.id}`);
    expect(reopened.body.draftCharges).toMatchObject({ extraCharges: '123', discount: '23', taxPercent: '15', extraChargesNote: 'Travel', notes: 'Draft invoice note' });
    const billed = await staff.post(`/api/requests/${created.body.id}/bill`).set(header).send({});
    expect(billed.status).toBe(201); expect(billed.body.total).toBe('805');
    expect(billed.body.notes).toBe('Draft invoice note'); expect(billed.body.extraChargesNote).toBe('Travel');
    expect((await admin.post(`/api/requests/${created.body.id}/bill`).set(header).send({})).status).toBe(409);
  });
  it('preserves explicit zero tax and supports explicit zero charge overrides', async () => {
    const draft = await admin.post('/api/requests').set(header).send(payload({ charges: { extraCharges: 123, discount: 23, taxPercent: 0 } }));
    expect(draft.status).toBe(201);
    const bill = await admin.post(`/api/requests/${draft.body.id}/bill`).set(header).send({ extraCharges: 0, discount: 0 });
    expect(bill.status).toBe(201); expect(bill.body.taxPercent).toBe('0'); expect(bill.body.total).toBe('600');
    const immediate = await admin.post('/api/requests').set(header).send(payload({ generateBill: true, charges: { taxPercent: 0 } }));
    expect(immediate.status).toBe(201); expect(immediate.body.bill.total).toBe('600');
  });
  it('uses configured tax for requests created before draft-charge storage', async () => {
    const draft = await admin.post('/api/requests').set(header).send(payload());
    await db.requestDraftCharges.delete({ where: { requestId: draft.body.id } });
    const billed = await admin.post(`/api/requests/${draft.body.id}/bill`).set(header).send({ taxPercent: '' });
    expect(billed.status).toBe(201); expect(billed.body.total).toBe('690');
  });
  it('prevents staff tax overrides while retaining an authorized saved rate', async () => {
    expect((await staff.post('/api/requests').set(header).send(payload({ charges: { taxPercent: 0 } }))).status).toBe(403);
    const draft = await admin.post('/api/requests').set(header).send(payload({ charges: { taxPercent: 0 } }));
    expect((await staff.post(`/api/requests/${draft.body.id}/bill`).set(header).send({ taxPercent: 0 })).status).toBe(403);
    const billed = await staff.post(`/api/requests/${draft.body.id}/bill`).set(header).send({});
    expect(billed.status).toBe(201); expect(billed.body.taxPercent).toBe('0');
  });
  it('does not add draft financial data to nurse responses', async () => {
    const draft = await admin.post('/api/requests').set(header).send(payload({ nurseId, charges: { extraCharges: 123, notes: 'PRIVATE_DRAFT_BILL_NOTE' } }));
    const detail = await nurse.get(`/api/requests/${draft.body.id}`);
    expect(detail.status).toBe(200); expect(detail.body.draftCharges).toBeUndefined();
    expect(JSON.stringify((await nurse.get('/api/requests')).body)).not.toContain('PRIVATE_DRAFT_BILL_NOTE');
  });
  it.each(['2026-02-31', '2026-99-99', '2025-02-29', '', null, true])('rejects invalid request date %s without inserting records', async (requestDate) => {
    const before = await db.serviceRequest.count();
    const result = await admin.post('/api/requests').set(header).send(payload({ requestDate }));
    expect(result.status).toBe(422); expect(result.body.error.fields.requestDate).toBeTruthy();
    expect(await db.serviceRequest.count()).toBe(before);
  });
  it('accepts valid leap dates and preserves Karachi calendar dates', async () => {
    const result = await admin.post('/api/requests').set(header).send(payload({ requestDate: '2028-02-29', startDate: '2026-12-31' }));
    expect(result.status).toBe(201); expect(result.body.requestDate).toBe('2028-02-28T19:00:00.000Z');
    expect(result.body.startDate).toBe('2026-12-30T19:00:00.000Z');
  });
  it.each(['from=2026-99-99', 'to=2026-02-31', 'from=2026-11-05&to=2026-11-04'])('returns 422 for invalid date filters: %s', async (filter) => {
    for (const path of ['/api/requests', '/api/bills', '/api/reports/summary'])
      expect((await admin.get(`${path}?${filter}`)).status).toBe(422);
  });
  it('rejects explicit and default-rate line overflow and rolls back nested patient/counter writes', async () => {
    const expensive = await db.service.create({ data: { name: 'Expensive service', category: 'Test', unit: 'PER_ITEM', defaultRate: 1000000 } });
    const before = { patients: await db.patient.count(), requests: await db.serviceRequest.count(), counters: await db.counter.findMany() };
    for (const line of [{ serviceId, quantity: 1000000, rate: 1000000 }, { serviceId: expensive.id, quantity: 1000000 }]) {
      const result = await admin.post('/api/requests').set(header).send({ patient: { fullName: 'Rollback Patient', phone: '03001112222', address: 'Test rollback address' }, visitType: 'SINGLE_VISIT', items: [line] });
      expect(result.status).toBe(422); expect(result.body.error.fields['items.0.rate']).toBeTruthy();
    }
    expect(await db.patient.count()).toBe(before.patients); expect(await db.serviceRequest.count()).toBe(before.requests);
    expect(await db.counter.findMany()).toEqual(before.counters);
  });
  it('rejects aggregate overflow on unbilled requests', async () => {
    const result = await admin.post('/api/requests').set(header).send(payload({ items: [1, 2].map(() => ({ serviceId, quantity: 1, rate: 5000000000 })) }));
    expect(result.status).toBe(422);
  });
  it('accepts the supported amount boundary and rounds fractional line amounts', async () => {
    const boundary = await admin.post('/api/requests').set(header).send(payload({
      generateBill: true, charges: { taxPercent: 0 }, items: [{ serviceId, quantity: 1, rate: 9999999999.99 }],
    }));
    expect(boundary.status).toBe(201); expect(boundary.body.bill.total).toBe('9999999999.99');
    const fraction = await admin.post('/api/requests').set(header).send(payload({
      items: [{ serviceId, quantity: 0.01, rate: 9999999999.99 }],
    }));
    expect(fraction.status).toBe(201); expect(fraction.body.items[0].amount).toBe('100000000');
  });
  it('retains the saved tax rate after the company default changes', async () => {
    const draft = await admin.post('/api/requests').set(header).send(payload());
    await db.setting.update({ where: { key: 'tax_percent' }, data: { value: '20' } });
    try {
      const bill = await staff.post(`/api/requests/${draft.body.id}/bill`).set(header).send({});
      expect(bill.status).toBe(201); expect(bill.body.taxPercent).toBe('15'); expect(bill.body.total).toBe('690');
    } finally {
      await db.setting.update({ where: { key: 'tax_percent' }, data: { value: '15' } });
    }
  });
  it('enforces assignment consistency while retaining automatic assignment transitions', async () => {
    const draft = await admin.post('/api/requests').set(header).send(payload());
    expect((await admin.patch(`/api/requests/${draft.body.id}`).set(header).send({ status: 'ASSIGNED', nurseId: null })).status).toBe(422);
    expect((await admin.patch(`/api/requests/${draft.body.id}`).set(header).send({ nurseId })).body.status).toBe('ASSIGNED');
    expect((await admin.patch(`/api/requests/${draft.body.id}`).set(header).send({ nurseId: null })).body.status).toBe('NEW');
    await db.nurse.update({ where: { id: nurseId }, data: { isActive: false } });
    try {
      expect((await admin.patch(`/api/requests/${draft.body.id}`).set(header).send({ nurseId })).status).toBe(422);
    } finally {
      await db.nurse.update({ where: { id: nurseId }, data: { isActive: true } });
    }
  });
});
