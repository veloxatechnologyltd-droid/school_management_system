import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
const runtime=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:'school_app'});
const school=randomUUID(),other=randomUUID(),members=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const users=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
let app:any,base:string,account:{cookie:string;csrf:string},year:any,section:any,destination:any;
async function login(email='head@example.test') {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(response.status,201);
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
async function call(url:string,method='GET',body?:unknown,actor=account) {return fetch(`${base}/schools/${school}${url}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(url:string,body:Record<string,unknown>,expected=201,actor=account){const response=await call(url,'POST',{operationId:randomUUID(),...body},actor);const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
async function apply(classId=section.id,name='Synthetic learner',startDate='2026-09-01'){return post('/admissions',{fullName:name,classId,startDate,admissionNumber:`S-${randomUUID().slice(0,12)}`});}
async function accepted(classId=section.id,startDate='2026-09-01'){let application=await apply(classId,'Synthetic learner',startDate);for(const action of ['review','offer','accept'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});return application;}
async function enrolled(classId=section.id){const application=await accepted(classId);return post(`/admissions/${application.id}/transition`,{version:application.version,action:'enrol'});}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;account=await login();
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Admissions test school',other,'Separate test school']);
  for(let i=0;i<4;i++)await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[members[i],school,users[i],['headteacher','teacher','guardian','frontdesk'][i]]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),other,users[0]]);
  year=await post('/academic-years',{name:'2026/2027',startDate:'2026-09-01',endDate:'2027-08-01'});
  section=await post('/classes',{name:'Primary 1 Blue',level:'Primary',capacity:50,academicYearId:year.id});
  destination=await post('/classes',{name:'Primary 1 Green',level:'Primary',capacity:50,academicYearId:year.id});
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('admissions schema forces RLS and no-context reads deny',async()=>{
  const tables=(await runtime.query("SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('command_receipts','academic_years','class_sections','learners','admissions','enrolments')")).rows;assert.equal(tables.length,6);assert.ok(tables.every(row=>row.relforcerowsecurity));
  for(const name of ['academic_years','class_sections','learners','admissions','enrolments'])assert.equal((await runtime.query(`SELECT * FROM ${name}`)).rowCount,0);
});
test('calendar creation is retry safe and operation IDs bind exact payload',async()=>{
  const body={operationId:randomUUID(),name:'2027/2028',startDate:'2027-08-01',endDate:'2028-08-01'};
  const a=await post('/academic-years',body),b=await post('/academic-years',body);assert.equal(a.id,b.id);
  await post('/academic-years',{...body,name:'Changed request'},409);
  await post('/academic-years',{name:'Invalid bounds',startDate:'2027-08-01',endDate:'2027-08-01'},400);
  await post('/academic-years',{name:'Invalid date',startDate:'2027-02-30',endDate:'2027-08-01'},400);
});
test('classes and applications reject invalid and cross-school references',async()=>{
  await post('/classes',{name:'Unknown year',level:'Primary',capacity:1,academicYearId:randomUUID()},404);
  await post('/classes',{name:'Invalid level',level:'SHS',capacity:1,academicYearId:year.id},400);
  const response=await fetch(`${base}/schools/${other}/admissions`,{method:'POST',headers:{cookie:account.cookie,'content-type':'application/json','x-csrf-token':account.csrf},body:JSON.stringify({operationId:randomUUID(),fullName:'Cross school learner',classId:section.id,startDate:'2026-09-01',admissionNumber:'CROSS-1'})});assert.equal(response.status,404);
  await post('/admissions',{fullName:'Invalid birth',dateOfBirth:'2026-09-02',classId:section.id,startDate:'2026-09-01',admissionNumber:'DOB-1'},400);
  await post('/admissions',{fullName:'Outside year',classId:section.id,startDate:'2027-08-01',admissionNumber:'DATE-1'},400);
});
test('duplicate requests create one application and one audit record',async()=>{
  const body={operationId:randomUUID(),fullName:'Retry learner',classId:section.id,startDate:'2026-09-01',admissionNumber:`R-${randomUUID().slice(0,12)}`};
  const [a,b]=await Promise.all([post('/admissions',body),post('/admissions',body)]);assert.equal(a.id,b.id);
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='admission.created'",[a.id])).rows[0].count,'1');
  await post('/admissions',{...body,operationId:randomUUID()},409);
});
test('teacher and guardian roles cannot inspect admissions or unscoped learners',async()=>{
  for(const email of ['teacher@example.test','guardian@example.test']){const actor=await login(email);for(const route of ['/admissions','/learners','/classes'])assert.equal((await call(route,'GET',undefined,actor)).status,403);}
});
test('review decisions require valid workflow, version and decision reasons',async()=>{
  const application=await apply();await post(`/admissions/${application.id}/transition`,{version:1,action:'enrol'},409);
  const review=await post(`/admissions/${application.id}/transition`,{version:1,action:'review'});
  await post(`/admissions/${application.id}/transition`,{version:1,action:'offer'},409);
  await post(`/admissions/${application.id}/transition`,{version:review.version,action:'waitlist'},400);
  const waitlist=await post(`/admissions/${application.id}/transition`,{version:review.version,action:'waitlist',reason:'Awaiting reviewed space'});assert.equal(waitlist.status,'waitlisted');
  const offer=await post(`/admissions/${application.id}/transition`,{version:waitlist.version,action:'offer',reason:'A reviewed space is now available'});assert.equal(offer.status,'offered');
  const priorReason=(await owner.query("SELECT metadata->>'reason' AS reason FROM audit_events WHERE target_id=$1 AND action='admission.waitlisted'",[application.id])).rows[0].reason;assert.equal(priorReason,'Awaiting reviewed space');
});
test('enrolment is atomic and retry-safe without silently creating identity',async()=>{
  const countBefore=(await owner.query('SELECT count(*) FROM users')).rows[0].count;
  const application=await accepted();const body={operationId:randomUUID(),version:application.version,action:'enrol'};
  const a=await post(`/admissions/${application.id}/transition`,body),b=await post(`/admissions/${application.id}/transition`,body);assert.equal(a.learner_id,b.learner_id);
  assert.equal((await owner.query('SELECT count(*) FROM enrolments WHERE school_id=$1 AND learner_id=$2',[school,a.learner_id])).rows[0].count,'1');
  assert.equal((await owner.query('SELECT count(*) FROM users')).rows[0].count,countBefore);
});
test('failed audit rolls back learner, enrolment and application state',async()=>{
  const application=await accepted();const body={operationId:randomUUID(),version:application.version,action:'enrol'};
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_admission_failure CHECK(action<>'admission.enrolled') NOT VALID");
  try {
    await post(`/admissions/${application.id}/transition`,body,500);
    const current=(await owner.query('SELECT status,version,learner_id FROM admissions WHERE id=$1',[application.id])).rows[0];assert.deepEqual(current,{status:'accepted',version:application.version,learner_id:null});
    assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');
  }finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_admission_failure');}
});
test('concurrent enrolments cannot exceed capacity; headteacher override is audited',async()=>{
  const limited=await post('/classes',{name:'Capacity one',level:'Primary',capacity:1,academicYearId:year.id});
  const applications=[await accepted(limited.id),await accepted(limited.id)];
  const responses=await Promise.all(applications.map(a=>call(`/admissions/${a.id}/transition`,'POST',{operationId:randomUUID(),version:a.version,action:'enrol'})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const blocked=applications[responses.findIndex(r=>r.status===409)];
  const frontdesk=await login('frontdesk@example.test');await post(`/admissions/${blocked.id}/transition`,{version:blocked.version,action:'enrol',capacityOverrideReason:'Reviewed exceptional space'},403,frontdesk);
  const result=await post(`/admissions/${blocked.id}/transition`,{version:blocked.version,action:'enrol',capacityOverrideReason:'Headteacher reviewed exceptional space'});assert.equal(result.status,'enrolled');
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE school_id=$1 AND action='class.capacity.override' AND target_id=$2",[school,limited.id])).rows[0].count,'1');
});
test('transfer preserves dated history and replay creates no duplicate enrolment',async()=>{
  const enrolledRecord=await enrolled();const body={operationId:randomUUID(),version:1,classId:destination.id,effectiveDate:'2026-10-01',reason:'Reviewed mid-term class transfer'};
  const result=await post(`/learners/${enrolledRecord.learner_id}/transfer`,body);assert.equal(result.version,2);assert.equal(result.enrolments.length,2);assert.equal(result.enrolments[0].end_date,'2026-10-01');assert.equal(result.enrolments[1].start_date,'2026-10-01');assert.equal(result.enrolments[0].class_name,section.name);
  const replay=await post(`/learners/${enrolledRecord.learner_id}/transfer`,body);assert.equal(replay.enrolments.length,2);
  await post(`/learners/${enrolledRecord.learner_id}/transfer`,{...body,operationId:randomUUID(),classId:section.id},409);
  const fresh=await (await call(`/learners/${enrolledRecord.learner_id}`)).json();assert.deepEqual(fresh,result);
});
test('invalid transfer or full destination rolls back original history',async()=>{
  const record=await enrolled();const full=await post('/classes',{name:'Full destination',level:'Primary',capacity:1,academicYearId:year.id});await enrolled(full.id);
  await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:full.id,effectiveDate:'2026-10-01',reason:'Cannot fit'},409);
  await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:destination.id,effectiveDate:'2026-09-01',reason:'Invalid start'},400);
  const fresh=await (await call(`/learners/${record.learner_id}`)).json();assert.equal(fresh.version,1);assert.equal(fresh.enrolments.length,1);assert.equal(fresh.enrolments[0].end_date,null);
});
test('database rejects overlapping enrolments and edits to closed history',async()=>{
  const record=await enrolled();const moved=await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:destination.id,effectiveDate:'2026-10-01',reason:'History constraint check'});
  await assert.rejects(owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),school,record.learner_id,section.id,'2026-09-15']),/exclusion constraint/);
  await assert.rejects(owner.query('UPDATE enrolments SET end_date=NULL,end_reason=NULL WHERE id=$1',[moved.enrolments[0].id]),/immutable/);
});
test('bounded search pagination returns all applications without leaking another school',async()=>{
  const prefix=`Page-${randomUUID().slice(0,8)}`;
  for(let i=0;i<3;i++)await apply(section.id,`${prefix} learner ${i}`);
  const first=await (await call(`/admissions?limit=2&search=${prefix}`)).json();const second=await (await call(`/admissions?limit=2&offset=2&search=${prefix}`)).json();
  assert.equal(first.total,3);assert.equal(first.items.length,2);assert.equal(second.items.length,1);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,3);
  const literal=await (await call('/admissions?search=%25')).json();assert.equal(literal.total,0);
  assert.equal((await call('/admissions?limit=1000')).status,400);assert.equal((await call('/learners?offset=-1')).status,400);
});
test('future arrivals reserve capacity and same-date departures release it',async()=>{
  const target=await post('/classes',{name:'Scheduled capacity',level:'Primary',capacity:1,academicYearId:year.id});
  const incoming=await enrolled();await post(`/learners/${incoming.learner_id}/transfer`,{version:1,classId:target.id,effectiveDate:'2026-10-01',reason:'Scheduled incoming transfer'});
  const tooEarly=await accepted(target.id);await post(`/admissions/${tooEarly.id}/transition`,{version:tooEarly.version,action:'enrol'},409);
  await post(`/learners/${incoming.learner_id}/transfer`,{version:2,classId:destination.id,effectiveDate:'2026-11-01',reason:'Scheduled departure'});
  const replacement=await accepted(target.id,'2026-11-01');const success=await post(`/admissions/${replacement.id}/transition`,{version:replacement.version,action:'enrol'});assert.equal(success.status,'enrolled');
});
test('database composite foreign keys reject cross-school learner/class links',async()=>{
  const learner=await enrolled();await assert.rejects(owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),other,learner.learner_id,section.id,'2026-09-01']),/foreign key/);
});
test('withdrawal preserves history, replays once and releases capacity on its exclusive end date',async()=>{
  const target=await post('/classes',{name:'Withdrawal capacity',level:'Primary',capacity:1,academicYearId:year.id});
  const record=await enrolled(target.id),url=`/learners/${record.learner_id}/withdraw`;
  const before=await (await call(`/learners/${record.learner_id}`)).json();
  const body={operationId:randomUUID(),version:1,effectiveDate:'2026-10-01',reason:'Reviewed synthetic school departure'};
  const frontdesk=await login('frontdesk@example.test');const result=await post(url,body,201,frontdesk),replay=await post(url,body,201,frontdesk);
  assert.deepEqual(replay,result);assert.equal(result.version,2);assert.equal(result.enrolments.length,1);
  assert.deepEqual(result.enrolments[0],{...before.enrolments[0],end_date:body.effectiveDate,end_reason:body.reason});
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='learner.withdrawn'",[record.learner_id])).rows[0].count,'1');
  await post(url,{...body,operationId:randomUUID(),version:2},409,frontdesk);
  const early=await accepted(target.id,'2026-09-30');await post(`/admissions/${early.id}/transition`,{version:early.version,action:'enrol'},409);
  const replacement=await accepted(target.id,'2026-10-01');await post(`/admissions/${replacement.id}/transition`,{version:replacement.version,action:'enrol'});
});
test('withdrawal rejects unauthorized actors, invalid dates, missing reasons and stale versions',async()=>{
  const record=await enrolled(),url=`/learners/${record.learner_id}/withdraw`,body={version:1,effectiveDate:'2026-10-01',reason:'Reviewed departure'};
  for(const email of ['teacher@example.test','guardian@example.test'])await post(url,body,403,await login(email));
  await post(url,{...body,effectiveDate:'2026-09-01'},400);await post(url,{...body,effectiveDate:'2026-02-30'},400);
  await post(url,{version:1,effectiveDate:'2026-10-01'},400);await post(url,{...body,version:2},409);
  const cross=await fetch(`${base}/schools/${other}${url}`,{method:'POST',headers:{cookie:account.cookie,'content-type':'application/json','x-csrf-token':account.csrf},body:JSON.stringify({operationId:randomUUID(),...body})});assert.equal(cross.status,404);
  const fresh=await (await call(`/learners/${record.learner_id}`)).json();assert.equal(fresh.version,1);assert.equal(fresh.enrolments[0].end_date,null);
});
test('withdrawal and transfer racing on one version commit exactly one historical change',async()=>{
  const record=await enrolled(),root=`/learners/${record.learner_id}`;
  const replies=await Promise.all([call(`${root}/withdraw`,'POST',{operationId:randomUUID(),version:1,effectiveDate:'2026-10-01',reason:'Concurrent departure'}),call(`${root}/transfer`,'POST',{operationId:randomUUID(),version:1,classId:destination.id,effectiveDate:'2026-10-01',reason:'Concurrent transfer'})]);
  assert.deepEqual(replies.map(row=>row.status).sort(),[201,409]);
  const fresh=await (await call(root)).json();assert.equal(fresh.version,2);
  const events=await owner.query("SELECT action FROM audit_events WHERE target_id=$1 AND action IN ('learner.withdrawn','learner.transferred')",[record.learner_id]);assert.equal(events.rowCount,1);
});
test('failed withdrawal audit rolls back supersession, replacement, version and command receipt',async()=>{
  const record=await enrolled(),root=`/learners/${record.learner_id}`;
  const before=await post(`${root}/transfer`,{version:1,classId:destination.id,effectiveDate:'2026-11-01',reason:'Original rollback schedule'});
  const body={operationId:randomUUID(),version:2,effectiveDate:'2026-10-01',reason:'Audit rollback departure'};
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_withdrawal_failure CHECK(action<>'learner.withdrawn') NOT VALID");
  try{
    await post(`${root}/withdraw`,body,500);const fresh=await (await call(root)).json();assert.deepEqual(fresh,before);
    assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');
  }finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_withdrawal_failure');}
  await post(`${root}/withdraw`,body);
});
test('withdrawal before or on a scheduled transfer supersedes plans without rewriting originals',async()=>{
  for(const date of ['2026-10-01','2026-11-01']) {
    const target=await post('/classes',{name:`Cancelled transfer ${date}`,level:'Primary',capacity:1,academicYearId:year.id});
    const record=await enrolled(),root=`/learners/${record.learner_id}`;
    const scheduled=await post(`${root}/transfer`,{version:1,classId:target.id,effectiveDate:'2026-11-01',reason:'Original scheduled move'});
    await assert.rejects(owner.query("UPDATE enrolments SET superseded_at=now(),supersession_reason='Invalid combined edit',end_date='2026-12-01',end_reason='Rewritten input' WHERE id=$1",[scheduled.enrolments[1].id]),/preserve original/);
    const body={operationId:randomUUID(),version:2,effectiveDate:date,reason:'Reviewed departure before planned class'};
    const result=await post(`${root}/withdraw`,body),replay=await post(`${root}/withdraw`,body);assert.deepEqual(replay,result);
    const effective=result.enrolments.filter(row=>!row.superseded_at);assert.equal(effective.length,1);assert.equal(effective[0].end_date,date);assert.equal(effective[0].class_id,section.id);
    const future=result.enrolments.find(row=>row.id===scheduled.enrolments[1].id);assert.ok(future.superseded_at);assert.equal(future.start_date,'2026-11-01');assert.equal(future.end_date,null);
    const original=result.enrolments.find(row=>row.id===scheduled.enrolments[0].id);assert.equal(original.end_date,'2026-11-01');assert.equal(original.end_reason,'Original scheduled move');
    if(date==='2026-10-01'){assert.ok(original.superseded_at);await assert.rejects(owner.query('UPDATE enrolments SET superseded_at=NULL,supersession_reason=NULL WHERE id=$1',[original.id]),/immutable/);}
    await enrolled(target.id); // cancelled future reservations no longer consume capacity
    await post(`${root}/transfer`,{version:result.version,classId:destination.id,effectiveDate:'2026-12-01',reason:'Cannot reopen withdrawn plan'},409);
  }
});
test('an application keeps the guardian the family gave, with the phone stored as +233',async()=>{
  const number=`G-${randomUUID().slice(0,12)}`;
  const created=await post('/admissions',{fullName:'Guardian learner',classId:section.id,startDate:'2026-09-01',admissionNumber:number,guardianName:'Kojo Appiah',guardianRelationship:'Father',guardianPhone:'024 401 0013'});
  const row=(await owner.query('SELECT guardian_name,guardian_relationship,guardian_phone FROM admissions WHERE id=$1',[created.id])).rows[0];
  assert.deepEqual(row,{guardian_name:'Kojo Appiah',guardian_relationship:'Father',guardian_phone:'+233244010013'});
  await post('/admissions',{fullName:'Bad phone',classId:section.id,startDate:'2026-09-01',admissionNumber:`G-${randomUUID().slice(0,12)}`,guardianName:'Ama Mensah',guardianPhone:'12345'},400);
  await post('/admissions',{fullName:'No guardian name',classId:section.id,startDate:'2026-09-01',admissionNumber:`G-${randomUUID().slice(0,12)}`,guardianPhone:'0244010013'},400);
  const plain=await apply();assert.equal((await owner.query('SELECT guardian_name FROM admissions WHERE id=$1',[plain.id])).rows[0].guardian_name,null);
});
test('an application page shows every decision in order with who made it, to head and front desk only',async()=>{
  const frontdesk=await login('frontdesk@example.test');
  let application=await post('/admissions',{fullName:'Timeline learner',classId:section.id,startDate:'2026-09-01',admissionNumber:`T-${randomUUID().slice(0,12)}`},201,frontdesk);
  application=await post(`/admissions/${application.id}/transition`,{version:application.version,action:'review'});
  application=await post(`/admissions/${application.id}/transition`,{version:application.version,action:'waitlist',reason:'Class is full for now'});
  application=await post(`/admissions/${application.id}/transition`,{version:application.version,action:'offer'},201,frontdesk);
  application=await post(`/admissions/${application.id}/transition`,{version:application.version,action:'accept'});
  await post(`/admissions/${application.id}/transition`,{version:application.version,action:'enrol'});
  const [head,desk]=(await owner.query('SELECT display_name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id',[[users[0],users[3]]])).rows.map(r=>r.display_name);
  for(const actor of [account,frontdesk]){
    const page=await (await call(`/admissions/${application.id}`,'GET',undefined,actor)).json();
    assert.equal(page.status,'enrolled');assert.equal(page.class_name,section.name);assert.equal(page.year_name,'2026/2027');assert.ok(page.learner_id);
    assert.deepEqual(page.timeline.map((e:any)=>[e.step,e.by]),[['created',desk],['review',head],['waitlisted',head],['offered',desk],['accepted',head],['enrolled',head]]);
    assert.equal(page.timeline[2].reason,'Class is full for now');assert.deepEqual(page.parents,[]);
  }
  for(const email of ['teacher@example.test','guardian@example.test'])assert.equal((await call(`/admissions/${application.id}`,'GET',undefined,await login(email))).status,403);
  assert.equal((await call(`/admissions/${randomUUID()}`)).status,404);
  const cross=await fetch(`${base}/schools/${other}/admissions/${application.id}`,{headers:{cookie:account.cookie}});assert.equal(cross.status,404);
});
test('the application page lists parent accounts linked to the enrolled student',async()=>{
  const record=await enrolled();
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact) VALUES($1,$2,$3,$4,'Synthetic parent',true,true,false,true)",[randomUUID(),school,record.learner_id,members[2]]);
  const page=await (await call(`/admissions/${record.id}`)).json();assert.deepEqual(page.parents,[{name:'Synthetic parent',verified:false}]);
});
test('staff notes on an application are kept as written, newest first, and never edited',async()=>{
  const application=await apply(),frontdesk=await login('frontdesk@example.test');
  const body={operationId:randomUUID(),note:'Visited on Monday with last school report.'};
  const first=await post(`/admissions/${application.id}/notes`,body,201,frontdesk),replay=await post(`/admissions/${application.id}/notes`,body,201,frontdesk);assert.equal(first.id,replay.id);
  await post(`/admissions/${application.id}/notes`,{note:'Birth certificate seen.'});
  await post(`/admissions/${application.id}/notes`,{note:'  '},400);
  await post(`/admissions/${randomUUID()}/notes`,{note:'Nobody here.'},404);
  await post(`/admissions/${application.id}/notes`,{note:'Teacher note'},403,await login('teacher@example.test'));
  const page=await (await call(`/admissions/${application.id}`)).json();
  assert.deepEqual(page.notes.map((n:any)=>n.note),['Birth certificate seen.','Visited on Monday with last school report.']);
  assert.deepEqual(page.timeline.map((e:any)=>e.step),['created']);
  await assert.rejects(owner.query('UPDATE admission_notes SET note=$1 WHERE id=$2',['Changed',first.id]),/kept as written/);
  await assert.rejects(owner.query('DELETE FROM admission_notes WHERE id=$1',[first.id]),/kept as written/);
  const privileges=(await runtime.query("SELECT has_table_privilege('school_app','admission_notes','UPDATE') AS u,has_table_privilege('school_app','admission_notes','DELETE') AS d")).rows[0];assert.deepEqual(privileges,{u:false,d:false});
  const forced=(await runtime.query("SELECT relforcerowsecurity FROM pg_class WHERE relname='admission_notes'")).rows[0];assert.equal(forced.relforcerowsecurity,true);
  assert.equal((await runtime.query('SELECT * FROM admission_notes')).rowCount,0);
});
test('decision names are refused outside admissions staff',async()=>{
  const application=await apply(),client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.school_id',$2,true)",[users[1],school]);
    await assert.rejects(client.query('SELECT * FROM admission_actor_names($1)',[application.id]),/Admissions staff required/);
  }finally{await client.query('ROLLBACK');client.release();}
});
test('applications can be narrowed to open, enrolled or declined',async()=>{
  const prefix=`Stage-${randomUUID().slice(0,8)}`;
  await apply(section.id,`${prefix} open`);
  const declined=await apply(section.id,`${prefix} declined`);const reviewed=await post(`/admissions/${declined.id}/transition`,{version:declined.version,action:'review'});await post(`/admissions/${declined.id}/transition`,{version:reviewed.version,action:'decline',reason:'Family chose another school'});
  const done=await accepted();await post(`/admissions/${done.id}/transition`,{version:done.version,action:'enrol'});
  const names=async(stage:string)=>(await (await call(`/admissions?search=${prefix}&stage=${stage}`)).json()).items.map((r:any)=>r.full_name);
  assert.deepEqual(await names('open'),[`${prefix} open`]);assert.deepEqual(await names('declined'),[`${prefix} declined`]);
  assert.equal((await (await call(`/admissions?search=${prefix}`)).json()).total,2);
  const enrolledPage=await (await call('/admissions?stage=enrolled&limit=100')).json();assert.ok(enrolledPage.items.every((r:any)=>r.status==='enrolled'));
  assert.equal((await call('/admissions?stage=review')).status,400);
});
