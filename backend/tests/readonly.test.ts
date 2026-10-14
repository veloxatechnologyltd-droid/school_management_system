import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');const {hashPassword}=require('../dist/modules/identity/identity.controller');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const demo=randomUUID(),other=randomUUID(),headM=randomUUID(),visitorU=randomUUID(),visitorM=randomUUID();
let app:any,base:string,head:any;
async function signIn(email:string,password='Synthetic-only-2026!'){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(target:string,route:string,method='GET',body?:unknown,actor=head,plain=false){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(plain?body:{operationId:randomUUID(),...(body as object)})}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
const notice={title:'Test notice',body:'Dear parents, this is a test.',audience:'school'};
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Demo school'),($2,'Ordinary school')",[demo,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,'20000000-0000-4000-8000-000000000001','headteacher'),($3,$4,'20000000-0000-4000-8000-000000000001','headteacher')",[headM,demo,randomUUID(),other]);
  await owner.query("INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,'Demo Visitor','visitor@readonly.test',$2)",[visitorU,await hashPassword('Visitor-password-2026')]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[visitorM,demo,visitorU]);
  head=await signIn('head@example.test');
});
after(async()=>{delete process.env.READ_ONLY_SCHOOL_IDS;await app?.close();await owner.end();});

test('a read-only demo school lets people look but not change anything',async()=>{
  assert.equal((await call(demo,'/notices','POST',notice)).status,201,'writes work until the school is marked read-only');
  process.env.READ_ONLY_SCHOOL_IDS=`${demo.toUpperCase()}, ${randomUUID()}`;
  const school=await call(demo,'');assert.equal(school.status,200);assert.equal(school.body.readOnly,true,'the app can show a banner');
  assert.equal((await call(other,'')).body.readOnly,undefined,'other schools are not marked');
  assert.equal((await call(demo,'/notices')).status,200,'reading still works');
  const refused=await call(demo,'/notices','POST',notice);
  assert.equal(refused.status,403);assert.equal(refused.body.code,'READ_ONLY_DEMO');assert.match(refused.body.message,/read-only demo school/);
  assert.equal((await call(demo,'/accounts/'+randomUUID()+'/reset-password','POST',{})).body.code,'READ_ONLY_DEMO','no password resets from inside the school');
  assert.equal((await call(other,'/notices','POST',notice)).status,201,'another school the same head belongs to is unaffected');
});

test('Ask and the AI drafts stay available in a read-only school',async()=>{
  process.env.READ_ONLY_SCHOOL_IDS=demo;
  for(const [route,body] of [['/assistant/chat',{messages:[{role:'user',text:'How is Basic 6 doing?'}]}],['/ai/report-remarks-draft',{classId:randomUUID(),termId:randomUUID()}],['/ai/runs/'+randomUUID()+'/feedback',{outcome:'accepted'}]] as [string,object][]){
    const r=await call(demo,route,'POST',body,head,true);assert.notEqual(r.body?.code,'READ_ONLY_DEMO',`${route} is not blocked as read-only (status ${r.status})`);
  }
});

test('shared demo logins cannot change their password, but other accounts can',async()=>{
  process.env.READ_ONLY_SCHOOL_IDS=demo;
  const visitor=await signIn('visitor@readonly.test','Visitor-password-2026');
  const change=(actor:any,current:string)=>fetch(`${base}/auth/change-password`,{method:'POST',headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},body:JSON.stringify({currentPassword:current,newPassword:'Another-password-2026'})});
  const refused=await change(visitor,'Visitor-password-2026');assert.equal(refused.status,403);assert.equal((await refused.json()).code,'READ_ONLY_DEMO');
  assert.equal((await owner.query("SELECT password_hash FROM users WHERE id=$1",[visitorU])).rows[0].password_hash.length>20,true);
  await signIn('visitor@readonly.test','Visitor-password-2026'); // the old password still works
  delete process.env.READ_ONLY_SCHOOL_IDS;
  assert.equal((await change(visitor,'Visitor-password-2026')).status,201,'allowed again once the school is no longer read-only');
});
