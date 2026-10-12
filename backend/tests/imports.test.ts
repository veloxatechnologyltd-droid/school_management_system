import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeDate,parseLearnerCsv } from '../src/modules/learners/imports.csv';
const {createApp}=require('../dist/main');
const connection={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...connection,user:process.env.USER}),runtime=new Pool({...connection,user:'school_app'});
const school=randomUUID(),other=randomUUID();
let app:any,base:string,head:any,desk:any,year:any,section:any;
const header='admission_number,full_name,date_of_birth\n';
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,schoolId=school){return fetch(`${base}/schools/${schoolId}${route}`,{method,headers:{cookie:actor.cookie,'x-csrf-token':actor.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201,actor=head){const r=await call(route,'POST',{operationId:randomUUID(),...body},actor),value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
async function stage(csv:string,classId=section.id,actor=head){return post('/learner-imports',{sourceName:'Synthetic learners.csv',classId,startDate:'2026-09-01',csv:header+csv},201,actor);}
function approval(batch:any,selectedRows=batch.rows.map((row:any)=>({rowNumber:row.row_number}))){return {version:batch.version,approvalReason:'Reviewed source and learner identities',selectedRows};}
async function count(table:string){return Number((await owner.query(`SELECT count(*) FROM ${table} WHERE school_id=$1`,[school])).rows[0].count);}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;head=await login('head@example.test');desk=await login('frontdesk@example.test');
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Synthetic import school',other,'Other import school']);
  for(const [user,role] of [['20000000-0000-4000-8000-000000000001','headteacher'],['20000000-0000-4000-8000-000000000002','teacher'],['20000000-0000-4000-8000-000000000003','guardian'],['20000000-0000-4000-8000-000000000004','frontdesk']])await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[randomUUID(),school,user,role]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),other,'20000000-0000-4000-8000-000000000001']);
  year=await post('/academic-years',{name:'Import year',startDate:'2026-09-01',endDate:'2027-08-01'});section=await post('/classes',{name:'Import class',level:'Primary',capacity:100,academicYearId:year.id});
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('CSV parser preserves quoted identities and rejects malformed, empty and excessive input',()=>{
  assert.deepEqual(parseLearnerCsv('\uFEFF'+header.replace('\n','\r\n')+'I-01,"Synthetic, ""Learner""",2019-01-01\r\n')[0].input,{admissionNumber:'I-01',fullName:'Synthetic, "Learner"',dateOfBirth:'2019-01-01',columnCount:3});
  for(const csv of ['wrong,header\nX,Y',header,header+'X,"Unclosed,Y',header+'X,"Name"extra,Y',header+Array.from({length:201},(_,i)=>`N-${i},Synthetic learner,`).join('\n')])assert.throws(()=>parseLearnerCsv(csv));
});
test('Ghana school spreadsheets: header aliases, any column order, extra columns, semicolons and DD/MM/YYYY',()=>{
  const excel='Name of Student,Gender,Admission No.,DOB\r\n"Mensah, Ama",F,GH-001,03/04/2015\r\nOwusu Kofi,M,GH-002,\r\n';
  const rows=parseLearnerCsv(excel,'dmy');assert.deepEqual(rows.map(r=>r.input),[{admissionNumber:'GH-001',fullName:'Mensah, Ama',dateOfBirth:'2015-04-03',sex:'female',columnCount:3},{admissionNumber:'GH-002',fullName:'Owusu Kofi',dateOfBirth:'',sex:'male',columnCount:3}]);
  assert.equal(parseLearnerCsv(excel,'mdy')[0].input.dateOfBirth,'2015-03-04');
  assert.equal(parseLearnerCsv(excel,'iso')[0].input.dateOfBirth,'03/04/2015','without a chosen format the value is left for validation to reject');
  assert.equal(parseLearnerCsv('Admission Number;Full Name;Date of Birth\nA-1;Ama Sample;5-1-2016\n','dmy')[0].input.dateOfBirth,'2016-01-05');
  assert.equal(parseLearnerCsv('adm no\tlearner name\nA-1\tAma Sample\n')[0].input.dateOfBirth,'','date of birth column is optional');
  assert.equal(parseLearnerCsv('admission_number,full_name\nA-1,Ama Sample,extra\n')[0].input.columnCount,0,'ragged rows are flagged by validation');
  assert.throws(()=>parseLearnerCsv('Name,Full Name,Admission No.\nA,B,C\n'),/More than one column/);
  assert.throws(()=>parseLearnerCsv('Class,Gender\nP1,F\n'),/admission number column/);
  assert.equal(normalizeDate('31/02/2015','dmy'),'2015-02-31','impossible dates stay unreadable so the row is flagged');
  assert.equal(normalizeDate('15/2015','dmy'),'15/2015');
});
test('staging is persisted and retry-safe without creating learners or enrolments',async()=>{
  const beforeLearners=await count('learners'),beforeEnrolments=await count('enrolments');
  const body={operationId:randomUUID(),sourceName:'Quoted.csv',classId:section.id,startDate:'2026-09-01',csv:header+'I-01,"Synthetic, Learner",2019-01-01\nBAD!,Short,2026-02-30'};
  const batch=await post('/learner-imports',body,201,desk),replay=await post('/learner-imports',body,201,desk);assert.equal(batch.id,replay.id);assert.equal(batch.rows[0].validation.issues.length,0);assert.equal(batch.rows[1].validation.issues.length,2);
  assert.equal(await count('learners'),beforeLearners);assert.equal(await count('enrolments'),beforeEnrolments);assert.deepEqual((await (await call(`/learner-imports/${batch.id}`)).json()).rows,batch.rows);
  await post('/learner-imports',{...body,sourceName:'Changed.csv'},409,desk);
  await post('/learner-imports',{...body,operationId:randomUUID(),sourceName:'Bad\u0000name'},400);
  await post('/learner-imports',{...body,operationId:randomUUID(),csv:header+'NUL-01,Synthetic\u0000name,'},400);
});
test('tenant context, roles, CSRF and foreign class/batch denial protect staged identities',async()=>{
  const batch=await stage('SEC-01,Synthetic private learner,');
  for(const email of ['teacher@example.test','guardian@example.test']){const actor=await login(email);assert.equal((await call('/learner-imports','GET',undefined,actor)).status,403);assert.equal((await call(`/learner-imports/${batch.id}`,'GET',undefined,actor)).status,403);}
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),403,desk);
  assert.equal((await call(`/learner-imports/${batch.id}`,'GET',undefined,head,other)).status,404);
  assert.equal((await call('/learner-imports','POST',{operationId:randomUUID(),sourceName:'Foreign.csv',classId:section.id,startDate:'2026-09-01',csv:header+'F-01,Foreign learner,'},head,other)).status,404);
  assert.equal((await call(`/learner-imports/${batch.id}/validate`,'POST',{operationId:randomUUID(),version:1},{...head,csrf:'invalid'})).status,403);
  for(const table of ['learner_import_batches','learner_import_rows']){assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount,0);assert.equal((await owner.query('SELECT relforcerowsecurity FROM pg_class WHERE relname=$1',[table])).rows[0].relforcerowsecurity,true);}
});
test('review selects valid rows, preserves excluded errors and commits once without creating logins',async()=>{
  const users=(await owner.query('SELECT count(*) FROM users')).rows[0].count,batch=await stage('SEL-01,Selected synthetic learner,\nINVALID!,Excluded learner,');
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),400);
  const body={operationId:randomUUID(),...approval(batch,[{rowNumber:2}])};
  const [a,b]=await Promise.all([post(`/learner-imports/${batch.id}/commit`,body),post(`/learner-imports/${batch.id}/commit`,body)]);assert.equal(a.status,'committed');assert.deepEqual(a,b);assert.ok(a.rows[0].learner_id);assert.equal(a.rows[1].learner_id,null);
  assert.equal((await owner.query('SELECT count(*) FROM enrolments WHERE learner_id=$1',[a.rows[0].learner_id])).rows[0].count,'1');assert.equal((await owner.query('SELECT count(*) FROM users')).rows[0].count,users);
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='learner.import.committed'",[batch.id])).rows[0].count,'1');
  await post(`/learner-imports/${batch.id}/commit`,{...body,approvalReason:'Changed reviewed request'},409);
  await assert.rejects(owner.query('UPDATE learner_import_batches SET version=version+1 WHERE id=$1',[batch.id]),/immutable/);
  await assert.rejects(owner.query("UPDATE learner_import_rows SET validation='{}' WHERE batch_id=$1",[batch.id]),/immutable/);
});
test('possible name matches require explicit review and never merge identities',async()=>{
  const original=await stage('MATCH-01,Possible synthetic twin,2019-01-01');const committed=await post(`/learner-imports/${original.id}/commit`,approval(original));
  const batch=await stage('MATCH-02,Possible synthetic twin,2019-01-01\nMATCH-03,Possible synthetic twin,2019-01-01');assert.equal(batch.rows[0].validation.possibleMatches[0].id,committed.rows[0].learner_id);assert.deepEqual(batch.rows[0].validation.batchMatches,[3]);
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),400);
  const result=await post(`/learner-imports/${batch.id}/commit`,approval(batch,batch.rows.map((row:any)=>({rowNumber:row.row_number,duplicateReviewReason:'Reviewed distinct learners against original records'}))));assert.equal(new Set([committed.rows[0].learner_id,...result.rows.map((row:any)=>row.learner_id)]).size,3);
});
test('stale identity previews must be rechecked and duplicate numbers remain blocked',async()=>{
  const batch=await stage('STALE-01,Stale synthetic learner,');
  await post('/admissions',{fullName:'Stale synthetic learner',classId:section.id,startDate:'2026-09-01',admissionNumber:'STALE-APP'});
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),409);
  const checked=await post(`/learner-imports/${batch.id}/validate`,{version:batch.version});assert.equal(checked.version,2);assert.equal(checked.rows[0].validation.possibleMatches.length,1);
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),409);
  await post(`/learner-imports/${batch.id}/commit`,approval(checked,[{rowNumber:2,duplicateReviewReason:'Confirmed these are distinct children'}]));
  const duplicate=await stage('STALE-01,Another learner,\nFILE-01,First learner,\nFILE-01,Second learner,');assert.ok(duplicate.rows[0].validation.issues.some((issue:string)=>issue.includes('already belongs')));assert.ok(duplicate.rows[1].validation.issues.some((issue:string)=>issue.includes('repeats')));
});
test('capacity failure rolls back every selected learner; a head override is recorded',async()=>{
  const limited=await post('/classes',{name:'Import capacity one',level:'Primary',capacity:1,academicYearId:year.id}),batch=await stage('CAP-01,Capacity first learner,\nCAP-02,Capacity second learner,',limited.id),beforeCount=await count('learners');
  await post(`/learner-imports/${batch.id}/commit`,approval(batch),409);assert.equal(await count('learners'),beforeCount);const fresh=await (await call(`/learner-imports/${batch.id}`)).json();assert.equal(fresh.status,'staged');assert.ok(fresh.rows.every((row:any)=>row.learner_id===null));
  await post(`/learner-imports/${batch.id}/commit`,{...approval(batch),capacityOverrideReason:'Head reviewed temporary exceptional capacity'});
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='class.capacity.override'",[limited.id])).rows[0].count,'1');
});
test('commit audit failure rolls back outcomes, approval and receipt, then permits safe retry',async()=>{
  const batch=await stage('FAIL-01,Synthetic audit rollback,');const body={operationId:randomUUID(),...approval(batch)},beforeCount=await count('learners');
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_import_failure CHECK(action<>'learner.import.committed') NOT VALID");
  try{await post(`/learner-imports/${batch.id}/commit`,body,500);assert.equal(await count('learners'),beforeCount);assert.equal((await owner.query('SELECT status,version FROM learner_import_batches WHERE id=$1',[batch.id])).rows[0].status,'staged');assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');}finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_import_failure');}
  assert.equal((await post(`/learner-imports/${batch.id}/commit`,body)).status,'committed');
});
test('concurrent imports in separate classes cannot claim the same admission number',async()=>{
  const destination=await post('/classes',{name:'Other import class',level:'Primary',capacity:50,academicYearId:year.id});const batches=[await stage('RACE-01,Racing learner one,'),await stage('RACE-01,Racing learner two,',destination.id)];
  const responses=await Promise.all(batches.map(batch=>call(`/learner-imports/${batch.id}/commit`,'POST',{operationId:randomUUID(),...approval(batch)})));assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await owner.query("SELECT count(*) FROM learners WHERE school_id=$1 AND admission_number='RACE-01'",[school])).rows[0].count,'1');
});
test('concurrent admission and import share identity reservations',async()=>{
  const batch=await stage('APP-RACE-01,Concurrent import identity,');
  const responses=await Promise.all([call(`/learner-imports/${batch.id}/commit`,'POST',{operationId:randomUUID(),...approval(batch)}),call('/admissions','POST',{operationId:randomUUID(),fullName:'Concurrent application identity',admissionNumber:'APP-RACE-01',classId:section.id,startDate:'2026-09-01'})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await owner.query("SELECT (SELECT count(*) FROM learners WHERE school_id=$1 AND admission_number='APP-RACE-01')+(SELECT count(*) FROM admissions WHERE school_id=$1 AND admission_number='APP-RACE-01') AS count",[school])).rows[0].count,'1');
});
test('runtime cannot rewrite source or attach cross-school outcomes; history is paged',async()=>{
  const batch=await stage('IMM-01,Immutable source learner,'),foreignLearner=randomUUID();
  await owner.query('INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)',[foreignLearner,other,'OTHER-01','Other school synthetic learner']);const client=await runtime.connect();
  try{
    for(const [sql,params] of [["UPDATE learner_import_rows SET input='{}' WHERE batch_id=$1",[batch.id]],["UPDATE learner_import_batches SET source_name='Changed' WHERE id=$1",[batch.id]],["UPDATE learner_import_rows SET learner_id=$2 WHERE batch_id=$1",[batch.id,foreignLearner]] ] as [string,any[]][]){
      await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[school]);await assert.rejects(client.query(sql,params));await client.query('ROLLBACK');
    }
  }finally{client.release();}
  const first=await (await call('/learner-imports?limit=2')).json(),second=await (await call('/learner-imports?limit=2&offset=2')).json();assert.equal(first.items.length,2);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map((row:any)=>row.id)).size,4);assert.equal(first.items[0].start_date,'2026-09-01');
  assert.equal((await call('/learner-imports?limit=201')).status,400);
  const classes=await (await call('/learner-imports/classes?search=Import%20class&limit=1')).json();assert.equal(classes.items.length,1);assert.ok(classes.total>=1);
});
test('membership revocation denies approval of an already staged batch',async()=>{
  const batch=await stage('REVOKE-01,Revoked reviewer learner,');
  await owner.query("UPDATE memberships SET revoked_at=now() WHERE school_id=$1 AND role='headteacher'",[school]);
  try{await post(`/learner-imports/${batch.id}/commit`,approval(batch),404);}finally{await owner.query("UPDATE memberships SET revoked_at=NULL WHERE school_id=$1 AND role='headteacher'",[school]);}
  assert.equal((await (await call(`/learner-imports/${batch.id}`)).json()).status,'staged');
});
