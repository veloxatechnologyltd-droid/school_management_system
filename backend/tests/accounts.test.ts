import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const schoolA='10000000-0000-4000-8000-000000000001';
const schoolB='10000000-0000-4000-8000-000000000002';
let app:any,base:string;
type Login={cookie:string;csrf:string};
async function login(email:string,password='Synthetic-only-2026!',expected=201):Promise<Login> {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(response.status,expected);
  if(expected!==201)return {cookie:'',csrf:''};
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
async function call(url:string,account:Login,method='GET',body?:unknown) {
  const response=await fetch(`${base}${url}`,{method,headers:{'content-type':'application/json',cookie:account.cookie,'x-csrf-token':account.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json().catch(()=>null)};
}
before(async()=>{process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;});
after(async()=>{await app?.close();});

test('only headteachers manage accounts, and only inside their own school',async()=>{
  const head=await login('head@example.test'),teacher=await login('teacher@example.test'),guardian=await login('guardian@example.test'),desk=await login('frontdesk@example.test');
  for(const account of [teacher,guardian,desk]){assert.equal((await call(`/schools/${schoolA}/accounts`,account)).status,403);assert.equal((await call(`/schools/${schoolA}/accounts`,account,'POST',{name:'X Person',email:'x@example.test',role:'teacher'})).status,403);}
  const list=await call(`/schools/${schoolA}/accounts`,head);assert.equal(list.status,200);
  assert.ok(list.body.items.some((row:any)=>row.login==='teacher@example.test'&&row.role==='teacher'));
  assert.ok(list.body.items.every((row:any)=>row.login!=='head@example.test'||row.role==='headteacher'));
  const other=await call(`/schools/${schoolB}/accounts`,head);assert.equal(other.status,200);
  assert.ok(!other.body.items.some((row:any)=>row.login==='teacher@example.test'),'school B list must not include school A staff');
  assert.equal((await call(`/schools/${schoolB}/accounts/${list.body.items.find((row:any)=>row.login==='teacher@example.test').user_id}/reset-password`,head,'POST',{})).status,404);
});

test('headteacher creates, resets and revokes school accounts with an audit trail',async()=>{
  const head=await login('head@example.test'),email=`new-teacher-${randomUUID().slice(0,8)}@example.test`;
  const created=await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Ama Newteacher',email,role:'teacher'});assert.equal(created.status,201);
  assert.equal((await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Ama Dup',email:email.toUpperCase(),role:'teacher'})).status,409);
  assert.equal((await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Bad Role',email:'badrole@example.test',role:'headteacher'})).status,400);
  const first=await login(email,created.body.temporaryPassword);
  const blocked=await call(`/schools/${schoolA}`,first);assert.equal(blocked.body.code,'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('/auth/change-password',first,'POST',{currentPassword:created.body.temporaryPassword,newPassword:'Teacher-passphrase-2026'})).status,201);
  const session=await login(email,'Teacher-passphrase-2026');assert.equal((await call(`/schools/${schoolA}`,session)).body.role,'teacher');

  const reset=await call(`/schools/${schoolA}/accounts/${created.body.userId}/reset-password`,head,'POST',{});assert.equal(reset.status,201);
  assert.equal((await call('/auth/session',session)).status,401);await login(email,'Teacher-passphrase-2026',401);await login(email,reset.body.temporaryPassword);

  assert.equal((await call(`/schools/${schoolA}/accounts/${created.body.userId}/revoke`,head,'POST',{})).status,201);
  const afterRevoke=await login(email,reset.body.temporaryPassword);assert.equal((await call('/auth/session',afterRevoke)).body.schools.length,0);
  assert.ok([403,404].includes((await call(`/schools/${schoolA}`,afterRevoke)).status));
  const headUser=(await call(`/schools/${schoolA}/accounts`,head)).body.items.find((row:any)=>row.login==='head@example.test');
  assert.equal((await call(`/schools/${schoolA}/accounts/${headUser.user_id}/revoke`,head,'POST',{})).status,400);
  const actions=(await call(`/schools/${schoolA}/audit?limit=100`,head)).body.items.map((row:any)=>row.action);
  for(const action of ['account.created','account.password_reset','account.revoked'])assert.ok(actions.includes(action),action);
});

test('guardians without email get a phone-number sign-in that also receives notices',async()=>{
  const head=await login('head@example.test'),digits=String(Math.floor(1e7+Math.random()*9e7)).slice(0,7);
  const created=await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Akua Phoneonly',email:`024 ${digits.slice(0,3)} ${digits.slice(3)}`,role:'guardian'});
  assert.equal(created.status,201);assert.equal(created.body.email,`+23324${digits}`);
  const row=(await call(`/schools/${schoolA}/accounts`,head)).body.items.find((item:any)=>item.user_id===created.body.userId);
  assert.equal(row.login,`+23324${digits}`);assert.equal(row.phone,`+23324${digits}`);
  // Signs in with the number written the way people type it.
  await login(`024${digits}`,created.body.temporaryPassword);await login(`+233 24 ${digits}`,created.body.temporaryPassword);
  assert.equal((await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Same Number',email:`+23324${digits}`,role:'guardian'})).status,409);
  assert.equal((await call(`/schools/${schoolA}/accounts`,head,'POST',{name:'Not Contact',email:'not a contact',role:'guardian'})).status,400);
});
