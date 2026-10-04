import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
const {createApp}=require('../dist/main');
const schoolA='10000000-0000-4000-8000-000000000001';
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const runtime=new Pool({...config,user:'school_app',max:1});
const adminId=randomUUID(),adminEmail=`platform-${adminId.slice(0,8)}@example.test`,adminPassword='Platform-admin-2026!';
let app:any,base:string;
type Login={cookie:string;csrf:string};
async function login(email:string,password:string,expected=201):Promise<Login> {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(response.status,expected);
  if(expected!==201)return {cookie:'',csrf:''};
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
async function call(url:string,account?:Login,method='GET',body?:unknown) {
  const response=await fetch(`${base}${url}`,{method,headers:{'content-type':'application/json',...(account?{cookie:account.cookie,'x-csrf-token':account.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json().catch(()=>null)};
}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  const salt=randomBytes(16).toString('hex');
  await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[adminId,'Platform Admin',adminEmail,`${salt}:${scryptSync(adminPassword,salt,64).toString('hex')}`]);
  await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)',[adminId]);
});
after(async()=>{await app?.close();await runtime.end();await owner.end();});

test('only platform administrators can use platform routes or functions',async()=>{
  const head=await login('head@example.test','Synthetic-only-2026!'),teacher=await login('teacher@example.test','Synthetic-only-2026!');
  for(const account of [head,teacher]) {
    assert.equal((await call('/platform/schools',account)).status,403);
    assert.equal((await call('/platform/schools',account,'POST',{name:'Sneaky School',headteacherName:'Sneaky Person',headteacherEmail:'sneaky@example.test'})).status,403);
    assert.equal((await call(`/platform/schools/${schoolA}/enter`,account,'POST',{})).status,403);
  }
  assert.equal((await call('/platform/schools')).status,401);
  assert.equal((await call('/auth/session',head)).body.platformAdmin,false);
  const client=await runtime.connect();
  try {
    await client.query('BEGIN');await client.query("SELECT set_config('app.user_id','20000000-0000-4000-8000-000000000001',true)");
    await assert.rejects(client.query("SELECT * FROM platform_create_school('Direct Call','Direct','direct@example.test','x:y')"),/Platform administrator required/);
    await client.query('ROLLBACK');await client.query('BEGIN');
    await assert.rejects(client.query('SELECT * FROM platform_admins'),/permission denied/);
    await client.query('ROLLBACK');
  } finally {client.release();}
});

test('administrator creates a school; the headteacher must change the temporary password before working',async()=>{
  const admin=await login(adminEmail,adminPassword);
  const session=(await call('/auth/session',admin)).body;assert.equal(session.platformAdmin,true);assert.deepEqual(session.schools,[]);
  const email=`head-${randomUUID().slice(0,8)}@example.test`;
  const created=await call('/platform/schools',admin,'POST',{name:'Nyansapo Real School',headteacherName:'Efua Headteacher',headteacherEmail:email});
  assert.equal(created.status,201);
  const {schoolId,headteacher}=created.body;assert.equal(headteacher.email,email);assert.ok(headteacher.temporaryPassword.length>=16);
  const stored=(await owner.query('SELECT password_hash,must_change_password FROM users WHERE synthetic_login=$1',[email])).rows[0];
  assert.equal(stored.must_change_password,true);assert.ok(!stored.password_hash.includes(headteacher.temporaryPassword));
  assert.equal((await call('/platform/schools',admin,'POST',{name:'Another School',headteacherName:'Dup',headteacherEmail:email.toUpperCase()})).status,409);

  const head=await login(email,headteacher.temporaryPassword);
  const before=(await call('/auth/session',head)).body;assert.equal(before.mustChangePassword,true);assert.equal(before.schools[0].id,schoolId);
  const blocked=await call(`/schools/${schoolId}`,head);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('/auth/change-password',head,'POST',{currentPassword:'wrong-password-value',newPassword:'A-Brand-New-Passphrase-1'})).status,401);
  assert.equal((await call('/auth/change-password',head,'POST',{currentPassword:headteacher.temporaryPassword,newPassword:'short'})).status,400);
  assert.equal((await call('/auth/change-password',head,'POST',{currentPassword:headteacher.temporaryPassword,newPassword:'A-Brand-New-Passphrase-1'})).status,201);
  const school=await call(`/schools/${schoolId}`,head);assert.equal(school.status,200);assert.equal(school.body.role,'headteacher');
  await login(email,headteacher.temporaryPassword,401);
  const again=await login(email,'A-Brand-New-Passphrase-1');assert.equal((await call('/auth/session',again)).body.mustChangePassword,false);
  assert.equal((await call(`/schools/${schoolA}`,again)).status,404);
  const audit=(await call(`/schools/${schoolId}/audit?limit=100`,again)).body.items.map((row:any)=>row.action);assert.ok(audit.includes('platform.school.created'));
  const listed=(await call('/platform/schools?limit=100',admin)).body;assert.ok(listed.items.some((row:any)=>row.id===schoolId&&row.headteachers===1));
});

test('administrator can add staff, reset passwords, and every support entry is audited for the school',async()=>{
  const admin=await login(adminEmail,adminPassword);
  const created=(await call('/platform/schools',admin,'POST',{name:'Support Test School',headteacherName:'Kwame Head',headteacherEmail:`support-${randomUUID().slice(0,8)}@example.test`})).body;
  const schoolId=created.schoolId;
  const teacherEmail=`teacher-${randomUUID().slice(0,8)}@example.test`;
  const teacher=await call(`/platform/schools/${schoolId}/users`,admin,'POST',{name:'Yaw Teacher',email:teacherEmail,role:'teacher'});assert.equal(teacher.status,201);
  assert.equal((await call(`/platform/schools/${schoolId}/users`,admin,'POST',{name:'Bad Role',email:'bad@example.test',role:'platform_admin'})).status,400);
  assert.equal((await call(`/platform/schools/${schoolId}/users`,admin,'POST',{name:'Dup Teacher',email:teacherEmail,role:'teacher'})).status,409);
  assert.equal((await call(`/platform/schools/${randomUUID()}/users`,admin,'POST',{name:'Ghost',email:'ghost@example.test',role:'teacher'})).status,404);

  const staffSession=await login(teacherEmail,teacher.body.temporaryPassword);
  const reset=await call(`/platform/schools/${schoolId}/users/${teacher.body.userId}/reset-password`,admin,'POST',{});assert.equal(reset.status,201);
  assert.equal((await call('/auth/session',staffSession)).status,401);
  await login(teacherEmail,teacher.body.temporaryPassword,401);await login(teacherEmail,reset.body.temporaryPassword);

  assert.equal((await call(`/schools/${schoolId}`,admin)).status,404);
  const entered=await call(`/platform/schools/${schoolId}/enter`,admin,'POST',{});assert.equal(entered.status,201);
  const opened=await call(`/schools/${schoolId}`,admin);assert.equal(opened.status,200);assert.equal(opened.body.name,'Support Test School');
  assert.ok((await call('/auth/session',admin)).body.schools.some((row:any)=>row.id===schoolId));
  const actions=(await call(`/schools/${schoolId}/audit?limit=100`,admin)).body.items.map((row:any)=>row.action);
  for(const action of ['platform.school.created','platform.user.created','platform.password.reset','platform.support_access.entered'])assert.ok(actions.includes(action),action);

  await owner.query('DELETE FROM platform_admins WHERE user_id=$1',[adminId]);
  try {
    assert.equal((await call(`/schools/${schoolId}`,admin)).status,404);assert.equal((await call('/platform/schools',admin)).status,403);
  } finally {await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)',[adminId]);}
});

test('password sign-in is off unless AUTH_MODE=password or synthetic loopback development is enabled',async()=>{
  const priorDev=process.env.DEV_AUTH,priorMode=process.env.AUTH_MODE;
  try {
    delete process.env.DEV_AUTH;delete process.env.AUTH_MODE;await login(adminEmail,adminPassword,403);
    process.env.AUTH_MODE='password';await login(adminEmail,adminPassword);
  } finally {
    if(priorDev===undefined)delete process.env.DEV_AUTH;else process.env.DEV_AUTH=priorDev;
    if(priorMode===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=priorMode;
  }
});

test('anyone can register a school and become its headteacher, without verification',async()=>{
  const email=`owner-${randomUUID().slice(0,8)}@example.test`,body={name:'Self Owner',schoolName:'Self Registered School',email,password:'Chosen-password-2026'};
  assert.equal((await call('/auth/register',undefined,'POST',{...body,password:'short'})).status,400);
  const response=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,201);
  const account={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
  const session=(await call('/auth/session',account)).body;
  assert.equal(session.mustChangePassword,false);assert.equal(session.platformAdmin,false);
  assert.equal(session.schools.length,1);assert.equal(session.schools[0].name,'Self Registered School');assert.equal(session.schools[0].role,'headteacher');
  assert.equal((await call('/platform/schools',account)).status,403);
  assert.equal((await call('/auth/register',undefined,'POST',body)).status,409);
  await login(email,body.password);
});
