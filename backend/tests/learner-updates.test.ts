import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),other=randomUUID(),headM=randomUUID(),deskM=randomUUID(),otherHeadM=randomUUID(),kwame=randomUUID(),efua=randomUUID();
const [headU,deskU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004'];
let app:any,base:string,head:any,desk:any;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,target=school){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
const stage=(csv:string,actor=desk,dateFormat='dmy')=>call('/learner-updates','POST',{operationId:randomUUID(),sourceName:'corrections.csv',dateFormat,csv},actor);
const learner=async(id:string)=>(await owner.query('SELECT full_name,date_of_birth::text,sex,version FROM learners WHERE id=$1',[id])).rows[0];
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,desk]=await Promise.all(['head@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Corrections school'),($2,'Other corrections school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$3,$4,'headteacher'),($2,$3,$5,'frontdesk'),($6,$7,$4,'headteacher')",[headM,deskM,school,headU,deskU,otherHeadM,other]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'LU-1','Kwame Mensa')",[kwame,school]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth,sex) VALUES($1,$2,'LU-2','Efua Owusu','2016-03-01','female')",[efua,school]);
});
after(async()=>{await app?.close();await owner.end();});

test('staging previews each changed field, unchanged rows and problems, and changes nothing',async()=>{
  const staged=await stage('Admission No.,Full Name,Date of Birth,Sex\nLU-1,Kwame Mensah,04/05/2015,M\nLU-2,,01/03/2016,F\nLU-9,Nobody Here,,\n');
  assert.equal(staged.status,201,JSON.stringify(staged.body));
  assert.deepEqual(staged.body.changes.map((c:any)=>[c.admissionNumber,c.field,c.from,c.to]),[['LU-1','full_name','Kwame Mensa','Kwame Mensah'],['LU-1','date_of_birth',null,'2015-05-04'],['LU-1','sex',null,'male']]);
  assert.equal(staged.body.unchanged,1);assert.deepEqual(staged.body.issues,[{rowNumber:4,admissionNumber:'LU-9',message:'No learner has this admission number'}]);
  assert.deepEqual(await learner(kwame),{full_name:'Kwame Mensa',date_of_birth:null,sex:null,version:1});
  // A file with problems is not applied; the school fixes it and stages again.
  assert.equal((await call(`/learner-updates/${staged.body.id}/apply`,'POST',{operationId:randomUUID(),version:1,approvalReason:'Checked against birth certificates'})).status,409);
  assert.equal((await stage('Name,Sex\nAma,F\n')).status,400);
  assert.equal((await stage('Admission No.,Sex\nLU-1,X\n')).body.issues[0].message,'Sex must be M or F (or Male/Female)');
  assert.equal((await stage('Admission No.,Date of Birth\nLU-1,2099-01-01\n',desk,'iso')).body.issues[0].message,'Birth date must be a valid date in the past');
});

test('only the headteacher applies, with a reason; a learner changed since staging stops the whole file',async()=>{
  const csv='Admission No.,Full Name,Date of Birth,Sex\nLU-1,Kwame Mensah,04/05/2015,M\n';
  const first=(await stage(csv)).body;
  assert.equal((await call(`/learner-updates/${first.id}/apply`,'POST',{operationId:randomUUID(),version:1,approvalReason:'Checked against birth certificates'},desk)).status,403);
  assert.equal((await call(`/learner-updates/${first.id}/apply`,'POST',{operationId:randomUUID(),version:2,approvalReason:'Checked against birth certificates'})).status,409);
  assert.equal((await call(`/learners/${kwame}/sex`,'POST',{operationId:randomUUID(),version:1,sex:'female'})).status,201);
  const stale=await call(`/learner-updates/${first.id}/apply`,'POST',{operationId:randomUUID(),version:1,approvalReason:'Checked against birth certificates'});
  assert.equal(stale.status,409);assert.match(stale.body.message,/changed after this file was staged/);
  assert.equal((await learner(kwame)).full_name,'Kwame Mensa');
  // Staged again, it applies; each field is kept as a correction with the old and new value and the reason.
  const second=(await stage(csv)).body;assert.deepEqual(second.changes.find((c:any)=>c.field==='sex'),{...second.changes.find((c:any)=>c.field==='sex'),from:'female',to:'male'});
  const body={operationId:randomUUID(),version:1,approvalReason:'Checked against birth certificates'};
  const applied=await call(`/learner-updates/${second.id}/apply`,'POST',body);assert.equal(applied.status,201,JSON.stringify(applied.body));
  assert.deepEqual([applied.body.learners,applied.body.changes],[1,3]);assert.deepEqual((await call(`/learner-updates/${second.id}/apply`,'POST',body)).body,applied.body);
  assert.equal((await call(`/learner-updates/${second.id}/apply`,'POST',{...body,operationId:randomUUID()})).status,409);
  assert.deepEqual(await learner(kwame),{full_name:'Kwame Mensah',date_of_birth:'2015-05-04',sex:'male',version:3});
  const history=(await call(`/learners/${kwame}/corrections`,'GET',undefined,desk)).body.items;
  assert.deepEqual(history.map((h:any)=>[h.field,h.old_value,h.new_value,h.reason,h.batch_id]).sort(),[['date_of_birth',null,'2015-05-04','Checked against birth certificates',second.id],['full_name','Kwame Mensa','Kwame Mensah','Checked against birth certificates',second.id],['sex','female','male','Checked against birth certificates',second.id]]);
  assert.equal((await call(`/learner-updates/${second.id}`)).body.status,'applied');
  assert.equal(Number((await owner.query("SELECT count(*) FROM audit_events WHERE school_id=$1 AND action='learner.corrected' AND target_id=$2",[school,kwame])).rows[0].count),1);
});

test('names and dates of birth never change without a recorded correction, corrections are append-only, and batches stay in their school',async()=>{
  await assert.rejects(owner.query("UPDATE learners SET full_name='Efua Silent' WHERE id=$1",[efua]),/recorded correction/);
  await assert.rejects(owner.query("UPDATE learners SET date_of_birth='2016-03-02' WHERE id=$1",[efua]),/recorded correction/);
  await assert.rejects(owner.query("UPDATE learner_corrections SET new_value='x' WHERE school_id=$1",[school]),/history|immutable|append/i);
  const batch=(await call('/learner-updates')).body.items[0];
  assert.equal((await call(`/learner-updates/${batch.id}`,'GET',undefined,head,other)).status,404);
  await assert.rejects(owner.query("UPDATE learner_update_batches SET source_name='other.csv' WHERE id=$1",[batch.id]),/applied once/);
});
