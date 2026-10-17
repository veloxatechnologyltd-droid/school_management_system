import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const socket=path.resolve(__dirname,'../../.local/postgres/socket'),database=process.env.LOCAL_DB_NAME??'school_saas_local';
const owner=new Pool({host:socket,port:55438,database,user:process.env.USER}),runtime=new Pool({host:socket,port:55438,database,user:'school_app'});
const school=randomUUID(),other=randomUUID(),members={head:randomUUID(),teacher:randomUUID(),guardian:randomUUID(),frontdesk:randomUUID()};
const users={head:'20000000-0000-4000-8000-000000000001',teacher:'20000000-0000-4000-8000-000000000002',guardian:'20000000-0000-4000-8000-000000000003',frontdesk:'20000000-0000-4000-8000-000000000004'};
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*864e5).toISOString().slice(0,10);
const weekday=((new Date(`${today}T00:00:00Z`).getUTCDay()+6)%7)+1;
let app:any,base:string,head:any,teacher:any,term:string,nextTerm:string,classA:string,classB:string,maths:string,english:string;
const BELL=[{starts:'07:30',ends:'08:30',kind:'lesson'},{starts:'08:30',ends:'09:30',kind:'lesson'},{starts:'09:30',ends:'10:00',kind:'break',label:'Break'},{starts:'10:00',ends:'11:00',kind:'lesson'}];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(method:string,url:string,body?:unknown,actor=head,expected?:number,sid=school){
  const r=await fetch(`${base}/schools/${sid}/timetable${url}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text();const value=text?JSON.parse(text):null;if(expected)assert.equal(r.status,expected,text);return value;
}
const draft=(termId=term)=>call('POST','/drafts',{operationId:randomUUID(),termId},head,201);
const lesson=(id:string,body:Record<string,unknown>,expected=200)=>call('PUT',`/${id}/lessons`,body,head,expected);
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Timetable test school',other,'Other timetable school']);
  for(const [k,role] of Object.entries({head:'headteacher',teacher:'teacher',guardian:'guardian',frontdesk:'frontdesk'}))await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[(members as any)[k],school,(users as any)[k],role]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),other,users.head]);
  const year=randomUUID();[term,nextTerm,classA,classB,maths,english]=Array.from({length:6},()=>randomUUID());
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'TT year',$3,$4)",[year,school,shift(-100),shift(250)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5),($6,$2,$3,'Term 2',$7,$8)",[term,school,year,shift(-30),shift(40),nextTerm,shift(60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'JHS 1','JHS',40),($2,$3,$4,'JHS 2','JHS',40)",[classA,classB,school,year]);
  await owner.query("INSERT INTO subjects(id,school_id,name) VALUES($1,$3,'Mathematics'),($2,$3,'English Language')",[maths,english,school]);
  head=await login('head@example.test');teacher=await login('teacher@example.test');
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});

test('timetable tables force row security and the app cannot delete from them',async()=>{
  const rows=(await runtime.query("SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('rooms','timetables','timetable_lessons')")).rows;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.relforcerowsecurity));
  for(const t of ['rooms','timetables','timetable_lessons']){assert.equal((await runtime.query(`SELECT * FROM ${t}`)).rowCount,0);assert.equal((await runtime.query(`SELECT has_table_privilege('school_app','${t}','DELETE') AS d`)).rows[0].d,false);}
});
test('a draft takes a bell schedule; breaks need a name and rows cannot overlap',async()=>{
  const d=await draft();await call('POST','/drafts',{operationId:randomUUID(),termId:term},head,409);
  await call('PUT',`/${d.id}/periods`,{periods:[{starts:'08:00',ends:'07:00',kind:'lesson'}]},head,400);
  await call('PUT',`/${d.id}/periods`,{periods:[{starts:'07:30',ends:'08:30',kind:'lesson'},{starts:'08:00',ends:'09:00',kind:'lesson'}]},head,400);
  await call('PUT',`/${d.id}/periods`,{periods:[{starts:'07:30',ends:'08:30',kind:'break'}]},head,400);
  const saved=await call('PUT',`/${d.id}/periods`,{periods:BELL},head,200);assert.equal(saved.periods.length,4);
});
test('a teacher or a room booked twice in one period is refused, naming the other lesson; the head may also teach',async()=>{
  const d=(await call('GET',`?termId=${term}`)).versions.find((v:any)=>v.status==='draft');
  const room=await call('POST','/rooms',{operationId:randomUUID(),name:'Science lab'},head,201);await call('POST','/rooms',{operationId:randomUUID(),name:' science LAB '},head,409);
  await lesson(d.id,{classId:classA,weekday:1,period:1,subjectId:maths,teacherMembershipId:members.teacher,roomId:room.id});
  const clash=await lesson(d.id,{classId:classB,weekday:1,period:1,subjectId:english,teacherMembershipId:members.teacher},409);assert.match(clash.message,/Kofi Sample already teaches JHS 1 Mathematics on Monday, 07:30–08:30/);
  const roomClash=await lesson(d.id,{classId:classB,weekday:1,period:1,subjectId:english,teacherMembershipId:members.head,roomId:room.id},409);assert.match(roomClash.message,/Science lab is already used by JHS 1/);
  await lesson(d.id,{classId:classB,weekday:1,period:1,subjectId:english,teacherMembershipId:members.head});
  await lesson(d.id,{classId:classA,weekday:1,period:3,subjectId:maths},400);// the break row
  await lesson(d.id,{classId:classA,weekday:1,period:2,teacherMembershipId:members.teacher},400);// a teacher with nothing to teach
  await lesson(d.id,{classId:classA,weekday:1,period:2,subjectId:maths,teacherMembershipId:members.guardian},404);
  // Clearing a cell frees the teacher for another class in that period.
  await lesson(d.id,{classId:classA,weekday:1,period:1});await lesson(d.id,{classId:classB,weekday:1,period:1,subjectId:english,teacherMembershipId:members.teacher});
  await assert.rejects(owner.query("UPDATE timetable_lessons SET subject_id=$1,teacher_membership_id=$2,teacher_name='Kofi Sample' WHERE timetable_id=$3 AND class_id=$4 AND weekday=1 AND period=1",[maths,members.teacher,d.id,classA]),/timetable_teacher_clash/);
  const grid=await call('GET',`/${d.id}/lessons`);assert.deepEqual(grid.items.map((l:any)=>[l.class_name,l.weekday,l.period,l.subject_name,l.teacher_name]),[['JHS 2',1,1,'English Language','Kofi Sample']]);
});
test('a bell row that holds lessons cannot become a break',async()=>{
  const d=(await call('GET',`?termId=${term}`)).versions.find((v:any)=>v.status==='draft');
  const changed=BELL.map((p,i)=>i===0?{starts:p.starts,ends:p.ends,kind:'break',label:'Assembly'}:p);
  const refused=await call('PUT',`/${d.id}/periods`,{periods:changed},head,409);assert.match(refused.message,/row 1/);
});
test('publishing freezes the version; the next draft copies it and replaces it when published',async()=>{
  const overview=await call('GET',`?termId=${term}`),d=overview.versions.find((v:any)=>v.status==='draft');
  for(let day=1;day<=5;day++)await lesson(d.id,{classId:classA,weekday:day,period:4,subjectId:maths,teacherMembershipId:members.teacher});
  const op={operationId:randomUUID()};const published=await call('POST',`/${d.id}/publish`,op,head,201);assert.equal(published.status,'published');
  assert.deepEqual(await call('POST',`/${d.id}/publish`,op,head,201),published);
  await lesson(d.id,{classId:classA,weekday:2,period:1,subjectId:english},409);await call('PUT',`/${d.id}/periods`,{periods:BELL},head,409);
  await assert.rejects(owner.query("UPDATE timetables SET periods='[]' WHERE id=$1",[d.id]),/does not change/);
  await assert.rejects(owner.query("UPDATE timetable_lessons SET label='Changed' WHERE timetable_id=$1",[d.id]),/Only a draft/);
  const next=await draft();assert.equal(next.version,2);
  const copied=await call('GET',`/${next.id}/lessons`);assert.equal(copied.items.length,6);assert.equal(copied.periods.length,4);
  await lesson(next.id,{classId:classA,weekday:1,period:4,subjectId:english,teacherMembershipId:members.teacher});
  await call('POST',`/${next.id}/publish`,{operationId:randomUUID()},head,201);
  const versions=(await call('GET',`?termId=${term}`)).versions.map((v:any)=>[v.version,v.status]);assert.deepEqual(versions,[[2,'published'],[1,'retired']]);
  // A later term with no timetable starts from this one's bell and lessons (same academic year).
  const later=await draft(nextTerm);assert.equal((await call('GET',`/${later.id}/lessons`)).items.length,6);
});
test('a teacher reads published versions only, sees their own classes, and gets today\'s lessons',async()=>{
  const overview=await call('GET',`?termId=${term}`,undefined,teacher,200);assert.ok(overview.versions.every((v:any)=>v.status!=='draft'));assert.deepEqual(overview.teachers,[]);
  const later=(await call('GET',`?termId=${nextTerm}`)).versions[0];await call('GET',`/${later.id}/lessons`,undefined,teacher,404);
  const current=overview.versions.find((v:any)=>v.status==='published');const mine=await call('GET',`/${current.id}/lessons`,undefined,teacher,200);
  assert.ok(mine.items.length>0);assert.ok(mine.items.every((l:any)=>['JHS 1','JHS 2'].includes(l.class_name)));
  await call('PUT',`/${current.id}/lessons`,{classId:classA,weekday:1,period:1},teacher,403);
  const day=await call('GET','/today',undefined,teacher,200);
  const expected=weekday>5?[]:weekday===1?[['07:30','JHS 2','English Language'],['10:00','JHS 1','English Language']]:[['10:00','JHS 1','Mathematics']];
  assert.deepEqual(day.items.map((l:any)=>[l.starts,l.class_name,l.subject]),expected);
  await owner.query("INSERT INTO school_days(id,school_id,day,is_open,reason,created_by) VALUES($1,$2,$3,false,'Public holiday',$4)",[randomUUID(),school,today,members.head]);
  const closed=await call('GET','/today',undefined,teacher,200);assert.equal(closed.items.length,0);assert.equal(closed.closed,true);
});
test('front desk and parents cannot open the timetable; another school sees nothing',async()=>{
  for(const email of ['frontdesk@example.test','guardian@example.test'])await call('GET','',undefined,await login(email),403);
  const mine=(await call('GET',`?termId=${term}`)).versions[0];
  await call('GET',`/${mine.id}/lessons`,undefined,head,404,other);
  await call('POST','/drafts',{operationId:randomUUID(),termId:term},head,404,other);
});
