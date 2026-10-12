import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {weightedTotal,gradeFor}=require('../dist/modules/assessment/assessment.service');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),cls=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID();
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const bands=[{min:80,grade:'A',remark:'Excellent'},{min:65,grade:'B',remark:'Good'},{min:50,grade:'C',remark:'Credit'},{min:0,grade:'D',remark:'Needs support'}];
let app:any,base:string,head:any,teacher:any,guardian:any,termId:string,maths:string,science:string;const kids:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,target=school){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Assessment school'),($2,'Other assessment school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$4,$5,'headteacher'),($2,$4,$6,'teacher'),($3,$4,$7,'guardian')",[headM,teacherM,guardianM,school,headU,teacherU,guardianU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Assessment year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Primary 4 Blue','Primary',30)",[cls,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic assessment assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
  for(const name of ['Ama Top','Kojo Middle','Esi Incomplete']){const id=randomUUID();kids.push(id);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`AS-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-50)]);}
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,false,false,now(),$5,'Synthetic academic access')",[randomUUID(),school,kids[0],guardianM,headM]);
});
after(async()=>{await app?.close();await owner.end();});

test('weighted totals round half-up on integers and grades follow the school bands',()=>{
  assert.equal(weightedTotal(27.5,60,{ca_weight:30,exam_weight:70}),50.3);assert.equal(weightedTotal(0.05,0.05,{ca_weight:50,exam_weight:50}),0.1);assert.equal(weightedTotal(100,100,{ca_weight:40,exam_weight:60}),100);
  assert.equal(gradeFor(80,bands).grade,'A');assert.equal(gradeFor(79.9,bands).grade,'B');assert.equal(gradeFor(0,bands).grade,'D');
});

test('head configures subjects, terms and policy; scoring waits for the policy',async()=>{
  for(const actor of [teacher,guardian]){await call('/assessment/subjects','POST',{operationId:randomUUID(),name:'Nope'},actor);}
  assert.equal((await call('/assessment/subjects','POST',{operationId:randomUUID(),name:'Nope Subject'},teacher)).status,403);
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;science=(await ok('/assessment/subjects','POST',{name:'Integrated Science'})).id;
  assert.equal((await call('/assessment/subjects','POST',{operationId:randomUUID(),name:'Mathematics'})).status,409);
  assert.equal((await call('/assessment/terms','POST',{operationId:randomUUID(),academicYearId:year,name:'Bad term',startDate:shift(-100),endDate:shift(-10)})).status,400);
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  const scoreBody={operationId:randomUUID(),termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:40}]};
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',scoreBody,teacher)).status,409);
  assert.equal((await call('/assessment/policy','PUT',{operationId:randomUUID(),caWeight:30,examWeight:60,bands,sourceNote:'Bad total'})).status,400);
  assert.equal((await call('/assessment/policy','PUT',{operationId:randomUUID(),caWeight:30,examWeight:70,bands:bands.slice(0,3),sourceNote:'Missing zero band'})).status,400);
  assert.equal((await call('/assessment/policy','PUT',{operationId:randomUUID(),caWeight:30,examWeight:70,bands,sourceNote:'School policy memo'},teacher)).status,403);
  const policy=await ok('/assessment/policy','PUT',{caWeight:30,examWeight:70,bands,sourceNote:'School assessment policy memo, Term 1'},head,200);assert.equal(policy.version,1);
  assert.equal((await call('/assessment/policy','PUT',{operationId:randomUUID(),caWeight:40,examWeight:60,bands,sourceNote:'Stale write'})).status,409);
});

test('teachers record scores for assigned classes only; entries are append-only and idempotent',async()=>{
  const op=randomUUID(),body={operationId:op,termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:90},{learnerId:kids[0],kind:'exam',score:85},{learnerId:kids[1],kind:'ca',score:60},{learnerId:kids[1],kind:'exam',score:55}]};
  const first=await call(`/assessment/classes/${cls}/scores`,'POST',body,teacher);assert.equal(first.status,201);assert.equal(first.body.written,4);
  assert.deepEqual((await call(`/assessment/classes/${cls}/scores`,'POST',body,teacher)).body,first.body);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{...body,operationId:randomUUID(),scores:[{learnerId:kids[0],kind:'ca',score:101}]},teacher)).status,400);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{...body,operationId:randomUUID(),scores:[{learnerId:randomUUID(),kind:'ca',score:50}]},teacher)).status,404);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{...body,operationId:randomUUID()},guardian)).status,403);
  const unchanged=await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:90}]},teacher);assert.deepEqual(unchanged,{written:0,unchanged:1});
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:maths,scores:[{learnerId:kids[1],kind:'exam',score:58}]},teacher);
  assert.equal((await owner.query("SELECT count(*) FROM assessment_score_entries WHERE learner_id=$1 AND kind='exam'",[kids[1]])).rows[0].count,'2','history retained');
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:science,scores:[{learnerId:kids[0],kind:'ca',score:70},{learnerId:kids[0],kind:'exam',score:75},{learnerId:kids[1],kind:'ca',score:50},{learnerId:kids[1],kind:'exam',score:52},{learnerId:kids[2],kind:'ca',score:80}]},head);
  await owner.query('UPDATE teaching_assignments SET revoked_at=now(),revoked_by=$2,revocation_reason=$3 WHERE class_id=$1',[cls,headM,'Synthetic revocation']).catch(()=>{});
});

test('results are computed deterministically with grades, positions and incomplete learners flagged',async()=>{
  assert.equal((await call(`/assessment/classes/${cls}/results?termId=${termId}`,'GET',undefined,teacher)).status,403);
  const results=(await call(`/assessment/classes/${cls}/results?termId=${termId}`)).body;
  const byName=(name:string)=>results.items.find((row:any)=>row.fullName===name);
  const ama=byName('Ama Top'),kojo=byName('Kojo Middle'),esi=byName('Esi Incomplete');
  assert.equal(ama.subjects.find((s:any)=>s.name==='Mathematics').total,86.5);assert.equal(ama.subjects.find((s:any)=>s.name==='Mathematics').grade,'A');
  assert.equal(kojo.subjects.find((s:any)=>s.name==='Mathematics').total,58.6);assert.equal(kojo.subjects.find((s:any)=>s.name==='Mathematics').grade,'C');
  assert.deepEqual([ama.position,kojo.position,esi.position],[1,2,null]);assert.equal(esi.complete,false);assert.equal(results.classSize,3);
  assert.equal(ama.average,(86.5+73.5)/2);
});

test('publishing needs acknowledgement for incomplete learners, locks scores and shows only to verified guardians',async()=>{
  assert.equal((await call(`/assessment/classes/${cls}/publish`,'POST',{operationId:randomUUID(),termId},teacher)).status,403);
  assert.equal((await call(`/assessment/classes/${cls}/publish`,'POST',{operationId:randomUUID(),termId})).status,409);
  const published=await ok(`/assessment/classes/${cls}/publish`,'POST',{termId,acknowledgeIncomplete:true});assert.deepEqual(published,{published:3,alreadyPublished:0,incomplete:1});
  const locked=await call(`/assessment/classes/${cls}/scores`,'POST',{operationId:randomUUID(),termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:10}]});assert.equal(locked.status,409);
  await assert.rejects(owner.query("UPDATE terminal_reports SET snapshot='{}' WHERE learner_id=$1",[kids[0]]),/append-only/);await assert.rejects(owner.query('DELETE FROM assessment_score_entries WHERE learner_id=$1',[kids[0]]),/append-only/);
  const mine=await call(`/guardian/children/${kids[0]}/terminal-reports`,'GET',undefined,guardian);assert.equal(mine.status,200);assert.equal(mine.body.items.length,1);
  assert.equal(mine.body.items[0].snapshot.position,1);assert.equal(mine.body.items[0].snapshot.subjects.length,2);
  assert.equal((await call(`/guardian/children/${kids[1]}/terminal-reports`,'GET',undefined,guardian)).status,404);
  assert.equal((await call(`/guardian/children/${kids[0]}/terminal-reports`,'GET',undefined,head)).status,403);
  assert.equal((await call(`/assessment/subjects`,'GET',undefined,head,other)).status,404);
});

test('published reports are corrected only by a reasoned reopening and a new revision; guardians see the latest',async()=>{
  const op=()=>randomUUID(),reopenBody={operationId:op(),termId,learnerId:kids[0],reason:'Exam score was keyed in wrongly'};
  assert.equal((await call(`/assessment/classes/${cls}/reopen`,'POST',reopenBody,teacher)).status,403);
  assert.equal((await call(`/assessment/classes/${cls}/reopen`,'POST',{...reopenBody,operationId:op(),reason:'x'})).status,400);
  assert.equal((await call(`/assessment/classes/${cls}/reissue`,'POST',{operationId:op(),termId,learnerId:kids[0]})).status,409);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{operationId:op(),termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'exam',score:95}]})).status,409);
  assert.equal((await call(`/assessment/classes/${cls}/reopen`,'POST',reopenBody)).status,201);
  assert.equal((await call(`/assessment/classes/${cls}/reopen`,'POST',{...reopenBody,operationId:op()})).status,409);
  const grid=(await call(`/assessment/classes/${cls}/grid?termId=${termId}`)).body.items;assert.equal(grid.find((row:any)=>row.learnerId===kids[0]).locked,false);assert.equal(grid.find((row:any)=>row.learnerId===kids[1]).locked,true);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{operationId:op(),termId,subjectId:maths,scores:[{learnerId:kids[1],kind:'exam',score:10}]})).status,409);
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{operationId:op(),termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'exam',score:95}]})).status,201);
  const before=(await call(`/guardian/children/${kids[0]}/terminal-reports`,'GET',undefined,guardian)).body.items;assert.equal(before[0].revision,1);
  const issued=await call(`/assessment/classes/${cls}/reissue`,'POST',{operationId:op(),termId,learnerId:kids[0]});assert.equal(issued.status,201,JSON.stringify(issued.body));assert.equal(issued.body.revision,2);
  const after=(await call(`/guardian/children/${kids[0]}/terminal-reports`,'GET',undefined,guardian)).body.items;assert.equal(after.length,1);assert.equal(after[0].revision,2);assert.equal(after[0].correction_reason,'Exam score was keyed in wrongly');
  assert.equal(after[0].snapshot.subjects.find((s:any)=>s.name==='Mathematics').exam,95);
  assert.equal((await owner.query('SELECT count(*) FROM terminal_reports WHERE learner_id=$1',[kids[0]])).rows[0].count,'2');
  assert.equal((await call(`/assessment/classes/${cls}/scores`,'POST',{operationId:op(),termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'exam',score:50}]})).status,409);
  assert.equal((await call(`/assessment/classes/${cls}/reissue`,'POST',{operationId:op(),termId,learnerId:kids[0]})).status,409);
  const actions=(await call('/audit?limit=100')).body.items.map((row:any)=>row.action);for(const a of ['assessment.report.reopened','assessment.report.reissued'])assert.ok(actions.includes(a),a);
});

test('report cards for the whole school or one level: latest revision of each, class by class, headteacher only',async()=>{
  const jhs=randomUUID(),learner=randomUUID();
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'JHS 1 Gold','JHS',30)",[jhs,school,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'AS-JHS1','Yaw Junior')",[learner,school]);
  await owner.query(`INSERT INTO terminal_reports(id,school_id,term_id,class_id,learner_id,snapshot,published_by) VALUES($1,$2,$3,$4,$5,'{"learner":{"fullName":"Yaw Junior"}}',$6)`,[randomUUID(),school,termId,jhs,learner,headM]);
  assert.equal((await call(`/assessment/reports?termId=${termId}`,'GET',undefined,teacher)).status,403);
  assert.equal((await call(`/assessment/reports?termId=${termId}&level=SHS`)).status,400);
  const perClass=(await call(`/assessment/classes/${cls}/reports?termId=${termId}`)).body.items;
  const all=(await call(`/assessment/reports?termId=${termId}`)).body.items;
  assert.deepEqual(all.map((r:any)=>[r.class_name,r.id]),[['JHS 1 Gold',all[0].id],...perClass.map((r:any)=>['Primary 4 Blue',r.id])]);
  assert.equal(new Set(all.map((r:any)=>r.learner_id)).size,all.length);
  assert.deepEqual((await call(`/assessment/reports?termId=${termId}&level=JHS`)).body.items.map((r:any)=>r.snapshot.learner.fullName),['Yaw Junior']);
  assert.equal((await call(`/assessment/reports?termId=${randomUUID()}`)).status,404);
});
