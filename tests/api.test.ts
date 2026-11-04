import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
dotenv.config({path:'../.env',quiet:true});
dotenv.config({quiet:true});
const schema=`test_nursing_${Date.now()}`;
const testUrl=new URL(process.env.DATABASE_URL!);testUrl.searchParams.set('schema',schema);
process.env.DATABASE_URL=testUrl.toString();process.env.NODE_ENV='test';
const {db}=await import('../src/config/db.js');
const {app}=await import('../src/app.js');
const {nextNumber}=await import('../src/lib/numberGenerator.js');
const {closeBrowser}=await import('../src/lib/pdf.js');
const admin=request.agent(app),staff=request.agent(app),nurse=request.agent(app);
const header={'X-Requested-With':'HomeNursing'};
const testPassword='TestPassword!2026';
let serviceId:number,nurseId:number,patientId:number,requestId:number,billId:number,paymentId:number,otherPatientId:number;
beforeAll(async()=>{
 execFileSync(process.execPath,[fileURLToPath(new URL('../node_modules/prisma/build/index.js',import.meta.url)),'migrate','deploy'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:process.env,stdio:'pipe',windowsHide:true});
 const passwordHash=await bcrypt.hash(testPassword,12);
 const n=await db.nurse.create({data:{fullName:'Test Nurse',phone:'03001234561'}});nurseId=n.id;
 await db.user.createMany({data:[{name:'Test Admin',username:'testadmin',passwordHash,role:'ADMIN'},{name:'Test Staff',username:'teststaff',passwordHash,role:'STAFF'},{name:'Test Nurse',username:'testnurse',passwordHash,role:'NURSE',nurseId},{name:'Inactive',username:'inactive',passwordHash,role:'STAFF',isActive:false}]});
 serviceId=(await db.service.create({data:{name:'Test injection',category:'Injection',unit:'PER_VISIT',defaultRate:500}})).id;
 await db.setting.createMany({data:[{key:'company_name',value:'Test Home Care'},{key:'bill_prefix',value:'HN'},{key:'tax_percent',value:'0'},{key:'show_nurse_phone_on_bill',value:'false'}]});
 otherPatientId=(await db.patient.create({data:{patientCode:'UNASSIGNED',fullName:'Other Patient',phone:'03001234569',address:'Other address',medicalNotes:'UNRELATED_PRIVATE_NOTE'}})).id;
 for(const [agent,username] of [[admin,'testadmin'],[staff,'teststaff'],[nurse,'testnurse']] as const){const result=await agent.post('/api/auth/login').set(header).send({username,password:testPassword});expect(result.status).toBe(200);expect(result.headers['set-cookie'][0]).toContain('HttpOnly');expect(result.headers['set-cookie'][0]).toContain('SameSite=Lax');expect(result.body.passwordHash).toBeUndefined();}
},60000);
afterAll(async()=>{await closeBrowser();if(!/^test_nursing_\d+$/.test(schema))throw new Error('Unsafe test schema');await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect();},30000);
describe.sequential('Real PostgreSQL API workflow',()=>{
 it('requires login, rejects inactive users, and enforces CSRF and roles',async()=>{
  expect((await request(app).get('/api/patients')).status).toBe(401);
  expect((await request(app).post('/api/auth/login').set(header).send({username:'inactive',password:testPassword})).status).toBe(401);
  expect((await staff.post('/api/patients').send({})).status).toBe(403);
  expect((await staff.post('/api/patients').set(header).set('Origin','https://untrusted.example').send({})).status).toBe(403);
  expect((await staff.get('/api/users')).status).toBe(403);
  expect((await staff.patch(`/api/services/${serviceId}`).set(header).send({defaultRate:10})).status).toBe(403);
  expect((await nurse.get('/api/bills')).status).toBe(403);
 });
 it('creates a patient, nurse assignment and rate-snapshot lines in one request',async()=>{
  const result=await staff.post('/api/requests').set(header).send({patient:{fullName:'API Test Patient',phone:'+923001234567',address:'Test address',medicalNotes:'PRIVATE_MEDICAL_NOTE'},visitType:'SINGLE_VISIT',nurseId,items:[{serviceId,quantity:2}]});
  expect(result.status).toBe(201);requestId=result.body.id;patientId=result.body.patientId;expect(result.body.status).toBe('ASSIGNED');expect(result.body.patient.phone).toBe('03001234567');expect(result.body.items[0].amount).toBe('1000');expect(result.body.bill).toBeNull();
  expect((await nurse.get(`/api/requests/${requestId}`)).body.patient.medicalNotes).toBeUndefined();
  expect((await nurse.get(`/api/patients/${patientId}`)).body.medicalNotes).toBeUndefined();
  expect((await nurse.get(`/api/patients/${otherPatientId}`)).status).toBe(404);
 });
 it('generates one sequential bill and keeps its rate snapshot after rate changes',async()=>{
  const result=await staff.post(`/api/requests/${requestId}/bill`).set(header).send({extraCharges:100,discount:50});expect(result.status).toBe(201);billId=result.body.id;expect(result.body.total).toBe('1050');expect(result.body.billNo).toMatch(/^HN-\d{4}-0001$/);
  expect((await staff.post(`/api/requests/${requestId}/bill`).set(header).send({})).status).toBe(409);
  await admin.patch(`/api/services/${serviceId}`).set(header).send({defaultRate:999});const requestResult=await staff.get(`/api/requests/${requestId}`);expect(requestResult.body.items[0].rate).toBe('500');
  const preview=await staff.get(`/api/bills/${billId}/preview`);expect(preview.status).toBe(200);expect(preview.text).toContain('BILL / INVOICE');expect(preview.text).not.toContain('PRIVATE_MEDICAL_NOTE');expect(preview.text).not.toContain('03001234561');
 });
 it('allows staff to edit before payment and rejects invalid amounts and dates',async()=>{
  const result=await staff.patch(`/api/bills/${billId}`).set(header).send({discount:100});expect(result.status).toBe(200);expect(result.body.total).toBe('1000');
  expect((await staff.patch(`/api/bills/${billId}`).set(header).send({discount:99999})).status).toBe(422);
  expect((await staff.patch(`/api/requests/${requestId}`).set(header).send({startDate:'2026-10-10',endDate:'2026-10-09'})).status).toBe(422);
  expect((await staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:0,method:'CASH'})).status).toBe(422);
  expect((await staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:100,method:'BANK_TRANSFER'})).status).toBe(422);
 });
 it('records a partial payment, blocks staff edits, and allows audited admin edits',async()=>{
  const result=await staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:400,method:'CASH'});expect(result.status).toBe(201);paymentId=result.body.payment.id;expect(result.body.bill.status).toBe('PARTIAL');expect(result.body.bill.balance).toBe('600');
  expect((await staff.patch(`/api/bills/${billId}`).set(header).send({discount:0})).status).toBe(403);
  const detail=await staff.get(`/api/requests/${requestId}`);const items=detail.body.items.map((i:any)=>({...i,quantity:Number(i.quantity),rate:Number(i.rate)}));
  expect((await staff.put(`/api/requests/${requestId}/items`).set(header).send(items)).status).toBe(403);
  expect((await admin.patch(`/api/bills/${billId}`).set(header).send({discount:200})).status).toBe(200);
  expect((await admin.get(`/api/activity?entityType=Bill&entityId=${billId}`)).body.total).toBeGreaterThanOrEqual(3);
  const receipt=await staff.get(`/api/payments/${paymentId}/receipt?format=thermal`);expect(receipt.status).toBe(200);expect(receipt.text).not.toContain('PRIVATE_MEDICAL_NOTE');
 });
 it('rejects staff overpayment and serializes concurrent payments against the same balance',async()=>{
  expect((await staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:1000,method:'CASH',allowOverpayment:true})).status).toBe(422);
  const attempts=await Promise.all([1,2].map(()=>staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:500,method:'CASH'})));expect(attempts.map(r=>r.status).sort()).toEqual([201,422]);expect((await staff.get(`/api/bills/${billId}`)).body.status).toBe('PAID');
  const overpay=await admin.post(`/api/bills/${billId}/payments`).set(header).send({amount:1,method:'CASH',allowOverpayment:true});expect(overpay.status).toBe(201);expect(overpay.body.bill.balance).toBe('-1');
 });
 it('restricts reversals and preserves receipts in the audit trail',async()=>{
  expect((await staff.delete(`/api/payments/${paymentId}`).set(header).send({reason:'Test reversal'})).status).toBe(403);
  expect((await admin.delete(`/api/payments/${paymentId}`).set(header).send({})).status).toBe(422);
  const result=await admin.delete(`/api/payments/${paymentId}`).set(header).send({reason:'Duplicate entered in test'});expect(result.status).toBe(200);expect(result.body.balance).toBe('399');expect(result.body.status).toBe('PARTIAL');
  expect((await admin.get(`/api/activity?entityType=Bill&entityId=${billId}`)).body.data.some((l:any)=>l.action==='PAYMENT_DELETE'&&l.details.payment.id===paymentId)).toBe(true);
 });
 it('requires cancelling the bill first and excludes it from income reports',async()=>{
  expect((await staff.patch(`/api/requests/${requestId}`).set(header).send({status:'CANCELLED'})).status).toBe(409);
  expect((await staff.post(`/api/bills/${billId}/cancel`).set(header).send({reason:'Test cancellation'})).status).toBe(403);
  const result=await admin.post(`/api/bills/${billId}/cancel`).set(header).send({reason:'Test cancellation'});expect(result.status).toBe(200);expect(result.body.status).toBe('CANCELLED');expect(result.body.billNo).toMatch(/^HN-/);
  expect((await staff.post(`/api/bills/${billId}/payments`).set(header).send({amount:10,method:'CASH'})).status).toBe(409);
  expect((await staff.patch(`/api/requests/${requestId}`).set(header).send({status:'CANCELLED'})).status).toBe(200);
  const summary=await admin.get('/api/reports/summary');expect(summary.status).toBe(200);expect(summary.body.received).toBe('0.00');expect(summary.body.billed).toBe('0.00');
  expect((await staff.get('/api/reports/by-service')).status).toBe(403);expect((await staff.get('/api/reports/summary')).status).toBe(200);
  const excel=await admin.get('/api/reports/summary/export');expect(excel.status).toBe(200);expect(excel.headers['content-type']).toContain('spreadsheetml');
 });
 it('generates unique numbers concurrently and keeps independent yearly counters',async()=>{
  const numbers=await Promise.all(Array.from({length:30},()=>db.$transaction(tx=>nextNumber(tx,'TEST_CONCURRENT','TEST-'))));expect(new Set(numbers).size).toBe(30);
  const years=await db.$transaction(async tx=>[await nextNumber(tx,'BILL-2040','HN-2040-'),await nextNumber(tx,'BILL-2040','HN-2040-'),await nextNumber(tx,'BILL-2041','HN-2041-')]);expect(years).toEqual(['HN-2040-0001','HN-2040-0002','HN-2041-0001']);
 });
 it('invalidates sessions after password resets and does not expose password hashes',async()=>{
  const users=await admin.get('/api/users');expect(JSON.stringify(users.body)).not.toContain('passwordHash');const staffUser=users.body.data.find((u:any)=>u.username==='teststaff');expect((await admin.post(`/api/users/${staffUser.id}/reset-password`).set(header).send({password:'ReplacementPassword!2026'})).status).toBe(200);expect((await staff.get('/api/auth/me')).status).toBe(401);
 });
});
