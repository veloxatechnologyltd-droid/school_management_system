import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),cls=randomUUID(),pastCls=randomUUID();
const [headM,teacherM,guardianM,deskM,acctM,otherTeacherM]=Array.from({length:6},()=>randomUUID());
const [headU,teacherU,guardianU,deskU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const acctU=randomUUID();
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,desk:any;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,actor=head,id=school){const r=await fetch(`${base}/schools/${id}${route}`,{headers:{cookie:actor.cookie}});return {status:r.status,body:await r.json().catch(()=>null)};}
// Audit rows are written straight in, the way the API would have, so the page's wording and counts can be checked exactly.
const audit=(actor:string,action:string,target:string,metadata:Record<string,unknown>={},ago='0 minutes')=>owner.query("INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,now()-$7::interval)",[randomUUID(),school,actor,action,target,JSON.stringify(metadata),ago]);

before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,desk]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Staff page school'),($2,'Other staff school')",[school,other]);
  await owner.query("INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,'Joyce Accounts',$2,'x')",[acctU,`acct-${acctU}@example.test`]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$6,$7,'headteacher'),($2,$6,$8,'teacher'),($3,$6,$9,'guardian'),($4,$6,$10,'frontdesk'),($5,$6,$11,'accountant')",[headM,teacherM,guardianM,deskM,acctM,school,headU,teacherU,guardianU,deskU,acctU]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher'),($4,$2,$5,'teacher')",[randomUUID(),other,headU,otherTeacherM,teacherU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Staff year',$3,$4)",[year,school,shift(-60),shift(200)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 3','Primary',30),($2,$3,$4,'Basic 2','Primary',30)",[cls,pastCls,school,year]);
  // The teacher teaches Basic 3 now (two students); Basic 2 was a short stretch that has finished.
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Class teacher for Basic 3',$7),($8,$2,$9,$4,'Kofi Sample',$10,$11,'Cover for Basic 2',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(150),headM,randomUUID(),pastCls,shift(-50),shift(-40)]);
  for(const name of ['Esi Page','Kojo Page']){const id=randomUUID();
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`SP-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-20)]);}
});
after(async()=>{await app?.close();await owner.end();});

test('only the headteacher opens a staff page, and only inside their own school',async()=>{
  for(const actor of [teacher,guardian,desk]){
    assert.equal((await call(`/accounts/${teacherM}`,actor)).status,403);assert.equal((await call(`/accounts/${teacherM}/activity`,actor)).status,403);}
  assert.equal((await call(`/accounts/${randomUUID()}`)).status,404);
  assert.equal((await call(`/accounts/${guardianM}`)).status,404,'a parent is not a staff member');
  assert.equal((await call(`/accounts/${otherTeacherM}`)).status,404,'a teacher of another school is not found through this one');
  assert.equal((await call(`/accounts/${otherTeacherM}/activity`)).status,404);
  assert.equal((await call(`/accounts/not-an-id`)).status,400);
});

test('a teacher page shows classes with their students and status, in words the head can read',async()=>{
  const open=await audit(teacherM,'attendance.register.submit',randomUUID(),{day:shift(-1),classId:cls},'2 hours');
  for(let i=0;i<3;i++)await audit(teacherM,'learner.note.added',randomUUID(),{category:'home'},`${i+1} days`);
  await audit(teacherM,'attendance.register.save',randomUUID(),{day:shift(-1),classId:cls},'3 hours');
  await audit(teacherM,'assessment.class_assessment.marked',randomUUID(),{classId:cls,written:2},'1 hour');
  await audit(teacherM,'learner.note.added',randomUUID(),{},'45 days');
  void open;
  const p=(await call(`/accounts/${teacherM}`)).body;
  assert.deepEqual([p.member.name,p.member.login,p.member.role,p.member.membershipId],['Kofi Sample','teacher@example.test','teacher',teacherM]);
  assert.equal(p.member.userId,teacherU);
  assert.deepEqual(p.classes.map((c:any)=>[c.className,c.status,c.students]),[['Basic 3','current',2],['Basic 2','finished',0]]);
  assert.equal(p.classes[0].reason,'Class teacher for Basic 3');
  assert.deepEqual([p.summary.classes,p.summary.students,p.summary.moneyPesewas],[1,2,null]);
  // Last 30 days only: the 45-day-old note is not counted.
  assert.deepEqual(p.summary.highlights,[{label:'Registers submitted',value:1},{label:'Class work set',value:0},{label:'Class work marked',value:1},{label:'Notes written',value:3}]);
  // The feed names the class and day, counts a mark total, and leaves out a saved draft of a register.
  const texts=p.activity.items.map((i:any)=>i.text);
  assert.ok(texts.includes(`Submitted the register for Basic 3 on ${new Date(`${shift(-1)}T00:00:00Z`).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})}`),texts.join(' | '));
  assert.ok(texts.includes('Marked class work for Basic 3 (2 marks)'));assert.ok(!texts.some((t:string)=>/draft|save/i.test(t)));
  assert.equal(p.activity.total,6,'register submit, marked, and four notes; the save is left out');
  assert.equal(texts[0],'Marked class work for Basic 3 (2 marks)','newest first');
});

test('the activity list pages 25 at a time and a sign-in keeps its own history with who did it',async()=>{
  for(let i=0;i<30;i++)await audit(deskM,'admission.created',randomUUID(),{},`${i+1} minutes`);
  const first=(await call(`/accounts/${deskM}/activity`)).body,second=(await call(`/accounts/${deskM}/activity?offset=25`)).body;
  assert.deepEqual([first.items.length,first.total,first.limit,second.items.length,second.offset],[25,30,25,5,25]);
  assert.ok(new Set([...first.items,...second.items].map((i:any)=>i.id)).size===30,'no overlap between pages');
  assert.ok(first.items.every((i:any)=>i.text==='Recorded a new application'));
  assert.equal((await call(`/accounts/${deskM}/activity?offset=-5`)).body.offset,0,'a negative offset starts at the top');

  await audit(headM,'account.created',teacherU,{role:'teacher'},'40 days');await audit(headM,'account.password_reset',teacherU,{},'2 days');await audit(headM,'account.phone_set',teacherU,{cleared:false},'1 day');
  const account=(await call(`/accounts/${teacherM}`)).body.account;
  assert.deepEqual(account.map((a:any)=>[a.text,a.by]),[['Phone number changed','Ama Sample'],['Temporary password reset','Ama Sample'],['Sign-in created','Ama Sample']]);
  // What the head did to other people is on the head's own page as activity, not on the person's account history.
  const headActs=(await call(`/accounts/${headM}`)).body;assert.ok(headActs.activity.items.some((i:any)=>i.text==='Reset a password'));
});

test('each role gets tiles for what it does; an accountant also sees the money recorded',async()=>{
  const invoice=randomUUID(),learner=(await owner.query('SELECT id FROM learners WHERE school_id=$1 LIMIT 1',[school])).rows[0].id;
  const term=randomUUID();
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[term,school,year,shift(-30),shift(60)]);
  await owner.query("INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[]',90000,$6)",[invoice,school,learner,term,cls,acctM]);
  for(const [amount,n] of [[12000,1],[8050,2]])await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,$4,'cash',$5,$6,$7)",[randomUUID(),school,invoice,amount,today,n,acctM]);
  await audit(acctM,'finance.payment.recorded',randomUUID(),{receiptNumber:2,amountPesewas:8050});
  const a=(await call(`/accounts/${acctM}`)).body;
  assert.equal(a.member.role,'accountant');assert.equal(a.summary.moneyPesewas,20050);assert.equal(a.classes.length,0);
  assert.deepEqual(a.summary.highlights.map((h:any)=>h.label),['Payments recorded','Payments reversed','Bills created','Fee items added']);
  assert.equal(a.activity.items[0].text,'Recorded a payment (receipt 2)');
  assert.deepEqual((await call(`/accounts/${deskM}`)).body.summary.highlights.map((h:any)=>h.label),['Applications recorded','Decisions taken','Pick-ups released','Parents linked']);
  assert.deepEqual((await call(`/accounts/${headM}`)).body.summary.highlights.map((h:any)=>h.label),['Registers locked','Report cards published','Application decisions','Accounts managed']);
});
