import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),term=randomUUID(),cls=randomUUID(),headM=randomUUID(),acctM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID(),billingOnlyM=randomUUID();
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,acct:any,teacher:any,guardian:any;const kids:string[]=[];let invoices:any[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,body:Record<string,unknown>,actor=acct,status=201){const r=await call(route,'POST',{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,acct,teacher,guardian]=await Promise.all(['head@example.test','frontdesk@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Finance school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$5,'20000000-0000-4000-8000-000000000001','headteacher'),($2,$5,'20000000-0000-4000-8000-000000000004','accountant'),($3,$5,'20000000-0000-4000-8000-000000000002','teacher'),($4,$5,'20000000-0000-4000-8000-000000000003','guardian')",[headM,acctM,teacherM,guardianM,school]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Finance year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[term,school,year,shift(-55),shift(30)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Primary 2 Gold','Primary',30)",[cls,school,year]);
  for(const name of ['Fee Learner One','Fee Learner Two']){const id=randomUUID();kids.push(id);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`FE-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-50)]);}
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',false,true,false,false,now(),$5,'Synthetic billing access')",[randomUUID(),school,kids[0],guardianM,headM]);
});
after(async()=>{await app?.close();await owner.end();});

test('only head and accountant can use finance routes',async()=>{
  for(const actor of [teacher,guardian]){assert.equal((await call('/finance/fee-items','GET',undefined,actor)).status,403);assert.equal((await call('/finance/summary?termId='+term,'GET',undefined,actor)).status,403);}
  assert.equal((await call('/finance/fee-items','POST',{operationId:randomUUID(),termId:term,name:'Tuition',amountPesewas:100},teacher)).status,403);
});

test('accountants can list terms and classes for billing',async()=>{
  assert.equal((await call('/finance/terms','GET',undefined,acct)).body.items[0].name,'Term 1');assert.equal((await call('/finance/classes','GET',undefined,acct)).body.items[0].name,'Primary 2 Gold');
  assert.equal((await call('/finance/terms','GET',undefined,teacher)).status,403);
});

test('fee items generate one invoice per enrolled learner; totals are whole pesewas',async()=>{
  assert.equal((await call('/finance/invoices/generate','POST',{operationId:randomUUID(),termId:term,classId:cls},acct)).status,409);
  await ok('/finance/fee-items',{termId:term,name:'Tuition',amountPesewas:45000});await ok('/finance/fee-items',{termId:term,name:'PTA levy',amountPesewas:2550,level:'Primary'});await ok('/finance/fee-items',{termId:term,name:'JHS exam fee',amountPesewas:9900,level:'JHS'});
  assert.equal((await call('/finance/fee-items','POST',{operationId:randomUUID(),termId:term,name:'Bad',amountPesewas:10.5},acct)).status,400);
  assert.equal((await call('/finance/fee-items','POST',{operationId:randomUUID(),termId:term,name:'Bad',amountPesewas:0},acct)).status,400);
  const op=randomUUID(),first=await call('/finance/invoices/generate','POST',{operationId:op,termId:term,classId:cls},acct);assert.equal(first.status,201);
  assert.deepEqual(first.body,{created:2,alreadyInvoiced:0,totalPerLearnerPesewas:47550});assert.deepEqual((await call('/finance/invoices/generate','POST',{operationId:op,termId:term,classId:cls},acct)).body,first.body);
  assert.deepEqual((await ok('/finance/invoices/generate',{termId:term,classId:cls})),{created:0,alreadyInvoiced:2,totalPerLearnerPesewas:47550});
  invoices=(await call(`/finance/invoices?termId=${term}`,'GET',undefined,acct)).body.items;assert.equal(invoices.length,2);assert.ok(invoices.every((row:any)=>row.total_pesewas===47550&&row.balance_pesewas===47550));
  assert.deepEqual(invoices[0].lines.map((line:any)=>line.name),['PTA levy','Tuition']);
});

test('payments issue sequential receipts, cannot overpay, and reversals need a reasoned head action',async()=>{
  const invoice=invoices.find((row:any)=>row.learner_id===kids[0]);
  const op=randomUUID(),body={operationId:op,invoiceId:invoice.id,amountPesewas:20000,method:'mobile_money',reference:'MoMo-123',receivedOn:today};
  const first=await call('/finance/payments','POST',body,acct);assert.equal(first.status,201);assert.equal(first.body.receiptNumber,1);assert.equal(first.body.balancePesewas,27550);
  assert.deepEqual((await call('/finance/payments','POST',body,acct)).body,first.body);
  assert.equal((await owner.query('SELECT count(*) FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].count,'1','retry did not double-record');
  assert.equal((await call('/finance/payments','POST',{...body,operationId:randomUUID(),amountPesewas:27551},acct)).status,409);
  assert.equal((await call('/finance/payments','POST',{...body,operationId:randomUUID(),method:'cheque'},acct)).status,400);
  const second=await ok('/finance/payments',{invoiceId:invoice.id,amountPesewas:27550,method:'cash',receivedOn:today});assert.equal(second.receiptNumber,2);assert.equal(second.balancePesewas,0);
  const receipt=(await call(`/finance/payments/${first.body.id}/receipt`,'GET',undefined,acct)).body;assert.equal(receipt.receipt_number,1);assert.equal(receipt.school_name,'Finance school');assert.equal(receipt.amount_pesewas,20000);
  assert.equal((await call(`/finance/payments/${first.body.id}/reverse`,'POST',{operationId:randomUUID(),reason:'Wrong learner'},acct)).status,403);
  assert.equal((await call(`/finance/payments/${first.body.id}/reverse`,'POST',{operationId:randomUUID(),reason:'x'},head)).status,400);
  await ok(`/finance/payments/${first.body.id}/reverse`,{reason:'Recorded against the wrong learner'},head);
  assert.equal((await call(`/finance/payments/${first.body.id}/reverse`,'POST',{operationId:randomUUID(),reason:'Second attempt'},head)).status,409);
  const after=(await call(`/finance/invoices?termId=${term}&outstandingOnly=true`,'GET',undefined,acct)).body;assert.equal(after.total,2);
  assert.equal(after.items.find((row:any)=>row.learner_id===kids[0]).balance_pesewas,20000);
  await assert.rejects(owner.query('DELETE FROM payments WHERE id=$1',[first.body.id]),/append-only/);await assert.rejects(owner.query('UPDATE invoices SET total_pesewas=1'),/append-only/);
  const summary=(await call(`/finance/summary?termId=${term}`,'GET',undefined,acct)).body;assert.deepEqual(summary,{invoices:2,billedPesewas:95100,adjustmentsPesewas:0,collectedPesewas:27550,outstandingPesewas:67550});
  const actions=(await call('/audit?limit=100')).body.items.map((row:any)=>row.action);for(const a of ['finance.payment.recorded','finance.payment.reversed','finance.invoices.generated'])assert.ok(actions.includes(a),a);
});

test('guardians see statements only for children where they hold verified billing rights',async()=>{
  const mine=await call(`/guardian/children/${kids[0]}/statement`,'GET',undefined,guardian);assert.equal(mine.status,200);assert.equal(mine.body.items[0].balance_pesewas,20000);
  assert.equal((await call(`/guardian/children/${kids[1]}/statement`,'GET',undefined,guardian)).status,404);
  assert.equal((await call(`/guardian/children/${kids[0]}/statement`,'GET',undefined,acct)).status,403);
});
