import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {attentionFor,mondayOf,mean}=require('../dist/modules/assessment/progress.service');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),cls=randomUUID(),cls2=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID();
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const bands=[{min:80,grade:'A',remark:'Excellent'},{min:50,grade:'C',remark:'Credit'},{min:0,grade:'D',remark:'Needs support'}];
let app:any,base:string,head:any,teacher:any,guardian:any,termId:string,maths:string;const kids:string[]=[];let elsewhere:string;const tests:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Progress school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$4,$5,'headteacher'),($2,$4,$6,'teacher'),($3,$4,$7,'guardian')",[headM,teacherM,guardianM,school,headU,teacherU,guardianU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Progress year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Primary 5','Primary',30),($2,$3,$4,'Primary 6','Primary',30)",[cls,cls2,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic progress assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
  for(const [name,c] of [['Ama Steady',cls],['Kojo Falling',cls],['Esi Struggling',cls],['Yaw Elsewhere',cls2]] as const){const id=randomUUID();if(c===cls)kids.push(id);else elsewhere=id;
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`PG-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,c,shift(-50)]);}
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  await ok('/assessment/policy','PUT',{caWeight:30,examWeight:70,bands,sourceNote:'Synthetic progress policy'},head,200);
});
after(async()=>{await app?.close();await owner.end();});

test('attention flags learners whose recent marks drop or sit below the pass line',()=>{
  assert.equal(attentionFor([90,85]),null,'too few marks');
  assert.equal(attentionFor([90,85,88,80,82]),null);
  assert.deepEqual(attentionFor([80,78,60,55,50]),{reason:'dropping',recent:55,earlier:79});
  assert.deepEqual(attentionFor([45,40,48]),{reason:'below_pass',recent:44.3,earlier:null});
  assert.equal(mondayOf('2026-10-14'),'2026-10-12');assert.equal(mondayOf('2026-10-12'),'2026-10-12');assert.equal(mondayOf('2026-10-18'),'2026-10-12');
  assert.equal(mean([]),null);assert.equal(mean([1,2]),1.5);
});

test('teachers create dated assessments only for their classes and inside the term',async()=>{
  const body={termId,subjectId:maths,kind:'classwork',title:'Fractions exercise',heldOn:shift(-28),maxMark:20};
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body},guardian)).status,403);
  assert.equal((await call(`/assessment/classes/${cls2}/assessments`,'POST',{operationId:randomUUID(),...body},teacher)).status,404);
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body,heldOn:shift(-56)},teacher)).status,400);
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body,kind:'exam'},teacher)).status,400);
  const op=randomUUID(),first=await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:op,...body},teacher);assert.equal(first.status,201);
  assert.deepEqual((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:op,...body},teacher)).body,first.body,'retry returns the same assessment');
  tests.push(first.body.id);
  for(const [i,kind] of (['homework','quiz','class_test','project'] as const).entries())tests.push((await ok(`/assessment/classes/${cls}/assessments`,'POST',{...body,kind,title:`Week ${i+2} ${kind}`,heldOn:shift(-21+7*i)},teacher)).id);
});

test('marks stay within the maximum, only for learners in the class, and keep their history',async()=>{
  const marks=[[18,17,17.6,16,16.4],[16,15.6,12,11,10],[null,null,9,8,9.6]];
  const route=(id:string)=>`/assessment/classes/${cls}/assessments/${id}/marks`;
  assert.equal((await call(route(tests[0]),'POST',{operationId:randomUUID(),marks:[{learnerId:kids[0],mark:21}]},teacher)).status,400);
  assert.equal((await call(route(tests[0]),'POST',{operationId:randomUUID(),marks:[{learnerId:elsewhere,mark:10}]},teacher)).status,404);
  await assert.rejects(owner.query('INSERT INTO class_assessment_marks(id,school_id,assessment_id,learner_id,mark,recorded_by) VALUES($1,$2,$3,$4,25,$5)',[randomUUID(),school,tests[0],kids[0],teacherM]),/maximum/);
  for(const [i,id] of tests.entries())await ok(route(id),'POST',{marks:kids.flatMap((learnerId,k)=>marks[k][i]===null?[]:[{learnerId,mark:marks[k][i]}])},teacher);
  assert.deepEqual(await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:18}]},teacher),{written:0,unchanged:1});
  await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:19}]},teacher);await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:18}]},teacher);
  assert.equal((await owner.query('SELECT count(*) FROM class_assessment_marks WHERE assessment_id=$1 AND learner_id=$2',[tests[0],kids[0]])).rows[0].count,'3','history retained');
  await assert.rejects(owner.query('UPDATE class_assessment_marks SET mark=1 WHERE assessment_id=$1',[tests[0]]),/append-only/);
  const roster=(await call(route(tests[0]),'GET',undefined,teacher)).body;
  assert.deepEqual(roster.items.map((r:any)=>[r.fullName,r.mark]),[['Ama Steady',18],['Esi Struggling',null],['Kojo Falling',16]]);
  const list=(await call(`/assessment/classes/${cls}/assessments?termId=${termId}`,'GET',undefined,teacher)).body.items;
  assert.equal(list.length,5);assert.equal(list[4].id,tests[0]);assert.equal(list[4].marked,2);assert.equal(list[4].average,85);
});

test('the CA suggestion averages each learner\'s assessments; the teacher still saves the CA',async()=>{
  const r=(await call(`/assessment/classes/${cls}/ca-suggestion?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body.items;
  const by=(id:string)=>r.find((x:any)=>x.learnerId===id);
  assert.deepEqual([by(kids[0]).ca,by(kids[1]).ca,by(kids[2]).ca],[85,64.6,44.3]);assert.equal(by(kids[2]).assessments,3);
  assert.equal((await owner.query('SELECT count(*) FROM assessment_score_entries WHERE school_id=$1',[school])).rows[0].count,'0','nothing written');
});

test('class progress groups the term by week or month and lists learners needing attention',async()=>{
  assert.equal((await call(`/assessment/classes/${cls2}/progress?termId=${termId}`,'GET',undefined,teacher)).status,404);
  const week=(await call(`/assessment/classes/${cls}/progress?termId=${termId}&period=week`,'GET',undefined,teacher)).body;
  assert.equal(week.buckets.length,5);assert.equal(week.subjects[0].name,'Mathematics');
  assert.deepEqual(week.subjects[0].points.map((p:any)=>p.average),[85,81.5,64.3,58.3,60]);
  assert.deepEqual(week.attention.map((a:any)=>[a.fullName,a.reason]).sort(),[['Esi Struggling','below_pass'],['Kojo Falling','dropping']]);
  const month=(await call(`/assessment/classes/${cls}/progress?termId=${termId}&period=month`,'GET',undefined,head)).body;
  assert.ok(month.buckets.length>=1&&month.buckets.length<=3);assert.ok(month.buckets.every((b:string)=>b.endsWith('-01')));
  assert.equal(month.subjects[0].points.reduce((n:number,p:any)=>n+p.marks,0),13);
});

test('learner progress shows weeks, months and term results; teachers only for their own learners',async()=>{
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:85},{learnerId:kids[0],kind:'exam',score:90}]},teacher);
  assert.equal((await call(`/assessment/learners/${elsewhere}/progress`,'GET',undefined,teacher)).status,404);
  assert.equal((await call(`/assessment/learners/${kids[0]}/progress`,'GET',undefined,guardian)).status,403);
  assert.equal((await call(`/assessment/learners/${elsewhere}/progress`,'GET',undefined,head)).status,200);
  const week=(await call(`/assessment/learners/${kids[0]}/progress?period=week`,'GET',undefined,teacher)).body;
  assert.deepEqual(week.subjects[0].points.map((p:any)=>p.assessmentAverage),[90,85,88,80,82]);assert.ok(week.subjects[0].points.every((p:any)=>p.termResult===null));
  const term=(await call(`/assessment/learners/${kids[0]}/progress?period=term`,'GET',undefined,teacher)).body;
  assert.equal(term.buckets.length,1);assert.equal(term.buckets[0].label,'Term 1 Progress year');
  assert.deepEqual(term.subjects[0].points[0],{key:termId,assessmentAverage:85,marks:5,termResult:88.5});
  const yearView=(await call(`/assessment/learners/${kids[0]}/progress?period=year`,'GET',undefined,head)).body;
  assert.deepEqual(yearView.buckets.map((b:any)=>b.label),['Progress year']);assert.equal(yearView.subjects[0].points[0].termResult,88.5);
  assert.equal((await call(`/assessment/learners/${kids[0]}/progress?period=decade`,'GET',undefined,head)).status,400);
});
