import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),term=randomUUID(),lastTerm=randomUUID(),busy=randomUUID(),quiet=randomUUID(),kg=randomUUID(),subject=randomUUID();
const headMembership=randomUUID(),teacherMembership=randomUUID(),guardianMembership=randomUUID(),guardianUser=randomUUID();
const headUser='20000000-0000-4000-8000-000000000001',teacherUser='20000000-0000-4000-8000-000000000002';
// Everything is measured on the most recent Thursday, so three weekday absences fit in its week.
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(from:string,delta:number)=>new Date(Date.parse(`${from}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
const thursday=shift(today,-((new Date(`${today}T00:00:00Z`).getUTCDay()+3)%7)),monday=shift(thursday,-3);
let app:any,base:string,head:any,teacher:any;const learners:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
function call(route:string,actor=head,method='GET',body?:unknown){return fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,actor=head){const r=await call(route,actor,'POST',{operationId:randomUUID(),...body});const value=await r.json();assert.equal(r.status,201,JSON.stringify(value));return value;}
async function submit(classId:string,day:string,marks:{learnerId:string;mark:string}[]){const draft=await post(`/attendance/classes/${classId}/register`,{day,version:0,action:'save',marks},teacher);return post(`/attendance/classes/${classId}/register`,{day,version:draft.version,action:'submit',marks},teacher);}
let receipt=1;
async function pay(invoice:string,amount:number,day:string,reversed=false){
  const id=randomUUID();await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,$4,'cash',$5,$6,$7)",[id,school,invoice,amount,day,receipt++,headMembership]);
  if(reversed)await owner.query("INSERT INTO payment_reversals(id,school_id,payment_id,reason,reversed_by) VALUES($1,$2,$3,'Synthetic mistaken entry',$4)",[randomUUID(),school,id,headMembership]);
}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher]=await Promise.all(['head@example.test','teacher@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Morning school')",[school]);
  await owner.query("INSERT INTO users(id,display_name,synthetic_login,password_hash,phone) VALUES($1,'Esi Morning',$2,'x','+233241234567')",[guardianUser,`esi-${guardianUser}@example.test`]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher'),($4,$2,$5,'teacher'),($6,$2,$7,'guardian')",[headMembership,school,headUser,teacherMembership,teacherUser,guardianMembership,guardianUser]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Morning year',$3,$4)",[year,school,shift(monday,-200),shift(monday,100)]);
  // This term started two weeks before the measured week; last term started 120 days before this one.
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 2',$4,$5),($6,$2,$3,'Term 1',$7,$8)",[term,school,year,shift(monday,-14),shift(thursday,15),lastTerm,shift(monday,-134),shift(monday,-44)]);
  for(const [id,name,level] of [[busy,'Morning Busy Class','Primary'],[quiet,'Morning Quiet Class','JHS'],[kg,'Morning KG Class','KG']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,$5,20)",[id,school,year,name,level]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic morning assignment',$7)",[randomUUID(),school,busy,teacherMembership,shift(monday,-10),shift(today,30),headMembership]);
  for(const [name,classId] of [['Often Absent Learner',busy],['Present Learner',busy],['Quiet Class Learner',quiet],['KG Learner',kg]] as const){
    const learner=randomUUID();learners.push(learner);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`M-${learner.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,classId,shift(monday,-30)]);
  }
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Esi Morning',false,false,false,true,now(),$5,'Synthetic contact right')",[randomUUID(),school,learners[0],guardianMembership,headMembership]);
  for(let i=0;i<4;i++)await post('/attendance/school-days',{day:shift(monday,i),isOpen:true,reason:'Synthetic morning open day'});
  for(let i=0;i<3;i++)await submit(busy,shift(monday,i),[{learnerId:learners[0],mark:'absent'},{learnerId:learners[1],mark:'present'}]);
  await submit(busy,thursday,[{learnerId:learners[0],mark:'present'},{learnerId:learners[1],mark:'present'}]);
  // Money: this week 50.00 kept and 9.99 reversed; the same days of last term 30.00; outside that window 77.77.
  const invoice=randomUUID(),old=randomUUID();
  await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amount_pesewas":100000}]',100000,$6),($7,$2,$3,$8,$5,'[{"name":"Tuition","amount_pesewas":100000}]',100000,$6)`,[invoice,school,learners[1],term,busy,headMembership,old,lastTerm]);
  await pay(invoice,5000,shift(monday,1));await pay(invoice,999,shift(monday,1),true);await pay(old,3000,shift(monday,-119));await pay(old,7777,shift(monday,-110));
  // Scores: Mathematics started in the busy class, one exam score still missing; nothing yet in the JHS or KG class.
  await owner.query("INSERT INTO subjects(id,school_id,name) VALUES($1,$2,'Mathematics')",[subject,school]);
  for(const [learner,kind] of [[learners[0],'ca'],[learners[0],'exam'],[learners[1],'ca']])await owner.query("INSERT INTO assessment_score_entries(id,school_id,term_id,class_id,subject_id,learner_id,kind,score,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,60,$8)",[randomUUID(),school,term,busy,subject,learner,kind,headMembership]);
});
after(async()=>{await app?.close();await owner.end();});

test('morning view answers the headteacher’s four questions and is headteacher-only',async()=>{
  assert.equal((await call(`/home/morning?day=${thursday}`,teacher)).status,403);
  assert.equal((await call('/home/morning?day=2026-02-30')).status,400);
  const view=await (await call(`/home/morning?day=${thursday}`)).json();
  assert.deepEqual([view.day,view.weekStart,view.open],[thursday,monday,true]);
  assert.deepEqual(view.registers.map((r:any)=>[r.name,r.status]),[['Morning KG Class','missing'],['Morning Quiet Class','missing']]);
  assert.deepEqual(view.absences.map((a:any)=>[a.full_name,a.class_name,a.absences,a.last_absent_day,a.guardian_name,a.phone]),[['Often Absent Learner','Morning Busy Class',3,shift(monday,2),'Esi Morning','+233241234567']]);
  assert.deepEqual(view.fees,{term:'Term 2',from:monday,to:thursday,collectedPesewas:5000,previous:{term:'Term 1',from:shift(monday,-120),to:shift(thursday,-120),collectedPesewas:3000}});
  assert.deepEqual([view.scores.term,view.scores.daysLeft],['Term 2',15]);
  assert.deepEqual(view.scores.classes.map((c:any)=>[c.name,c.missing,c.subjects,c.not_started]),[['Morning Busy Class',1,['Mathematics'],false],['Morning Quiet Class',0,[],true]]);
});

test('a closed day has no registers due, and a published report removes that learner’s missing scores',async()=>{
  const sunday=shift(monday,-1),closed=await (await call(`/home/morning?day=${sunday}`)).json();
  assert.equal(closed.open,false);assert.deepEqual(closed.registers,[]);
  await owner.query("INSERT INTO terminal_reports(id,school_id,term_id,class_id,learner_id,snapshot,published_by) VALUES($1,$2,$3,$4,$5,'{}',$6)",[randomUUID(),school,term,busy,learners[1],headMembership]);
  const view=await (await call(`/home/morning?day=${thursday}`)).json();
  assert.deepEqual(view.scores.classes.map((c:any)=>c.name),['Morning Quiet Class']);
});
