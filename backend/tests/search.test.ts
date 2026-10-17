import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
// The top bar's year and term, and the one search box: what each role may find.
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),mine=randomUUID(),theirs=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID(),acctM=randomUUID();
const [headU,teacherU,guardianU,deskU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const tag=randomUUID().slice(0,6);
let app:any,base:string,head:any,teacher:any,guardian:any,acct:any;const kids:Record<string,string>={};let paymentId='';
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,actor=head,id=school){const r=await fetch(`${base}/schools/${id}${route}`,{headers:{cookie:actor.cookie}});return {status:r.status,body:await r.json().catch(()=>null)};}
const find=(q:string,actor=head,id=school)=>call(`/search?q=${encodeURIComponent(q)}`,actor,id);
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,acct]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Search school'),($2,'Desk school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$5,$6,'headteacher'),($2,$5,$7,'teacher'),($3,$5,$8,'guardian'),($4,$5,$9,'accountant')",[headM,teacherM,guardianM,acctM,school,headU,teacherU,guardianU,deskU]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$3,$4,'headteacher'),($2,$3,$5,'frontdesk')",[randomUUID(),randomUUID(),other,headU,deskU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Search year',$3,$4)",[year,school,shift(-60),shift(200)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5),($6,$2,$3,'Term 2',$7,$8)",[randomUUID(),school,year,shift(-15),shift(30),randomUUID(),shift(60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 3','Primary',30),($2,$3,$4,'Basic 4','Primary',30)",[mine,theirs,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic class teacher',$7)",[randomUUID(),school,mine,teacherM,shift(-30),shift(150),headM]);
  for(const [key,name,cls] of [['mine',`Esi ${tag} Mensah`,mine],['theirs',`Kwame ${tag} Boateng`,theirs]] as const){const id=randomUUID();kids[key]=id;
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`SR-${key}-${tag}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-20)]);}
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[randomUUID(),other,`OT-${tag}`,`Esi ${tag} Elsewhere`]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,$5,true,true,false,true,now(),$6,'Synthetic access')",[randomUUID(),school,kids.mine,guardianM,`Abena ${tag} Mensah`,headM]);
  const invoice=randomUUID();paymentId=randomUUID();
  await owner.query("INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) SELECT $1,$2,$3,id,$4,'[]',50000,$5 FROM terms WHERE school_id=$2 AND name='Term 1'",[invoice,school,kids.mine,mine,acctM]);
  await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,12000,'cash',$4,4321,$5)",[paymentId,school,invoice,today,acctM]);
});
after(async()=>{await app?.close();await owner.end();});

test('the top bar shows the year and term running today, with its week, and the next term in a holiday',async()=>{
  const now=(await call('/context')).body;assert.equal(now.yearName,'Search year');assert.equal(now.term.name,'Term 1');assert.equal(now.term.week,3);assert.equal(now.nextTerm,null);
  assert.equal((await call('/context',guardian)).status,200,'every member sees it');
  await owner.query("UPDATE terms SET start_date=$2 WHERE school_id=$1 AND name='Term 1'",[school,shift(5)]);
  const holiday=(await call('/context')).body;assert.equal(holiday.term,null);assert.equal(holiday.nextTerm.name,'Term 1');assert.equal(holiday.yearName,'Search year');
  await owner.query("UPDATE terms SET start_date=$2 WHERE school_id=$1 AND name='Term 1'",[school,shift(-15)]);
});

test('the headteacher finds students by name or admission number, parents by name and receipts by number',async()=>{
  const byName=(await find(`esi ${tag}`)).body;assert.deepEqual(byName.students.map((s:any)=>[s.full_name,s.class_name]),[[`Esi ${tag} Mensah`,'Basic 3']],'only this school');
  assert.equal((await find(`SR-theirs-${tag}`)).body.students[0].id,kids.theirs);
  assert.deepEqual((await find(`abena ${tag}`)).body.parents,[{name:`Abena ${tag} Mensah`,children:`Esi ${tag} Mensah`}]);
  for(const q of ['4321','No. 4321','004321'])assert.equal((await find(q)).body.receipts[0]?.id,paymentId,q);
  assert.equal((await find('x')).status,400,'two letters at least');assert.equal((await find('%_')).body.students.length,0,'wildcards are literal');
});

test('a teacher finds only students in classes they teach; accountants get receipts but not parents; parents cannot search',async()=>{
  assert.deepEqual((await find(tag,teacher)).body.students.map((s:any)=>s.id),[kids.mine]);
  const t=(await find(`abena ${tag}`,teacher)).body;assert.equal(t.parents.length,0);assert.equal((await find('4321',teacher)).body.receipts.length,0);
  const a=(await find(tag,acct)).body;assert.equal(a.students.length,2);assert.equal(a.parents.length,0);assert.equal((await find('4321',acct)).body.receipts[0].full_name,`Esi ${tag} Mensah`);
  const desk=(await find(tag,acct,other)).body;assert.deepEqual(desk.students.map((s:any)=>s.full_name),[`Esi ${tag} Elsewhere`],'front desk in its own school only');assert.equal(desk.receipts.length,0);
  assert.equal((await find(tag,guardian)).status,403);
});
