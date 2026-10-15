import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),cls=randomUUID(),cls2=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID(),frontM=randomUUID();
const [headU,teacherU,guardianU,frontU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const bands=[{min:50,grade:'C',remark:'Credit'},{min:0,grade:'D',remark:'Needs support'}];
let app:any,base:string,head:any,teacher:any,guardian:any,front:any,termId:string,maths:string;const ama=randomUUID(),kojo=randomUUID(),yaw=randomUUID();
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,front]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Profile school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$5,$6,'headteacher'),($2,$5,$7,'teacher'),($3,$5,$8,'guardian'),($4,$5,$9,'frontdesk')",[headM,teacherM,guardianM,frontM,school,headU,teacherU,guardianU,frontU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Profile year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'Basic 6','Primary',30)",[cls,cls2,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic profile assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
  for(const [id,name,c] of [[ama,'Ama Profile',cls],[kojo,'Kojo Profile',cls],[yaw,'Yaw Elsewhere',cls2]] as const){
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth) VALUES($1,$2,$3,$4,'2015-03-02')",[id,school,`LP-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,c,shift(-50)]);}
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,true,true,now(),$5,'Synthetic academic access')",[randomUUID(),school,ama,guardianM,headM]);
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  await ok('/assessment/policy','PUT',{caWeight:50,examWeight:50,bands,sourceNote:'Synthetic profile policy'},head,200);
  // Ama's class work: two exercises, a homework and a test; her exam is far above it.
  for(const [kind,day,mark] of [['classwork',-20,8],['classwork',-13,10],['homework',-12,6],['class_test',-6,9]] as const){
    const a=await ok(`/assessment/classes/${cls}/assessments`,'POST',{termId,subjectId:maths,kind,title:`${kind} ${day}`,heldOn:shift(day),maxMark:20},teacher);
    await ok(`/assessment/classes/${cls}/assessments/${a.id}/marks`,'POST',{marks:[{learnerId:ama,mark},{learnerId:kojo,mark:15}]},teacher);}
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:maths,scores:[{learnerId:ama,kind:'exam',score:90}]},teacher);
});
after(async()=>{await app?.close();await owner.end();});

test('the learner page brings the learner together; teachers only for their own class, phones and fees for the head',async()=>{
  const p=(await call(`/learners/${ama}/profile`)).body;
  assert.equal(p.learner.fullName,'Ama Profile');assert.equal(p.learner.dateOfBirth,'2015-03-02');assert.equal(p.currentClass.name,'Basic 5');
  assert.equal(p.term.id,termId);assert.equal(p.enrolments.length,1);
  assert.deepEqual(p.guardians,[{name:'Abena Sample',verified:true,rights:['academic','pickup','contact'],phone:null}]);
  assert.ok(Array.isArray(p.fees));assert.equal(p.attendance.marked,0);
  const m=p.termWork.subjects[0];
  // Exercises 45%, homework 30%, test 45%: CA (45*30+30*30+45*40)/100 = 40.5; total 50/50 with the exam 90 = 65.3.
  assert.equal(m.name,'Mathematics');assert.deepEqual(m.parts.exercises,{average:45,marked:2,set:2});assert.deepEqual(m.parts.homework,{average:30,marked:1,set:1});
  assert.deepEqual([m.ca,m.recordedCa,m.exam,m.total,m.marks],[40.5,null,90,65.3,4]);
  assert.deepEqual(m.gap,{direction:'exam_higher',difference:49.5});assert.equal(m.attention.reason,'below_pass');
  const t=(await call(`/learners/${ama}/profile`,'GET',undefined,teacher)).body;
  assert.equal(t.guardians[0].phone,undefined,'no phone numbers for teachers');assert.equal(t.fees,undefined);assert.equal(t.termWork.subjects[0].ca,40.5);
  assert.equal((await call(`/learners/${yaw}/profile`,'GET',undefined,teacher)).status,404,'not their class');
  assert.equal((await call(`/learners/${ama}/profile`,'GET',undefined,guardian)).status,403);
  assert.equal((await call(`/learners/${ama}/profile`,'GET',undefined,front)).status,403);
  assert.equal((await call(`/learners/${ama}/profile?termId=${randomUUID()}`)).status,404);
});

let teacherNote:string,headNote:string,familyNote:string;
test('staff and verified guardians add notes; families see only what the school shares and their own',async()=>{
  teacherNote=(await ok(`/learners/${ama}/notes`,'POST',{category:'classwork',body:'Exam far above class work in Maths; check she understands the working.'},teacher)).id;
  headNote=(await ok(`/learners/${ama}/notes`,'POST',{category:'home',body:'Please read with Ama for 15 minutes each evening.',sharedWithFamily:true})).id;
  const f=await ok(`/guardian/children/${ama}/notes`,'POST',{category:'health',body:'Ama has had malaria this week and missed homework.',sharedWithFamily:false},guardian);
  familyNote=f.id;assert.equal(f.sharedWithFamily,true,'a family note always reaches the school');
  assert.equal((await call(`/learners/${yaw}/notes`,'POST',{operationId:randomUUID(),category:'general',body:'Not my class'},teacher)).status,404);
  assert.equal((await call(`/guardian/children/${kojo}/notes`,'POST',{operationId:randomUUID(),category:'general',body:'Not my child'},guardian)).status,404);
  assert.equal((await call(`/guardian/children/${kojo}/notes`,'GET',undefined,guardian)).status,404);
  assert.equal((await call(`/learners/${ama}/notes`,'POST',{operationId:randomUUID(),category:'gossip',body:'Bad category'},teacher)).status,400);
  assert.equal((await call(`/learners/${ama}/notes`,'POST',{operationId:randomUUID(),category:'general',body:'Wrong door'},guardian)).status,403);
  const staffView=(await call(`/learners/${ama}/profile`,'GET',undefined,teacher)).body.notes;
  assert.deepEqual(staffView.map((n:any)=>[n.authorName,n.authorRole,n.sharedWithFamily]).sort(),[['Abena Sample','guardian',true],['Ama Sample','headteacher',true],['Kofi Sample','teacher',false]]);
  const familyView=(await call(`/guardian/children/${ama}/notes`,'GET',undefined,guardian)).body.items;
  assert.deepEqual(familyView.map((n:any)=>n.id).sort(),[headNote,familyNote].sort(),'the teacher\'s staff note stays with staff');
  assert.equal(familyView.find((n:any)=>n.id===familyNote).mine,true);
});

test('only the author or the headteacher withdraws a note, with a reason, and it stays in the history',async()=>{
  const route=(id:string)=>`/learner-notes/${id}/withdraw`;
  assert.equal((await call(route(headNote),'POST',{operationId:randomUUID(),reason:'Not mine to remove'},teacher)).status,403);
  assert.equal((await call(route(teacherNote),'POST',{operationId:randomUUID(),reason:'Not mine to remove'},guardian)).status,403);
  assert.equal((await call(route(familyNote),'POST',{operationId:randomUUID(),reason:'x'},guardian)).status,400);
  await ok(route(familyNote),'POST',{reason:'Posted on the wrong child by mistake'},guardian);
  await ok(route(teacherNote),'POST',{reason:'Discussed with the teacher; settled'});
  assert.equal((await call(route(teacherNote),'POST',{operationId:randomUUID(),reason:'Again'})).status,409);
  const notes=(await call(`/learners/${ama}/profile`)).body.notes;
  assert.equal(notes.length,3,'withdrawn notes are kept');
  assert.deepEqual(notes.find((n:any)=>n.id===teacherNote).withdrawn.reason,'Discussed with the teacher; settled');
  assert.equal(notes.find((n:any)=>n.id===headNote).canWithdraw,true);assert.equal(notes.find((n:any)=>n.id===teacherNote).canWithdraw,false);
  await assert.rejects(owner.query('UPDATE learner_notes SET body=$1 WHERE id=$2',['changed',headNote]),/append-only/);
  await assert.rejects(owner.query('DELETE FROM learner_note_withdrawals WHERE note_id=$1',[teacherNote]),/append-only/);
  await assert.rejects(owner.query("INSERT INTO learner_notes(id,school_id,learner_id,author_membership_id,author_role,author_name,category,body,shared_with_family) VALUES($1,$2,$3,$4,'guardian','X','general','Private family note',false)",[randomUUID(),school,ama,guardianM]),/check/);
});
