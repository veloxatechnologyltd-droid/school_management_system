import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
// Gaps found by running a school through a full term: report card details, fee adjustments, class fee items, arrears, learner sex, school details.
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),cls=randomUUID(),jhs3=randomUUID(),headM=randomUUID(),acctM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID();
const [headU,teacherU,guardianU,acctU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,acct:any,term1:string,term2:string,maths:string;const kids:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,acct]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Term operations school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$5,$6,'headteacher'),($2,$5,$7,'teacher'),($3,$5,$8,'guardian'),($4,$5,$9,'accountant')",[headM,teacherM,guardianM,acctM,school,headU,teacherU,guardianU,acctU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Ops year',$3,$4)",[year,school,shift(-90),shift(200)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'JHS 3','JHS',30)",[cls,jhs3,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic class teacher',$7)",[randomUUID(),school,cls,teacherM,shift(-80),shift(150),headM]);
  for(const name of ['Ama Report','Kojo Report']){const id=randomUUID();kids.push(id);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`OP-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-85)]);}
  // Left the class during Term 1 with no scores.
  const leaver=randomUUID();kids.push(leaver);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Esi Leftearly')",[leaver,school,`OP-${leaver.slice(0,8)}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date,end_date,end_reason) VALUES($1,$2,$3,$4,$5,$6,'Relocated')",[randomUUID(),school,leaver,cls,shift(-85),shift(-40)]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,true,false,true,now(),$5,'Synthetic access')",[randomUUID(),school,kids[0],guardianM,headM]);
  term1=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-80),endDate:shift(-10)})).id;
  term2=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 2',startDate:shift(5),endDate:shift(90)})).id;
});
after(async()=>{await app?.close();await owner.end();});

test('school details are kept for report cards and receipts; empty clears',async()=>{
  const current=(await call('')).body;
  const saved=(await call('','PATCH',{name:current.name,version:current.version,address:'P.O. Box 12, Kasoa, Central Region',phone:'024 000 0000',motto:'Knowledge and service'})).body;
  assert.equal(saved.address,'P.O. Box 12, Kasoa, Central Region');assert.equal(saved.motto,'Knowledge and service');
  const kept=(await call('','PATCH',{name:current.name,version:saved.version})).body;assert.equal(kept.motto,'Knowledge and service');
  assert.equal((await call('','PATCH',{name:current.name,version:kept.version,motto:'x'})).status,400);
  assert.equal((await call('','PATCH',{name:current.name,version:kept.version,phone:'0240000000'},teacher)).status,403);
});

test('the headteacher sets a school logo every member can load; others cannot change it',async()=>{
  // A 1x1 PNG.
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await call('')).body.logo_tag,null);
  const image=(actor:any,id=school)=>fetch(`${base}/schools/${id}/logo`,{headers:{cookie:actor.cookie}});
  assert.equal((await image(head)).status,404,'no logo yet');
  assert.equal((await call('/logo','PUT',{logo:png},teacher)).status,403);assert.equal((await call('/logo','PUT',{logo:png},acct)).status,403);
  assert.equal((await call('/logo','PUT',{logo:'data:image/svg+xml;base64,PHN2Zz4='})).status,400,'SVG is refused');
  assert.equal((await call('/logo','PUT',{logo:'data:image/png;base64,'+'A'.repeat(98000)})).status,400,'too large');
  const saved=(await call('/logo','PUT',{logo:png})).body;assert.match(saved.logo_tag,/^[0-9a-f]{12}$/);
  assert.equal((await call('')).body.logo_tag,saved.logo_tag);assert.equal((await call('','GET',undefined,guardian)).body.logo_tag,saved.logo_tag);
  for(const actor of [head,teacher,guardian,acct]){const r=await image(actor);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await r.arrayBuffer()).subarray(1,4).toString(),'PNG');}
  assert.equal((await fetch(`${base}/schools/${school}/logo`)).status,401,'signed-out visitors cannot load it');
  assert.equal((await image(head,randomUUID())).status,404,'another school is unavailable');
  assert.equal((await call('/logo','PUT',{logo:null})).body.logo_tag,null);assert.equal((await image(head)).status,404);
  const actions=(await call('/audit?limit=50')).body.items.map((row:any)=>row.action);assert.ok(actions.includes('school.logo.updated')&&actions.includes('school.logo.removed'));
});

test('report cards carry attendance, conduct, remarks and the next term date; remarks lock with the report',async()=>{
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  await ok('/assessment/policy','PUT',{caWeight:30,examWeight:70,bands:[{min:50,grade:'1',remark:'Pass'},{min:0,grade:'9',remark:'Lowest'}],sourceNote:'Ops policy'},head,200);
  for(const [i,day] of [shift(-20),shift(-19),shift(-18)].entries()){
    await ok('/attendance/school-days','POST',{day,isOpen:true,reason:'Normal day'});
    const page=(await call(`/attendance/classes/${cls}/register?day=${day}`,'GET',undefined,teacher)).body;
    const marks=page.items.map((row:any)=>({learnerId:row.id,mark:row.id===kids[1]&&i<2?'absent':i===2?'late':'present'}));
    const draft=await ok(`/attendance/classes/${cls}/register`,'POST',{day,version:page.version,action:'save',marks},teacher);
    await ok(`/attendance/classes/${cls}/register`,'POST',{day,version:draft.version,action:'submit',marks},teacher);
  }
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId:term1,subjectId:maths,scores:kids.slice(0,2).flatMap(id=>[{learnerId:id,kind:'ca',score:60},{learnerId:id,kind:'exam',score:70}])},teacher);
  assert.equal((await call(`/assessment/classes/${cls}/remarks`,'POST',{operationId:randomUUID(),termId:term1,author:'headteacher',items:[{learnerId:kids[0],remark:'Keep it up'}]},teacher)).status,403);
  assert.equal((await call(`/assessment/classes/${cls}/remarks`,'POST',{operationId:randomUUID(),termId:term1,author:'class_teacher',items:[{learnerId:randomUUID(),remark:'Unknown'}]},teacher)).status,404);
  await ok(`/assessment/classes/${cls}/remarks`,'POST',{termId:term1,author:'class_teacher',items:[{learnerId:kids[0],conduct:'Very good',attitude:'Hardworking',interest:'Football',remark:'A focused learner'},{learnerId:kids[1],conduct:'Good',remark:'Must attend school regularly'}]},teacher);
  const again=await ok(`/assessment/classes/${cls}/remarks`,'POST',{termId:term1,author:'class_teacher',items:[{learnerId:kids[0],conduct:'Very good',attitude:'Hardworking',interest:'Football',remark:'A focused learner'}]},teacher);
  assert.deepEqual(again,{written:0,unchanged:1});
  await ok(`/assessment/classes/${cls}/remarks`,'POST',{termId:term1,author:'headteacher',items:[{learnerId:kids[0],remark:'Excellent work. Promoted.'}]});
  const listed=(await call(`/assessment/classes/${cls}/remarks?termId=${term1}`,'GET',undefined,teacher)).body.items.find((row:any)=>row.learnerId===kids[0]);
  assert.equal(listed.teacherRemark,'A focused learner');assert.equal(listed.headRemark,'Excellent work. Promoted.');assert.equal(listed.interest,'Football');
  await call('','PATCH',{name:'Term operations school',version:(await call('')).body.version,address:'P.O. Box 12, Kasoa'});
  assert.equal((await call(`/assessment/classes/${cls}/results?termId=${term1}`)).body.classSize,2,'a learner who left is not counted');
  assert.deepEqual(await ok(`/assessment/classes/${cls}/publish`,'POST',{termId:term1}),{published:2,alreadyPublished:0,incomplete:0});
  const report=(await call(`/guardian/children/${kids[0]}/terminal-reports`,'GET',undefined,guardian)).body.items[0].snapshot;
  assert.deepEqual(report.attendance,{present:3,possible:3});assert.equal(report.conduct,'Very good');assert.equal(report.teacherRemark,'A focused learner');assert.equal(report.headRemark,'Excellent work. Promoted.');
  assert.equal(report.nextTermBegins,shift(5));assert.equal(report.yearName,'Ops year');assert.equal(report.school.address,'P.O. Box 12, Kasoa');assert.equal(report.school.name,'Term operations school');
  const other=(await owner.query('SELECT snapshot FROM terminal_reports WHERE school_id=$1 AND learner_id=$2',[school,kids[1]])).rows[0].snapshot;assert.deepEqual(other.attendance,{present:1,possible:3});
  const printed=(await call(`/assessment/classes/${cls}/reports?termId=${term1}`,'GET',undefined,teacher)).body.items;
  assert.deepEqual(printed.map((row:any)=>row.snapshot.learner.fullName),['Ama Report','Kojo Report']);assert.equal((await call(`/assessment/classes/${cls}/reports?termId=${term1}`,'GET',undefined,guardian)).status,403);
  const locked=await call(`/assessment/classes/${cls}/remarks`,'POST',{operationId:randomUUID(),termId:term1,author:'class_teacher',items:[{learnerId:kids[0],remark:'Changed after publishing'}]},teacher);assert.equal(locked.status,409);
  await assert.rejects(owner.query('UPDATE terminal_report_remarks SET remark=$1',['x']),/append-only/);
});

test('class fee items, reasoned discounts and charges, and arrears on the next bill',async()=>{
  await ok('/finance/fee-items','POST',{termId:term1,name:'Tuition',amountPesewas:100000},acct);
  await ok('/finance/fee-items','POST',{termId:term1,name:'BECE mock',amountPesewas:10000,classId:jhs3},acct);
  assert.equal((await call('/finance/fee-items','POST',{operationId:randomUUID(),termId:term1,name:'Both',amountPesewas:100,classId:jhs3,level:'JHS'},acct)).status,400);
  assert.equal((await ok('/finance/invoices/generate','POST',{termId:term1,classId:cls},acct)).totalPerLearnerPesewas,100000,'BECE mock is only for JHS 3');
  const invoice=(await call(`/finance/invoices?termId=${term1}`,'GET',undefined,acct)).body.items.find((row:any)=>row.learner_id===kids[0]);
  const discount={kind:'discount',label:'Staff ward',amountPesewas:25000,reason:'Child of a member of staff: 25% off tuition (board decision)'};
  assert.equal((await call(`/finance/invoices/${invoice.id}/adjustments`,'POST',{operationId:randomUUID(),...discount},acct)).status,403);
  assert.equal((await ok(`/finance/invoices/${invoice.id}/adjustments`,'POST',discount)).balancePesewas,75000);
  assert.equal((await ok(`/finance/invoices/${invoice.id}/adjustments`,'POST',{kind:'charge',label:'Balance from old records',amountPesewas:5000,reason:'Term 3 2024/25 balance in the old fees book'},acct)).balancePesewas,80000);
  assert.equal((await call(`/finance/invoices/${invoice.id}/adjustments`,'POST',{operationId:randomUUID(),...discount,amountPesewas:80001})).status,409,'a bill cannot go below zero');
  assert.equal((await call(`/finance/invoices/${invoice.id}/adjustments`,'POST',{operationId:randomUUID(),...discount},teacher)).status,403);
  assert.equal((await call('/finance/payments','POST',{operationId:randomUUID(),invoiceId:invoice.id,amountPesewas:80001,method:'cash',receivedOn:today},acct)).status,409);
  await ok('/finance/payments','POST',{invoiceId:invoice.id,amountPesewas:30000,method:'cash',receivedOn:today},acct);
  const listed=(await call(`/finance/invoices?termId=${term1}`,'GET',undefined,acct)).body.items.find((row:any)=>row.id===invoice.id);
  assert.equal(listed.total_pesewas,100000);assert.equal(listed.due_pesewas,80000);assert.equal(listed.balance_pesewas,50000);assert.equal(listed.adjustments.length,2);
  const summary=(await call(`/finance/summary?termId=${term1}`,'GET',undefined,acct)).body;assert.equal(summary.adjustmentsPesewas,-20000);assert.equal(summary.billedPesewas,280000,'the learner who left mid-term is billed too');
  // Next term's bill shows what is still owed from Term 1 without moving it.
  await ok('/finance/fee-items','POST',{termId:term2,name:'Tuition',amountPesewas:100000},acct);
  await ok('/finance/invoices/generate','POST',{termId:term2,classId:cls},acct);
  const next=(await call(`/finance/invoices?termId=${term2}`,'GET',undefined,acct)).body.items;
  assert.equal(next.find((row:any)=>row.learner_id===kids[0]).arrears_pesewas,50000);assert.equal(next.find((row:any)=>row.learner_id===kids[1]).arrears_pesewas,100000);
  // Kojo paid Term 1 in full, then was granted a bursary: the overpayment is a credit on the next bill.
  const kojo=(await call(`/finance/invoices?termId=${term1}`,'GET',undefined,acct)).body.items.find((row:any)=>row.learner_id===kids[1]);
  await ok('/finance/payments','POST',{invoiceId:kojo.id,amountPesewas:100000,method:'bank',receivedOn:today},acct);
  assert.equal((await ok(`/finance/invoices/${kojo.id}/adjustments`,'POST',{kind:'discount',label:'Bursary',amountPesewas:20000,reason:'Academic bursary awarded after payment'})).balancePesewas,-20000);
  assert.equal((await call(`/finance/invoices?termId=${term2}`,'GET',undefined,acct)).body.items.find((row:any)=>row.learner_id===kids[1]).arrears_pesewas,-20000);
  const statement=(await call(`/guardian/children/${kids[0]}/statement`,'GET',undefined,guardian)).body.items.find((row:any)=>row.id===invoice.id);
  assert.equal(statement.balance_pesewas,50000);assert.equal(statement.adjustments[0].label,'Staff ward');
  const actions=(await call('/audit?limit=100')).body.items.map((row:any)=>row.action);for(const a of ['finance.invoice.discount','finance.invoice.charge'])assert.ok(actions.includes(a),a);
});

test('fee reminders reach only the families who still owe on that term',async()=>{
  assert.equal((await call('/notices','POST',{operationId:randomUUID(),title:'Fees reminder',body:'Please clear the balance.',audience:'owing'})).status,400);
  const owing=await ok('/notices','POST',{title:'Fees reminder',body:'Term 1 fees are overdue. Please see the bursar.',audience:'owing',termId:term1});
  assert.equal((await ok(`/notices/${owing.id}/approve`,'POST',{version:owing.version})).recipients,1,'Ama still owes on Term 1');
  const listed=(await call('/notices')).body.items.find((row:any)=>row.id===owing.id);assert.equal(listed.term_name,'Term 1');
  assert.ok((await call('/guardian/notices','GET',undefined,guardian)).body.items.some((row:any)=>row.title==='Fees reminder'));
  // Pay the balance: nobody owes on Term 1 any more, so a new reminder has no recipients.
  const inv=(await call(`/finance/invoices?termId=${term1}`,'GET',undefined,acct)).body.items.find((row:any)=>row.learner_id===kids[0]);
  await ok('/finance/payments','POST',{invoiceId:inv.id,amountPesewas:inv.balance_pesewas,method:'cash',receivedOn:today},acct);
  const none=await ok('/notices','POST',{title:'Fees reminder 2',body:'Second reminder.',audience:'owing',termId:term1});
  assert.equal((await call(`/notices/${none.id}/approve`,'POST',{operationId:randomUUID(),version:none.version})).status,400);
});

test('learner sex comes from admission, CSV import or a reasoned edit',async()=>{
  const a=await ok('/admissions','POST',{fullName:'Adwoa Sexrecord',sex:'female',classId:cls,startDate:shift(-5),admissionNumber:`SX-${randomUUID().slice(0,6)}`});
  let app2=a;for(const action of ['review','offer','accept','enrol'])app2=await ok(`/admissions/${a.id}/transition`,'POST',{version:app2.version,action});
  assert.equal((await call(`/learners/${app2.learner_id}`)).body.sex,'female');
  const csv=['Admission No.,Name of Pupil,Gender',`SX-${randomUUID().slice(0,6)},Kofi Csvboy,M`,`SX-${randomUUID().slice(0,6)},Esi Csvgirl,Girl`,`SX-${randomUUID().slice(0,6)},Yaw Unclear,X`].join('\n');
  const batch=await ok('/learner-imports','POST',{sourceName:'sex.csv',classId:cls,startDate:shift(-5),csv});
  assert.deepEqual(batch.rows.map((row:any)=>row.input.sex),['male','female','X']);assert.ok(batch.rows[2].validation.issues.some((issue:string)=>/Sex/.test(issue)));
  const learner=(await call(`/learners/${kids[1]}`)).body;assert.equal(learner.sex,null);
  assert.equal((await ok(`/learners/${kids[1]}/sex`,'POST',{version:learner.version,sex:'male'})).sex,'male');
  assert.equal((await call(`/learners/${kids[1]}/sex`,'POST',{operationId:randomUUID(),version:learner.version,sex:'female'})).status,409);
  assert.equal((await call(`/learners/${kids[1]}/sex`,'POST',{operationId:randomUUID(),version:learner.version+1,sex:'other'})).status,400);
  const census=(await call(`/learners/census?day=${today}`)).body;assert.equal(census.day,today);
  assert.deepEqual(census.items.find((row:any)=>row.name==='Basic 5'),{id:cls,name:'Basic 5',level:'Primary',female:1,male:1,unrecorded:1});
  assert.equal((await call('/learners/census','GET',undefined,teacher)).status,403);
});
