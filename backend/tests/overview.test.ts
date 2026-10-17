import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
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
const school=randomUUID(),year=randomUUID(),term=randomUUID(),busy=randomUUID(),quiet=randomUUID(),kg=randomUUID(),subject=randomUUID();
const headMembership=randomUUID(),teacherMembership=randomUUID();
const headUser='20000000-0000-4000-8000-000000000001',teacherUser='20000000-0000-4000-8000-000000000002';
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher]=await Promise.all(['head@example.test','teacher@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Overview school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher'),($4,$2,$5,'teacher')",[headMembership,school,headUser,teacherMembership,teacherUser]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Overview year',$3,$4)",[year,school,shift(monday,-200),shift(monday,100)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 2',$4,$5)",[term,school,year,shift(monday,-14),shift(thursday,15)]);
  for(const [id,name,level] of [[busy,'Overview Busy Class','Primary'],[quiet,'Overview Quiet Class','JHS'],[kg,'Overview KG Class','KG']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,$5,30)",[id,school,year,name,level]);
  for(const classId of [busy,quiet])await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic overview assignment',$7)",[randomUUID(),school,classId,teacherMembership,shift(monday,-10),shift(today,30),headMembership]);
  for(const [name,classId,sex] of [['Often Absent Learner',busy,'female'],['Present Learner',busy,'male'],['Quiet Class Learner',quiet,null],['KG Learner',kg,'female']] as const){
    const learner=randomUUID();learners.push(learner);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,sex) VALUES($1,$2,$3,$4,$5)",[learner,school,`O-${learner.slice(0,8)}`,name,sex]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,classId,shift(monday,-30)]);
  }
  for(let i=0;i<4;i++)await post('/attendance/school-days',{day:shift(monday,i),isOpen:true,reason:'Synthetic overview open day'});
  // Busy: the first child is away Monday to Wednesday and in on Thursday, the second is always in; Quiet: its one child came in on Monday only.
  for(let i=0;i<3;i++)await submit(busy,shift(monday,i),[{learnerId:learners[0],mark:'absent'},{learnerId:learners[1],mark:'present'}]);
  await submit(busy,thursday,[{learnerId:learners[0],mark:'present'},{learnerId:learners[1],mark:'present'}]);
  await submit(quiet,monday,[{learnerId:learners[2],mark:'present'}]);
  // Money: Busy was billed 1000.00 and has 50.00 in this week (a 9.99 receipt was reversed); Quiet was billed 500.00 and paid it in full before this week.
  const invoice=randomUUID(),other=randomUUID();
  await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amount_pesewas":100000}]',100000,$6),($7,$2,$8,$4,$9,'[{"name":"Tuition","amount_pesewas":50000}]',50000,$6)`,[invoice,school,learners[0],term,busy,headMembership,other,learners[2],quiet]);
  await pay(invoice,5000,shift(monday,1));await pay(invoice,999,shift(monday,1),true);await pay(other,50000,shift(monday,-5));
  // Scores: Mathematics started in Busy; the first child averages 35 and one exam score is missing.
  await owner.query("INSERT INTO subjects(id,school_id,name) VALUES($1,$2,'Mathematics')",[subject,school]);
  for(const [learner,kind,score] of [[learners[0],'ca',30],[learners[0],'exam',40],[learners[1],'ca',80]] as const)await owner.query("INSERT INTO assessment_score_entries(id,school_id,term_id,class_id,subject_id,learner_id,kind,score,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[randomUUID(),school,term,busy,subject,learner,kind,score,headMembership]);
  // Admissions: two waiting for Busy, one offer for Quiet.
  for(const [status,classId] of [['application',busy],['review',busy],['offered',quiet]] as const)await owner.query("INSERT INTO admissions(id,school_id,full_name,class_id,start_date,admission_number,status) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),school,`Applicant ${status}`,classId,shift(today,30),`A-${randomUUID().slice(0,8)}`,status]);
});
after(async()=>{await app?.close();await owner.end();});
const overview=async(query='')=>(await call(`/home/overview?day=${thursday}${query}`)).json();

test('the overview is headteacher-only and rejects unknown filters',async()=>{
  assert.equal((await call(`/home/overview?day=${thursday}`,teacher)).status,403);
  assert.equal((await call(`/home/overview?day=${thursday}&level=Sixth`)).status,400);
  assert.equal((await call(`/home/overview?day=${thursday}&period=year`)).status,400);
  assert.equal((await call(`/home/overview?day=${thursday}&termId=${randomUUID()}`)).status,404);
});

test('the whole school this week: roll, attendance with its comparison, fees, scores and admissions',async()=>{
  const view=await overview();
  assert.deepEqual([view.term.name,view.term.current,view.period,view.attendance.from,view.attendance.to],['Term 2',true,'week',monday,thursday]);
  assert.deepEqual(view.classes.map((c:any)=>c.name),['Overview Busy Class','Overview KG Class','Overview Quiet Class']);
  assert.deepEqual([view.students.total,view.students.female,view.students.male],[4,2,1]);
  assert.deepEqual(view.students.byLevel,[{level:'KG',count:1},{level:'Primary',count:2},{level:'JHS',count:1}]);
  // Busy: 5 present and 3 away over the week, plus Quiet's one present on Monday: 6 of 9.
  assert.deepEqual([view.attendance.present,view.attendance.away,view.attendance.marked,view.attendance.rate,view.attendance.previousRate,view.attendance.daysCounted],[6,3,9,66.7,null,4]);
  assert.deepEqual(view.attendance.byClass.map((c:any)=>[c.name,c.rate,c.away]),[['Overview Busy Class',62.5,3],['Overview Quiet Class',100,0],['Overview KG Class',null,0]]);
  assert.deepEqual(view.attendance.daily.map((d:any)=>[d.day,d.rate]),[[monday,66.7],[shift(monday,1),50],[shift(monday,2),50],[thursday,100]]);
  // Thursday: Busy has registered, Quiet has not; the KG class has no register and no teacher, so it is waiting too.
  assert.deepEqual([view.attendance.registers.expected,view.attendance.registers.in,view.attendance.registers.waiting],[3,1,['Overview KG Class','Overview Quiet Class']]);
  assert.deepEqual([view.fees.billedPesewas,view.fees.collectedPesewas,view.fees.outstandingPesewas,view.fees.rate,view.fees.inPeriodPesewas],[150000,55000,95000,36.7,5000]);
  assert.deepEqual(view.fees.byClass.map((c:any)=>[c.name,c.outstandingPesewas]),[['Overview Busy Class',95000],['Overview Quiet Class',0]]);
  assert.equal(view.fees.weeks.length,3);assert.equal(view.fees.weeks[2].collectedPesewas,5000);assert.equal(view.fees.weeks[1].collectedPesewas,50000);
  assert.deepEqual([view.scores.expected,view.scores.entered,view.scores.classes,view.scores.started,view.scores.belowPass,view.scores.scored],[4,3,2,1,1,2]);
  assert.deepEqual(view.scores.byClass.map((c:any)=>[c.name,c.subjects,c.caAverage,c.examAverage,c.belowPass]),[['Overview Busy Class',1,55,40,1],['Overview Quiet Class',0,null,null,0]]);
  assert.deepEqual(view.scores.bySubject.map((s:any)=>[s.name,s.classes,s.expected,s.entered,s.caAverage,s.examAverage]),[['Mathematics',1,4,3,55,40]]);
  assert.deepEqual([view.admissions.application,view.admissions.review,view.admissions.offered,view.admissions.waiting],[1,1,1,2]);
  assert.deepEqual(view.capacity.map((c:any)=>[c.name,c.enrolled,c.capacity]),[['Overview Busy Class',2,30],['Overview KG Class',1,30],['Overview Quiet Class',1,30]]);
});

test('today is compared with the last day that had registers, and a level or class narrows every figure',async()=>{
  const day=await overview('&period=today');
  assert.deepEqual([day.period,day.attendance.rate,day.attendance.marked,day.attendance.previousRate,day.attendance.previousLabel,day.fees.inPeriodPesewas],['today',100,2,50,shift(monday,2),0]);
  const jhs=await overview('&level=JHS');
  assert.deepEqual([jhs.scope.classes,jhs.students.total,jhs.attendance.rate,jhs.fees.billedPesewas,jhs.fees.inPeriodPesewas,jhs.scores.entered,jhs.admissions.offered,jhs.admissions.waiting,jhs.capacity.length],[1,1,100,50000,0,0,1,0,1]);
  const one=await overview(`&classId=${busy}&level=JHS`);
  assert.deepEqual([one.scope.classId,one.scope.level,one.students.total,one.attendance.rate,one.fees.collectedPesewas,one.admissions.waiting,one.admissions.offered],[busy,null,2,62.5,5000,2,0]);
  const whole=await overview('&period=term');
  assert.deepEqual([whole.period,whole.attendance.from,whole.fees.inPeriodPesewas,whole.attendance.previousRate],['term',shift(monday,-14),55000,null]);
});

test('a finished term is shown as a whole, with no registers due',async()=>{
  const old=randomUUID();
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[old,school,year,shift(monday,-150),shift(monday,-60)]);
  const past=await overview(`&termId=${old}&period=today`);
  assert.deepEqual([past.term.name,past.term.current,past.period,past.attendance.rate,past.fees.billedPesewas,past.requestedPeriod,past.students.asOf],['Term 1',false,'term',null,0,'today',shift(monday,-60)]);
  assert.deepEqual(past.terms.map((t:any)=>t.name),['Term 2','Term 1']);
  assert.equal(past.attendance.registers,null);
});

test('a school with no terms gets an empty overview instead of an error',async()=>{
  const bare=randomUUID();
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Bare overview school')",[bare]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),bare,headUser]);
  const r=await fetch(`${base}/schools/${bare}/home/overview`,{headers:{cookie:head.cookie}});assert.equal(r.status,200);
  const view=await r.json();assert.deepEqual([view.term,view.terms,view.classes],[null,[],[]]);
});
