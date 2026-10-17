import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),cls=randomUUID(),elsewhere=randomUUID();
const [headM,teacherM,guardianM,deskM,otherTeacherM]=Array.from({length:5},()=>randomUUID());
const [headU,teacherU,guardianU,deskU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const [ama,kojo,otherChild]=Array.from({length:3},()=>randomUUID());
let app:any,base:string,head:any,teacher:any,guardian:any,desk:any;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,id=school){const r=await fetch(`${base}/schools/${id}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json().catch(()=>null)};}
const put=(route:string,body:Record<string,unknown>,actor=head,id=school)=>call(route,'PUT',{operationId:randomUUID(),...body},actor,id);
const full={nationality:'Ghanaian',religion:'Muslim',homeAddress:'Plot 12, Millennium City, Kasoa',previousSchool:'Little Angels School',bloodGroup:'O+',healthNotes:'Allergic to groundnuts; carries an inhaler',
  emergencyName:'Kojo Appiah',emergencyRelationship:'Uncle',emergencyPhone:'024 555 9876'};
const auditOf=(action:string,target:string)=>owner.query("SELECT metadata FROM audit_events WHERE school_id=$1 AND action=$2 AND target_id=$3 ORDER BY created_at",[school,action,target]).then(r=>r.rows.map(x=>x.metadata));

before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,desk]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Details school'),($2,'Other details school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$5,$6,'headteacher'),($2,$5,$7,'teacher'),($3,$5,$8,'guardian'),($4,$5,$9,'frontdesk')",[headM,teacherM,guardianM,deskM,school,headU,teacherU,guardianU,deskU]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'teacher'),($4,$2,$5,'headteacher')",[otherTeacherM,other,teacherU,randomUUID(),headU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Details year',$3,$4)",[year,school,shift(-60),shift(200)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 4','Primary',30),($2,$3,$4,'Basic 6','Primary',30)",[cls,elsewhere,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Class teacher',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(150),headM]);
  for(const [id,name,c] of [[ama,'Ama Details',cls],[kojo,'Kojo Details',cls],[otherChild,'Yaw Elsewhere',elsewhere]] as const){
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`PD-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,c,shift(-30)]);}
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});

test('a student has no details until the head records some, and every field is optional',async()=>{
  const empty=(await call(`/learners/${ama}/profile`)).body.details;
  assert.deepEqual(empty,{version:0,updatedAt:null,canEdit:true,nationality:null,religion:null,homeAddress:null,previousSchool:null,bloodGroup:null,healthNotes:null,emergencyName:null,emergencyRelationship:null,emergencyPhone:null});
  // Saving nothing leaves the record unsaved, with no audit trail.
  assert.deepEqual((await put(`/learners/${ama}/details`,{version:0})).body,{version:0});
  assert.equal((await owner.query('SELECT count(*) FROM learner_details WHERE school_id=$1',[school])).rows[0].count,'0');
  // Only a previous school: religion, health and the rest stay empty.
  assert.deepEqual((await put(`/learners/${ama}/details`,{version:0,previousSchool:'Little Angels School'})).body,{version:1});
  const p=(await call(`/learners/${ama}/profile`)).body.details;
  assert.equal(p.previousSchool,'Little Angels School');assert.equal(p.religion,null);assert.equal(p.healthNotes,null);assert.equal(p.bloodGroup,null);assert.equal(p.version,1);
});

test('the whole record is saved, the number is kept as +233, the version guards against two people editing, and an empty field clears',async()=>{
  const saved=await put(`/learners/${ama}/details`,{...full,version:1});assert.deepEqual(saved.body,{version:2});
  const d=(await call(`/learners/${ama}/profile`)).body.details;
  assert.deepEqual([d.nationality,d.religion,d.homeAddress,d.bloodGroup,d.healthNotes,d.emergencyName,d.emergencyRelationship,d.emergencyPhone,d.version],['Ghanaian','Muslim','Plot 12, Millennium City, Kasoa','O+','Allergic to groundnuts; carries an inhaler','Kojo Appiah','Uncle','+233245559876',2]);
  assert.equal((await put(`/learners/${ama}/details`,{...full,version:1})).status,409,'an old copy cannot overwrite');
  assert.equal((await put(`/learners/${ama}/details`,{...full,version:0})).status,409);
  // Same values again: nothing changes, so the version stays and nothing is audited.
  assert.deepEqual((await put(`/learners/${ama}/details`,{...full,version:2})).body,{version:2});
  assert.equal((await auditOf('learner.details.updated',ama)).length,2);
  // Leaving religion, health and blood group empty removes them; the rest stays.
  assert.deepEqual((await put(`/learners/${ama}/details`,{...full,religion:'',healthNotes:'',bloodGroup:'',version:2})).body,{version:3});
  const cleared=(await call(`/learners/${ama}/profile`)).body.details;
  assert.deepEqual([cleared.religion,cleared.healthNotes,cleared.bloodGroup,cleared.nationality],[null,null,null,'Ghanaian']);
  // A retried request is applied once.
  const body={operationId:randomUUID(),...full,previousSchool:'Retry Academy',version:3};
  const a=await call(`/learners/${ama}/details`,'PUT',body),b=await call(`/learners/${ama}/details`,'PUT',body);
  assert.deepEqual([a.status,b.status,a.body.version,b.body.version],[200,200,4,4]);
});

test('the audit trail names the fields that changed and never their values',async()=>{
  const events=await auditOf('learner.details.updated',ama);
  assert.deepEqual(events[0].fields,['previous_school']);
  assert.deepEqual(events[1].fields.sort(),['blood_group','emergency_name','emergency_phone','emergency_relationship','health_notes','home_address','nationality','religion'].sort());
  const text=JSON.stringify(events);for(const secret of ['Muslim','groundnuts','O+','Kojo Appiah','Millennium','5559876'])assert.ok(!text.includes(secret),`${secret} must not be in the audit log`);
});

test('a teacher reads only what keeps a child safe in class, and cannot change anything',async()=>{
  const d=(await call(`/learners/${ama}/profile`,'GET',undefined,teacher)).body.details;
  assert.equal(d.canEdit,false);assert.deepEqual(Object.keys(d).sort(),['bloodGroup','canEdit','emergencyName','emergencyPhone','emergencyRelationship','healthNotes','previousSchool','updatedAt','version']);
  await put(`/learners/${kojo}/details`,{...full,version:0});
  const k=(await call(`/learners/${kojo}/profile`,'GET',undefined,teacher)).body.details;
  assert.equal(k.healthNotes,'Allergic to groundnuts; carries an inhaler');assert.equal(k.bloodGroup,'O+');assert.equal(k.emergencyPhone,'+233245559876');
  assert.ok(!('religion' in k)&&!('homeAddress' in k)&&!('nationality' in k),'those are the head\'s');
  for(const actor of [teacher,guardian,desk])assert.equal((await put(`/learners/${ama}/details`,{version:4,...full},actor)).status,403);
  assert.equal((await call(`/learners/${otherChild}/profile`,'GET',undefined,teacher)).status,404,'not their class');
});

test('details are refused when they are wrong, in plain words, and stay inside the school',async()=>{
  const bad=async(patch:Record<string,unknown>,status=400,text?:RegExp)=>{const r=await put(`/learners/${kojo}/details`,{version:1,...patch});assert.equal(r.status,status,JSON.stringify(r.body));if(text)assert.match(JSON.stringify(r.body),text);};
  await bad({religion:'Jedi'});await bad({bloodGroup:'Z+'});await bad({emergencyName:'Kojo Appiah',emergencyPhone:'12345'},400,/Ghana mobile number/);
  await bad({emergencyRelationship:'Uncle'},400,/contact's name/);await bad({nationality:'G'},400,/Nationality must be 2 to 60/);
  await bad({homeAddress:'x'.repeat(201)});await bad({unknownField:'x'});await bad({version:-1});
  assert.equal((await put(`/learners/${randomUUID()}/details`,{version:0})).status,404);
  assert.equal((await put(`/learners/not-an-id/details`,{version:0})).status,400);
  assert.equal((await put(`/learners/${ama}/details`,{version:0},head,other)).status,404,'a student of this school is not found through another school');
  assert.equal((await call(`/learners/${ama}/profile`,'GET',undefined,head,other)).status,404);
});

test('the tables keep school isolation, force row security and never delete',async()=>{
  for(const table of ['learner_details','staff_details']){
    assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount,0,'no school context, no rows');
    const forced=(await runtime.query("SELECT relforcerowsecurity FROM pg_class WHERE relname=$1",[table])).rows[0];assert.equal(forced.relforcerowsecurity,true);
    assert.equal((await runtime.query("SELECT has_table_privilege('school_app',$1,'DELETE') AS d",[table])).rows[0].d,false);}
  await assert.rejects(runtime.query("UPDATE learner_details SET learner_id=$1",[ama]),/permission denied/);
});

const staff={staffNumber:'SIS-T-014',jobTitle:'Class teacher',qualification:'B.Ed. Basic Education',licenceNumber:'NTC-2021-04418',dateJoined:'2021-09-06',employmentType:'Full time',subjects:'Mathematics, Science',
  homeAddress:'House 4, Ofaakor, Kasoa',emergencyName:'Efua Sample',emergencyRelationship:'Spouse',emergencyPhone:'0201234567'};
test('the head records a staff member\'s details; only the head can, and only for staff of this school',async()=>{
  const empty=(await call(`/accounts/${teacherM}`)).body.details;assert.equal(empty.version,0);assert.equal(empty.jobTitle,null);assert.equal(empty.dateJoined,null);
  assert.deepEqual((await put(`/accounts/${teacherM}/details`,{...staff,version:0})).body,{version:1});
  const d=(await call(`/accounts/${teacherM}`)).body.details;
  assert.deepEqual([d.staffNumber,d.jobTitle,d.qualification,d.licenceNumber,d.dateJoined,d.employmentType,d.subjects,d.emergencyPhone,d.version],['SIS-T-014','Class teacher','B.Ed. Basic Education','NTC-2021-04418','2021-09-06','Full time','Mathematics, Science','+233201234567',1]);
  assert.equal((await put(`/accounts/${teacherM}/details`,{...staff,version:0})).status,409);
  for(const actor of [teacher,guardian,desk])assert.equal((await put(`/accounts/${teacherM}/details`,{...staff,version:1},actor)).status,403);
  assert.equal((await put(`/accounts/${guardianM}/details`,{version:0,jobTitle:'Parent'})).status,404,'a parent is not staff');
  assert.equal((await put(`/accounts/${otherTeacherM}/details`,{version:0,jobTitle:'Elsewhere'})).status,404,'a member of another school');
  assert.equal((await put(`/accounts/${randomUUID()}/details`,{version:0})).status,404);
  // The change shows in the person's activity, and the audit trail has field names only.
  const events=await owner.query("SELECT metadata FROM audit_events WHERE school_id=$1 AND action='staff.details.updated' AND target_id=$2",[school,teacherM]);
  assert.equal(events.rowCount,1);assert.ok(!JSON.stringify(events.rows).includes('NTC-2021'));
  assert.ok((await call(`/accounts/${headM}`)).body.activity.items.some((i:any)=>i.text==='Updated a staff member\'s details'));
});

test('staff details are optional too, validated, and a staff number belongs to one person in a school',async()=>{
  assert.deepEqual((await put(`/accounts/${deskM}/details`,{version:0,jobTitle:'Front desk officer'})).body,{version:1});
  assert.equal((await put(`/accounts/${deskM}/details`,{version:1,staffNumber:'sis-t-014'})).status,409,'the same number in another letter case is the same number');
  assert.equal((await put(`/accounts/${deskM}/details`,{version:1,staffNumber:'SIS-F-001'})).status,200);
  assert.equal((await put(`/accounts/${otherTeacherM}/details`,{version:0,staffNumber:'SIS-T-014'},head,other)).status,200,'another school may use the same number');
  const bad=async(patch:Record<string,unknown>,text?:RegExp)=>{const r=await put(`/accounts/${deskM}/details`,{version:2,...patch});assert.equal(r.status,400,JSON.stringify(r.body));if(text)assert.match(JSON.stringify(r.body),text);};
  await bad({employmentType:'Pirate'});await bad({dateJoined:'2026-02-30'});await bad({dateJoined:'last year'});await bad({emergencyName:'Kofi',emergencyPhone:'999'},/Ghana mobile number/);await bad({jobTitle:'x'},/Job title must be 2 to 60/);
  // Clearing the number frees it.
  assert.equal((await put(`/accounts/${deskM}/details`,{version:2,staffNumber:''})).status,200);
  assert.equal((await put(`/accounts/${headM}/details`,{version:0,staffNumber:'SIS-F-001'})).status,200);
});
