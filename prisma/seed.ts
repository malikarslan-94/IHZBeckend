import bcrypt from 'bcrypt';
import {readFileSync} from 'node:fs';
const defaultLogo = 'data:image/png;base64,' + readFileSync(new URL('../shared/ihz-logo.png', import.meta.url)).toString('base64');
import {db} from '../src/config/db.js';
import {nextNumber} from '../src/lib/numberGenerator.js';
import {generateBill,snapshotItems} from '../src/modules/bills/service.js';
import {recalculate} from '../src/modules/bills/service.js';
const defaults:Record<string,string>={company_name:'Islamabad Health Zone',company_address:'Islamabad, Pakistan',company_phone:'0300-1234567',company_whatsapp:'0300-1234567',company_email:'',logo:defaultLogo,default_city:'Islamabad',bill_prefix:'HN',bill_footer:'Thank you for trusting us with your care.',terms_text:'Payment is due upon receipt. Please quote your bill number when making a payment.',tax_percent:'0',show_nurse_phone_on_bill:'false'};
const serviceRows=[['Injection (IM/IV)','Injection','PER_VISIT',500],['IV Cannula + Drip','Injection','PER_VISIT',1500],['Wound Dressing','Dressing','PER_VISIT',1000],['Catheter Insertion','Other','PER_VISIT',2000],['NG Tube Insertion','Other','PER_VISIT',2000],['Vitals Check','Other','PER_VISIT',500],['12-hour Nursing Shift','Nursing Shift','PER_SHIFT',3500],['24-hour Nursing Shift','Nursing Shift','PER_SHIFT',6000],['Physiotherapy Session','Physiotherapy','PER_VISIT',2500],['Oxygen Cylinder Rent','Equipment','PER_DAY',800],['Consumables','Equipment','PER_ITEM',1]] as const;
async function main(){
 const adminPassword=process.env.SEED_ADMIN_PASSWORD,staffPassword=process.env.SEED_STAFF_PASSWORD;
 if(!adminPassword||!staffPassword||adminPassword.length<12||staffPassword.length<12)throw new Error('Set seed admin/staff passwords of at least 12 characters.');
 await db.$transaction(async tx=>{
  // Serialize startup seed jobs, and leave existing account passwords and settings untouched.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(426071)`;
  for(const [key,value] of Object.entries(defaults))await tx.setting.upsert({where:{key},create:{key,value},update:{}});
  const admin=await tx.user.upsert({where:{username:'admin'},create:{name:'Office Admin',username:'admin',role:'ADMIN',passwordHash:await bcrypt.hash(adminPassword,12)},update:{}});
  await tx.user.upsert({where:{username:'staff'},create:{name:'Front Desk',username:'staff',role:'STAFF',passwordHash:await bcrypt.hash(staffPassword,12)},update:{}});
  for(const [name,category,unit,defaultRate] of serviceRows)await tx.service.upsert({where:{name},create:{name,category,unit,defaultRate},update:{}});
  if(process.env.NODE_ENV!=='development'||await tx.setting.findUnique({where:{key:'development_seeded'}}))return;
  const nurses=[];
  for(const [fullName,phone,qualification,gender] of [['Ayesha Khan','03001234561','Registered Nurse · BSN','FEMALE'],['Ahmed Raza','03001234562','Registered Nurse · RN','MALE'],['Sana Malik','03001234563','Physiotherapist · DPT','FEMALE']] as const)nurses.push(await tx.nurse.create({data:{fullName,phone,qualification,gender}}));
  if(process.env.SEED_NURSE_PASSWORD&&process.env.SEED_NURSE_PASSWORD.length>=12)await tx.user.upsert({where:{username:'nurse'},create:{name:nurses[0].fullName,username:'nurse',role:'NURSE',nurseId:nurses[0].id,passwordHash:await bcrypt.hash(process.env.SEED_NURSE_PASSWORD,12)},update:{}});
  const services=await tx.service.findMany({orderBy:{id:'asc'}});
  const patients=[];
  for(const [fullName,area,age,gender] of [['Fatima Ahmed','F-10',62,'FEMALE'],['Muhammad Ali','G-11',54,'MALE'],['Zainab Hassan','DHA Phase II',70,'FEMALE'],['Usman Siddiqui','Bahria Town',48,'MALE'],['Maryam Faisal','I-8',35,'FEMALE']] as const)patients.push(await tx.patient.create({data:{patientCode:await nextNumber(tx,'PATIENT','P-'),fullName,phone:`0300111100${patients.length}`,address:`House ${12+patients.length}, Street 4, ${area}`,area,city:'Islamabad',age,gender,medicalNotes:'Development sample record; replace before live use.'}}));
  for(let i=0;i<5;i++){
   const date=new Date();date.setDate(date.getDate()-(4-i));
   const inputs=[{serviceId:services[i===0?6:i===1?8:i===2?2:i===3?1:0].id,quantity:i===0?3:1,serviceDate:date}];
   const request=await tx.serviceRequest.create({data:{requestNo:await nextNumber(tx,'REQ','IHZ-'),patientId:patients[i].id,nurseId:nurses[i%3].id,requestDate:date,startDate:date,visitType:i===0?'SHIFT_12H':'SINGLE_VISIT',serviceAddress:patients[i].address,status:i<3?'COMPLETED':i===3?'IN_PROGRESS':'ASSIGNED',createdById:admin.id,items:{create:await snapshotItems(tx,inputs)}}});
   const bill=await generateBill(tx,request.id,{extraCharges:i===0?500:0,extraChargesNote:i===0?'Travel':null},admin);
   await tx.bill.update({where:{id:bill.id},data:{billDate:date}});
   if(i<3){await tx.payment.create({data:{receiptNo:await nextNumber(tx,'PAY','PAY-'),billId:bill.id,amount:i===0?5000:bill.total,paymentDate:date,method:'CASH',receivedById:admin.id}});await recalculate(tx,bill.id);}
  }
  await tx.setting.create({data:{key:'development_seeded',value:'true'}});
 },{timeout:60000});
 console.log('Seed complete. Existing data and passwords were preserved.');
}
main().finally(()=>db.$disconnect());
