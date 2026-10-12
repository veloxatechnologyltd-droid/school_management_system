import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),y1=randomUUID(),y2=randomUUID(),A=randomUUID(),B=randomUUID(),C=randomUUID(),headM=randomUUID(),teacherM=randomUUID();
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const effective=shift(21);let app:any,base:string,head:any,teacher:any;const kids:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher]=await Promise.all(['head@example.test','teacher@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Promotion school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$3,'20000000-0000-4000-8000-000000000001','headteacher'),($2,$3,'20000000-0000-4000-8000-000000000002','teacher')",[headM,teacherM,school]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$3,'Year one',$4,$5),($2,$3,'Year two',$6,$7)",[y1,y2,school,shift(-100),shift(30),effective,shift(300)]);
  for(const [id,year,name] of [[A,y1,'Primary 3 Old'],[B,y2,'Primary 4 New'],[C,y2,'Primary 3 Repeat']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,'Primary',30)",[id,school,year,name]);
  for(const name of ['Promote Me','Repeat Me','Leaving Now']){const id=randomUUID();kids.push(id);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`PR-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,A,shift(-50)]);}
});
after(async()=>{await app?.close();await owner.end();});

test('preview lists the class and only the head can promote',async()=>{
  const preview=await call(`/promotions/preview?sourceClassId=${A}&effectiveDate=${effective}`);assert.equal(preview.status,200);assert.deepEqual(preview.body.items.map((row:any)=>row.full_name),['Leaving Now','Promote Me','Repeat Me']);
  assert.equal((await call(`/promotions/preview?sourceClassId=${A}&effectiveDate=${effective}`,'GET',undefined,teacher)).status,403);
  assert.equal((await call('/promotions','POST',{operationId:randomUUID(),sourceClassId:A,effectiveDate:effective,reason:'Year end',decisions:[]},teacher)).status,400);
  assert.equal((await call(`/promotions/preview?sourceClassId=${randomUUID()}&effectiveDate=${effective}`)).status,404);
});

test('every learner needs a decision; incomplete or invalid batches change nothing',async()=>{
  const base={operationId:randomUUID(),sourceClassId:A,effectiveDate:effective,reason:'End of year promotion'};
  const partial=await call('/promotions','POST',{...base,decisions:[{learnerId:kids[0],action:'move',classId:B}]});assert.equal(partial.status,409);
  const same=await call('/promotions','POST',{...base,operationId:randomUUID(),decisions:[{learnerId:kids[0],action:'move',classId:B},{learnerId:kids[1],action:'move',classId:A},{learnerId:kids[2],action:'leave'}]});assert.equal(same.status,409);
  assert.equal((await owner.query('SELECT count(*) FROM enrolments WHERE school_id=$1 AND class_id=ANY($2)',[school,[B,C]])).rows[0].count,'0');
});

test('promotion moves, repeats and withdraws in one reviewed batch and is retry-safe',async()=>{
  const body={operationId:randomUUID(),sourceClassId:A,effectiveDate:effective,reason:'End of year promotion',decisions:[{learnerId:kids[0],action:'move',classId:B},{learnerId:kids[1],action:'move',classId:C},{learnerId:kids[2],action:'leave'}]};
  const first=await call('/promotions','POST',body);assert.equal(first.status,201,JSON.stringify(first.body));assert.deepEqual(first.body,{moved:2,left:1});
  assert.deepEqual((await call('/promotions','POST',body)).body,{moved:2,left:1});
  const rows=(await owner.query('SELECT learner_id,class_id,start_date::text,end_date::text,end_reason FROM enrolments WHERE school_id=$1 AND superseded_at IS NULL ORDER BY learner_id,start_date',[school])).rows;
  const of=(id:string)=>rows.filter((row:any)=>row.learner_id===id);
  assert.deepEqual(of(kids[0]).map((row:any)=>[row.class_id,row.start_date,row.end_date]),[[A,shift(-50),effective],[B,effective,null]]);
  assert.deepEqual(of(kids[1]).map((row:any)=>row.class_id),[A,C]);assert.equal(of(kids[2]).length,1);assert.equal(of(kids[2])[0].end_date,effective);assert.equal(of(kids[2])[0].end_reason,'End of year promotion');
  const actions=(await call('/audit?limit=100')).body.items.map((row:any)=>row.action);assert.ok(actions.includes('learners.promotion.completed'));
  assert.equal((await call(`/promotions/preview?sourceClassId=${A}&effectiveDate=${shift(22)}`)).body.items.length,0);
  // Opening the page again on the same date must not offer the already promoted class a second time.
  assert.equal((await call(`/promotions/preview?sourceClassId=${A}&effectiveDate=${effective}`)).body.items.length,0);
});
