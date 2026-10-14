import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {attentionFor,mondayOf,mean}=require('../dist/modules/assessment/progress.service');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),cls=randomUUID(),cls2=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID();
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const bands=[{min:80,grade:'A',remark:'Excellent'},{min:50,grade:'C',remark:'Credit'},{min:0,grade:'D',remark:'Needs support'}];
let app:any,base:string,head:any,teacher:any,guardian:any,termId:string,maths:string;const kids:string[]=[];let elsewhere:string;const tests:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Progress school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$4,$5,'headteacher'),($2,$4,$6,'teacher'),($3,$4,$7,'guardian')",[headM,teacherM,guardianM,school,headU,teacherU,guardianU]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Progress year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Primary 5','Primary',30),($2,$3,$4,'Primary 6','Primary',30)",[cls,cls2,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic progress assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
  for(const [name,c] of [['Ama Steady',cls],['Kojo Falling',cls],['Esi Struggling',cls],['Yaw Elsewhere',cls2]] as const){const id=randomUUID();if(c===cls)kids.push(id);else elsewhere=id;
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`PG-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,c,shift(-50)]);}
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  await ok('/assessment/policy','PUT',{caWeight:30,examWeight:70,bands,sourceNote:'Synthetic progress policy'},head,200);
});
after(async()=>{await app?.close();await owner.end();});

test('attention flags learners whose recent marks drop or sit below the pass line',()=>{
  assert.equal(attentionFor([90,85]),null,'too few marks');
  assert.equal(attentionFor([90,85,88,80,82]),null);
  assert.deepEqual(attentionFor([80,78,60,55,50]),{reason:'dropping',recent:55,earlier:79});
  assert.deepEqual(attentionFor([45,40,48]),{reason:'below_pass',recent:44.3,earlier:null});
  assert.equal(mondayOf('2026-10-14'),'2026-10-12');assert.equal(mondayOf('2026-10-12'),'2026-10-12');assert.equal(mondayOf('2026-10-18'),'2026-10-12');
  assert.equal(mean([]),null);assert.equal(mean([1,2]),1.5);
});

test('teachers create dated assessments only for their classes and inside the term',async()=>{
  const body={termId,subjectId:maths,kind:'classwork',title:'Fractions exercise',heldOn:shift(-28),maxMark:20};
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body},guardian)).status,403);
  assert.equal((await call(`/assessment/classes/${cls2}/assessments`,'POST',{operationId:randomUUID(),...body},teacher)).status,404);
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body,heldOn:shift(-56)},teacher)).status,400);
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...body,kind:'exam'},teacher)).status,400);
  const op=randomUUID(),first=await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:op,...body},teacher);assert.equal(first.status,201);
  assert.deepEqual((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:op,...body},teacher)).body,first.body,'retry returns the same assessment');
  tests.push(first.body.id);
  for(const [i,kind] of (['homework','quiz','class_test','project'] as const).entries())tests.push((await ok(`/assessment/classes/${cls}/assessments`,'POST',{...body,kind,title:`Week ${i+2} ${kind}`,heldOn:shift(-21+7*i)},teacher)).id);
});

test('marks stay within the maximum, only for learners in the class, and keep their history',async()=>{
  const marks=[[18,17,17.6,16,16.4],[16,15.6,12,11,10],[null,null,9,8,9.6]];
  const route=(id:string)=>`/assessment/classes/${cls}/assessments/${id}/marks`;
  assert.equal((await call(route(tests[0]),'POST',{operationId:randomUUID(),marks:[{learnerId:kids[0],mark:21}]},teacher)).status,400);
  assert.equal((await call(route(tests[0]),'POST',{operationId:randomUUID(),marks:[{learnerId:elsewhere,mark:10}]},teacher)).status,404);
  await assert.rejects(owner.query('INSERT INTO class_assessment_marks(id,school_id,assessment_id,learner_id,mark,recorded_by) VALUES($1,$2,$3,$4,25,$5)',[randomUUID(),school,tests[0],kids[0],teacherM]),/maximum/);
  for(const [i,id] of tests.entries())await ok(route(id),'POST',{marks:kids.flatMap((learnerId,k)=>marks[k][i]===null?[]:[{learnerId,mark:marks[k][i]}])},teacher);
  assert.deepEqual(await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:18}]},teacher),{written:0,unchanged:1});
  await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:19}]},teacher);await ok(route(tests[0]),'POST',{marks:[{learnerId:kids[0],mark:18}]},teacher);
  assert.equal((await owner.query('SELECT count(*) FROM class_assessment_marks WHERE assessment_id=$1 AND learner_id=$2',[tests[0],kids[0]])).rows[0].count,'3','history retained');
  await assert.rejects(owner.query('UPDATE class_assessment_marks SET mark=1 WHERE assessment_id=$1',[tests[0]]),/append-only/);
  const roster=(await call(route(tests[0]),'GET',undefined,teacher)).body;
  assert.deepEqual(roster.items.map((r:any)=>[r.fullName,r.mark]),[['Ama Steady',18],['Esi Struggling',null],['Kojo Falling',16]]);
  const list=(await call(`/assessment/classes/${cls}/assessments?termId=${termId}`,'GET',undefined,teacher)).body.items;
  assert.equal(list.length,5);assert.equal(list[4].id,tests[0]);assert.equal(list[4].marked,2);assert.equal(list[4].average,85);
});

test('the CA suggestion averages each learner\'s assessments; the teacher still saves the CA',async()=>{
  const r=(await call(`/assessment/classes/${cls}/ca-suggestion?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body.items;
  const by=(id:string)=>r.find((x:any)=>x.learnerId===id);
  assert.deepEqual([by(kids[0]).ca,by(kids[1]).ca,by(kids[2]).ca],[85,64.6,44.3]);assert.equal(by(kids[2]).assessments,3);
  assert.equal((await owner.query('SELECT count(*) FROM assessment_score_entries WHERE school_id=$1',[school])).rows[0].count,'0','nothing written');
});

test('class progress groups the term by week or month and lists learners needing attention',async()=>{
  assert.equal((await call(`/assessment/classes/${cls2}/progress?termId=${termId}`,'GET',undefined,teacher)).status,404);
  const week=(await call(`/assessment/classes/${cls}/progress?termId=${termId}&period=week`,'GET',undefined,teacher)).body;
  assert.equal(week.buckets.length,5);assert.equal(week.subjects[0].name,'Mathematics');
  assert.deepEqual(week.subjects[0].points.map((p:any)=>p.average),[85,81.5,64.3,58.3,60]);
  assert.deepEqual(week.attention.map((a:any)=>[a.fullName,a.reason]).sort(),[['Esi Struggling','below_pass'],['Kojo Falling','dropping']]);
  const month=(await call(`/assessment/classes/${cls}/progress?termId=${termId}&period=month`,'GET',undefined,head)).body;
  assert.ok(month.buckets.length>=1&&month.buckets.length<=3);assert.ok(month.buckets.every((b:string)=>b.endsWith('-01')));
  assert.equal(month.subjects[0].points.reduce((n:number,p:any)=>n+p.marks,0),13);
});

test('learner progress shows weeks, months and term results; teachers only for their own learners',async()=>{
  await ok(`/assessment/classes/${cls}/scores`,'POST',{termId,subjectId:maths,scores:[{learnerId:kids[0],kind:'ca',score:85},{learnerId:kids[0],kind:'exam',score:90}]},teacher);
  assert.equal((await call(`/assessment/learners/${elsewhere}/progress`,'GET',undefined,teacher)).status,404);
  assert.equal((await call(`/assessment/learners/${kids[0]}/progress`,'GET',undefined,guardian)).status,403);
  assert.equal((await call(`/assessment/learners/${elsewhere}/progress`,'GET',undefined,head)).status,200);
  const week=(await call(`/assessment/learners/${kids[0]}/progress?period=week`,'GET',undefined,teacher)).body;
  assert.deepEqual(week.subjects[0].points.map((p:any)=>p.assessmentAverage),[90,85,88,80,82]);assert.ok(week.subjects[0].points.every((p:any)=>p.termResult===null));
  const term=(await call(`/assessment/learners/${kids[0]}/progress?period=term`,'GET',undefined,teacher)).body;
  assert.equal(term.buckets.length,1);assert.equal(term.buckets[0].label,'Term 1 Progress year');
  assert.deepEqual(term.subjects[0].points[0],{key:termId,assessmentAverage:85,marks:5,termResult:88.5});
  const yearView=(await call(`/assessment/learners/${kids[0]}/progress?period=year`,'GET',undefined,head)).body;
  assert.deepEqual(yearView.buckets.map((b:any)=>b.label),['Progress year']);assert.equal(yearView.subjects[0].points[0].termResult,88.5);
  assert.equal((await call(`/assessment/learners/${kids[0]}/progress?period=decade`,'GET',undefined,head)).status,400);
});

let fractions:string,addition:string;
test('headteachers add the school\'s indicators with their source; wording is kept and codes stay unique while current',async()=>{
  const body={subjectId:maths,origin:'local',sourceNote:'Primary 5 scheme of work, Term 1',items:[{code:'P5.N.3',strand:'Number',subStrand:'Fractions',description:'Adds and subtracts fractions with like denominators'},{code:'P5.N.1',strand:'Number',description:'Adds whole numbers up to 1,000,000'}]};
  assert.equal((await call('/assessment/indicators','POST',{operationId:randomUUID(),...body},teacher)).status,403);
  assert.equal((await call('/assessment/indicators','POST',{operationId:randomUUID(),...body,origin:'national'})).status,400);
  assert.equal((await call('/assessment/indicators','POST',{operationId:randomUUID(),...body,items:[body.items[0],{...body.items[1],code:'p5.n.3'}]})).status,400,'codes repeat within the batch');
  assert.deepEqual(await ok('/assessment/indicators','POST',body),{added:2});
  assert.equal((await call('/assessment/indicators','POST',{operationId:randomUUID(),...body,items:[body.items[0]]})).status,409,'code already in use');
  const list=(await call(`/assessment/indicators?subjectId=${maths}`,'GET',undefined,teacher)).body.items;
  assert.deepEqual(list.map((i:any)=>i.code),['P5.N.1','P5.N.3']);[addition,fractions]=list.map((i:any)=>i.id);
  await assert.rejects(owner.query("UPDATE curriculum_indicators SET description='Changed wording' WHERE id=$1",[fractions]),/only be retired/);
  await assert.rejects(owner.query('DELETE FROM curriculum_indicators WHERE id=$1',[fractions]),/retire one instead/);
  const spare=(await ok('/assessment/indicators','POST',{...body,items:[{code:'P5.X.9',description:'Entered by mistake'}]})).added;assert.equal(spare,1);
  const spareId=(await call(`/assessment/indicators?subjectId=${maths}`)).body.items.find((i:any)=>i.code==='P5.X.9').id;
  assert.equal((await call(`/assessment/indicators/${spareId}/retire`,'POST',{operationId:randomUUID(),reason:'Typed in error'},teacher)).status,403);
  await ok(`/assessment/indicators/${spareId}/retire`,'POST',{reason:'Typed in error'});
  assert.equal((await call(`/assessment/indicators/${spareId}/retire`,'POST',{operationId:randomUUID(),reason:'Again'})).status,404);
  await ok('/assessment/indicators','POST',{...body,items:[{code:'P5.X.9',description:'Entered again correctly'}]});
  const retired=(await call(`/assessment/indicators?subjectId=${maths}`)).body.items.filter((i:any)=>i.code==='P5.X.9');
  assert.deepEqual(retired.map((i:any)=>i.retirement_reason),[null,'Typed in error'],'current first, retired kept with its reason');
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),termId,subjectId:maths,kind:'quiz',title:'Retired tag',heldOn:shift(-1),maxMark:10,indicatorIds:[spareId]},teacher)).status,400);
});

test('gaps rank the indicators a class was tested on, weakest first, with who is below 50%',async()=>{
  const science=(await ok('/assessment/subjects','POST',{name:'Science'})).id;
  const base={termId,subjectId:maths,kind:'quiz',heldOn:shift(-1),maxMark:10};
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),...base,subjectId:science,title:'Wrong subject',indicatorIds:[fractions]},teacher)).status,400);
  const x=await ok(`/assessment/classes/${cls}/assessments`,'POST',{...base,title:'Fractions quiz',indicatorIds:[fractions]},teacher);assert.equal(x.indicators,1);
  const y=await ok(`/assessment/classes/${cls}/assessments`,'POST',{...base,title:'Mixed test',indicatorIds:[fractions,addition,fractions]},teacher);assert.equal(y.indicators,2);
  await ok(`/assessment/classes/${cls}/assessments/${x.id}/marks`,'POST',{marks:[{learnerId:kids[0],mark:9},{learnerId:kids[1],mark:4},{learnerId:kids[2],mark:3}]},teacher);
  await ok(`/assessment/classes/${cls}/assessments/${y.id}/marks`,'POST',{marks:[{learnerId:kids[0],mark:8},{learnerId:kids[1],mark:6},{learnerId:kids[2],mark:5}]},teacher);
  assert.equal((await call(`/assessment/classes/${cls2}/gaps?termId=${termId}`,'GET',undefined,teacher)).status,404);
  const gaps=(await call(`/assessment/classes/${cls}/gaps?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body;
  assert.deepEqual(gaps.items.map((g:any)=>[g.code,g.assessments,g.average,g.belowPass,g.belowShare]),[['P5.N.3',2,58.3,1,33],['P5.N.1',1,63.3,0,0]]);
  assert.deepEqual(gaps.items[0].below,[{learnerId:kids[2],fullName:'Esi Struggling',average:40}]);
  assert.equal(gaps.untaggedAssessments,5);
  const listed=(await call(`/assessment/classes/${cls}/assessments?termId=${termId}`,'GET',undefined,teacher)).body.items.find((a:any)=>a.id===y.id);
  assert.deepEqual(listed.indicators.map((i:any)=>i.code),['P5.N.1','P5.N.3']);
});

const {evidenceFor}=require('../dist/modules/assessment/support.service');
let planA:string,planB:string,planElsewhere:string;
test('evidence compares each learner\'s marks before the plan and since, counting each learner once',()=>{
  const plan={class_id:'c',subject_id:'s',indicator_id:null,start_date:'2026-10-05',learners:[{id:'a',full_name:'A'},{id:'b',full_name:'B'}]};
  const m=(learner_id:string,held_on:string,percent:number,indicators:string[]=[])=>({class_id:'c',subject_id:'s',held_on,learner_id,percent,indicators});
  const e=evidenceFor(plan,[m('b','2026-10-05',30),m('a','2026-09-28',40),m('a','2026-10-06',60),m('a','2026-10-20',70),m('b','2026-10-06',50),{...m('a','2026-10-06',99),subject_id:'other'}],'2026-10-10');
  assert.deepEqual(e.learners.map((l:any)=>[l.before,l.since,l.change]),[[40,60,20],[30,50,20]],'start-day marks are before; later marks and other subjects ignored');
  assert.deepEqual(e.group,{before:35,since:55,change:20,improved:2,dropped:0,compared:2});
  assert.equal(evidenceFor({...plan,indicator_id:'i'},[m('a','2026-10-06',60,['i']),m('a','2026-10-07',10)],'2026-10-10').learners[0].since,60);
});

test('support plans name the learners, an owner and a review date; only the headteacher assigns other owners',async()=>{
  const body={termId,subjectId:maths,learnerIds:[kids[1],kids[2]],concern:'Recent maths marks have fallen',action:'Small-group re-teaching of fractions twice a week',startDate:shift(-10),reviewDate:shift(4)};
  const route=`/assessment/classes/${cls}/support-plans`;
  assert.equal((await call(route,'POST',{operationId:randomUUID(),...body},guardian)).status,403);
  assert.equal((await call(`/assessment/classes/${cls2}/support-plans`,'POST',{operationId:randomUUID(),...body,learnerIds:[elsewhere]},teacher)).status,404);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),...body,learnerIds:[elsewhere]},teacher)).status,404);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),...body,reviewDate:shift(-10)},teacher)).status,400);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),...body,startDate:shift(-60)},teacher)).status,400);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),...body,ownerMembershipId:headM},teacher)).status,403);
  const a=await ok(route,'POST',body,teacher);assert.equal(a.learners,2);planA=a.id;
  const owners=(await call(`/support-plans/owners?classId=${cls}`)).body.items;
  assert.equal(owners[0].membershipId,teacherM);assert.equal(owners[0].classTeacher,true);assert.ok(owners.some((o:any)=>o.membershipId===headM));
  assert.deepEqual((await call(`/support-plans/owners?classId=${cls}`,'GET',undefined,teacher)).body.items.map((o:any)=>o.membershipId),[teacherM]);
  planB=(await ok(route,'POST',{...body,learnerIds:[kids[2]],indicatorId:fractions,concern:'Below 50% on fractions',action:'Extra fractions practice at home',startDate:shift(-2),reviewDate:shift(0),ownerMembershipId:teacherM})).id;
  planElsewhere=(await ok(`/assessment/classes/${cls2}/support-plans`,'POST',{...body,learnerIds:[elsewhere]})).id;
  await assert.rejects(owner.query("UPDATE support_plans SET action='Changed' WHERE id=$1",[planA]),/append-only/);
});

test('teachers see plans for their classes; the review shows marks before and since, and a closed plan stays closed',async()=>{
  const mine=(await call(`/support-plans`,'GET',undefined,teacher)).body;
  assert.deepEqual(mine.items.map((p:any)=>p.id).sort(),[planA,planB].sort(),'not the other class');
  assert.equal((await call(`/support-plans/${planElsewhere}`,'GET',undefined,teacher)).status,404);
  assert.deepEqual(mine.items.map((p:any)=>[p.id,p.due]),[[planB,true],[planA,false]],'due first');
  const a=(await call(`/support-plans/${planA}`,'GET',undefined,teacher)).body;
  assert.deepEqual(a.evidence.learners.map((l:any)=>[l.fullName,l.before,l.since,l.change]),[['Esi Struggling',45,42,-3],['Kojo Falling',72.7,51.3,-21.4]]);
  const b=(await call(`/support-plans/${planB}`,'GET',undefined,teacher)).body;
  assert.deepEqual(b.evidence.learners.map((l:any)=>[l.before,l.since]),[[null,40]],'only fractions-tagged marks');
  assert.equal(b.indicator_code,'P5.N.3');
  const morning=(await call('/home/morning')).body;assert.deepEqual(morning.support.map((s:any)=>[s.id,s.learners]),[[planB,1]]);
  const reviews=`/support-plans/${planB}/reviews`;
  assert.equal((await call(reviews,'POST',{operationId:randomUUID(),outcome:'no_change',note:'Still struggling',decision:'continue'},teacher)).status,400,'continue needs a next date');
  assert.equal((await call(reviews,'POST',{operationId:randomUUID(),outcome:'no_change',note:'Too early',decision:'continue',nextReviewDate:shift(7),reviewedOn:shift(-5)},teacher)).status,400,'before the plan began');
  await ok(reviews,'POST',{outcome:'no_change',note:'Practising at home; marks not up yet',decision:'continue',nextReviewDate:shift(7)},teacher);
  const after=(await call(`/support-plans/${planB}`,'GET',undefined,teacher)).body;
  assert.equal(after.review_date,shift(7));assert.equal(after.due,false);assert.equal(after.reviews[0].evidence.learners[0].since,40,'evidence kept with the review');
  assert.deepEqual((await call('/home/morning')).body.support,[]);
  await ok(reviews,'POST',{outcome:'improved',note:'Fractions secure now',decision:'close'});
  assert.equal((await call(reviews,'POST',{operationId:randomUUID(),outcome:'improved',note:'Again',decision:'close'},teacher)).status,409);
  await assert.rejects(owner.query("INSERT INTO support_plan_reviews(id,school_id,plan_id,reviewed_on,outcome,note,decision,evidence,recorded_by) VALUES($1,$2,$3,$4,'improved','Direct','continue','{}',$5)",[randomUUID(),school,planB,shift(0),teacherM]),/closed|check/);
  assert.deepEqual((await call('/support-plans?status=closed','GET',undefined,teacher)).body.items.map((p:any)=>p.id),[planB]);
  assert.equal((await call(`/support-plans?classId=${cls2}`)).body.items.length,1,'head sees every class');
});

test('indicators can name their grade; the grade is kept like the wording',async()=>{
  await ok('/assessment/indicators','POST',{subjectId:maths,origin:'official',sourceNote:'Synthetic Primary 6 curriculum',grade:'Primary 6',items:[{code:'P6.N.1',description:'Multiplies decimals by whole numbers'}]});
  const p6=(await call(`/assessment/indicators?subjectId=${maths}`,'GET',undefined,teacher)).body.items.find((i:any)=>i.code==='P6.N.1');
  assert.equal(p6.grade,'Primary 6');
  assert.equal((await call(`/assessment/indicators?subjectId=${maths}`)).body.items.find((i:any)=>i.code==='P5.N.3').grade,null,'no grade suits every class');
  await assert.rejects(owner.query("UPDATE curriculum_indicators SET grade='Primary 5' WHERE id=$1",[p6.id]),/only be retired/);
  assert.equal((await call('/assessment/indicators','POST',{operationId:randomUUID(),subjectId:maths,origin:'official',sourceNote:'Too long grade',grade:'x'.repeat(41),items:[{description:'Anything at all'}]})).status,400);
});

test('practice materials are references or links per indicator; teachers add them, only the head or the adder retires them',async()=>{
  const route=`/assessment/indicators/${fractions}/resources`;
  assert.equal((await call(route,'POST',{operationId:randomUUID(),kind:'textbook',title:'No pages given'},teacher)).status,400);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),kind:'link',title:'Bad link',url:'drive.example/file'},teacher)).status,400);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),kind:'video',title:'Wrong kind',detail:'Anything'},teacher)).status,400);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),kind:'textbook',title:'Pages',detail:'Bk 5 pp. 1-2'},guardian)).status,403);
  const book=(await ok(route,'POST',{kind:'textbook',title:'Primary Maths Book 5',detail:'Pages 34 to 36, exercises 1 to 4',forFamilies:true},teacher)).id;
  const sheet=(await ok(route,'POST',{kind:'worksheet',title:'Fractions practice sheet',url:'https://drive.example.com/fractions-1'})).id;
  const list=(await call(route,'GET',undefined,teacher)).body.items;
  assert.deepEqual(list.map((r:any)=>[r.title,r.for_families]),[['Primary Maths Book 5',true],['Fractions practice sheet',false]]);
  assert.equal((await call(`/assessment/indicator-resources/${sheet}/retire`,'POST',{operationId:randomUUID(),reason:'Not mine to retire'},teacher)).status,403);
  await ok(`/assessment/indicator-resources/${book}/retire`,'POST',{reason:'Replaced by the new edition'},teacher);
  await assert.rejects(owner.query("UPDATE indicator_resources SET title='Changed' WHERE id=$1",[sheet]),/only be retired/);
  const gap=(await call(`/assessment/classes/${cls}/gaps?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body.items.find((g:any)=>g.code==='P5.N.3');
  assert.equal(gap.resources,1,'retired materials are not counted');
  assert.deepEqual((await call(`/support-plans/${planB}`,'GET',undefined,teacher)).body.resources.map((r:any)=>r.title),['Fractions practice sheet']);
});

const {familyStatus}=require('../dist/modules/assessment/family.service');
test('families always see published results; trends and home help only once the school shares them',async()=>{
  assert.equal(familyStatus([60,70]),'not_enough');assert.equal(familyStatus([60,62,61,60]),'steady');assert.equal(familyStatus([50,52,60,62,64]),'improving');assert.equal(familyStatus([80,78,60,55,50]),'needs_attention');
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,false,false,now(),$5,'Synthetic academic access')",[randomUUID(),school,kids[2],guardianM,headM]);
  const route=`/guardian/children/${kids[2]}/progress`;
  assert.equal((await call(`/guardian/children/${kids[0]}/progress`,'GET',undefined,guardian)).status,404,'not their child');
  assert.equal((await call(route,'GET',undefined,teacher)).status,403);
  const closed=(await call(route,'GET',undefined,guardian)).body;
  assert.equal(closed.shared,false);assert.deepEqual(closed.termResults.terms,[]);assert.equal(closed.subjects,undefined);
  assert.equal((await call('/assessment/sharing','PUT',{operationId:randomUUID(),shareWithFamilies:true},teacher)).status,403);
  assert.equal((await ok('/assessment/sharing','PUT',{shareWithFamilies:true},head,200)).version,1);
  assert.equal((await call('/assessment/sharing','PUT',{operationId:randomUUID(),shareWithFamilies:false})).status,409,'stale version');
  const homeSheet=(await ok(`/assessment/indicators/${fractions}/resources`,'POST',{kind:'activity',title:'Fraction strips at home',detail:'Fold paper strips into halves and quarters',forFamilies:true},teacher)).id;
  const plan=(await ok(`/assessment/classes/${cls}/support-plans`,'POST',{termId,subjectId:maths,indicatorId:fractions,learnerIds:[kids[2],kids[1]],concern:'Kojo and Esi both below 50 on fractions',action:'Small group on Tuesdays',familyNote:'Ten minutes of fraction practice at home three evenings a week helps.',startDate:shift(-1),reviewDate:shift(10)},teacher)).id;
  await ok(`/assessment/classes/${cls}/support-plans`,'POST',{termId,subjectId:maths,learnerIds:[kids[2]],concern:'Staff-only plan',action:'Seat nearer the board',startDate:shift(-1),reviewDate:shift(10)},teacher);
  const open=(await call(route,'GET',undefined,guardian)).body;
  assert.equal(open.shared,true);
  assert.equal(open.subjects.find((s:any)=>s.name==='Mathematics').status,'needs_attention');
  assert.ok(open.months.length>=1&&open.subjects[0].months.length===open.months.length);
  assert.deepEqual(open.help.map((h:any)=>[h.subject,h.topic,h.note,h.teacher]),[['Mathematics','Adds and subtracts fractions with like denominators','Ten minutes of fraction practice at home three evenings a week helps.','Kofi Sample']],'only plans with a family note');
  assert.deepEqual(open.help[0].practice.map((r:any)=>r.title),['Fraction strips at home'],'only materials marked for families');
  assert.ok(!JSON.stringify(open).includes('Kojo'),'other learners and the staff concern never reach families');
  await ok(`/support-plans/${plan}/reviews`,'POST',{outcome:'improved',note:'Done',decision:'close'},teacher);
  assert.deepEqual((await call(route,'GET',undefined,guardian)).body.help,[],'closed plans drop off');
  await ok(`/assessment/indicator-resources/${homeSheet}/retire`,'POST',{reason:'Test clean-up'},teacher);
});

test('mock rounds sit apart from class work and show each learner\'s readiness without predicting grades',async()=>{
  const science=(await call('/assessment/subjects')).body.items.find((s:any)=>s.name==='Science').id;
  const before=JSON.stringify([(await call(`/assessment/classes/${cls}/progress?termId=${termId}`,'GET',undefined,teacher)).body,(await call(`/assessment/classes/${cls}/ca-suggestion?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body,(await call(`/assessment/learners/${kids[2]}/progress?period=term`,'GET',undefined,teacher)).body]);
  const route=`/assessment/classes/${cls}/mocks`;
  assert.equal((await call(`/assessment/classes/${cls}/assessments`,'POST',{operationId:randomUUID(),termId,subjectId:maths,kind:'mock',title:'Sneaky mock',heldOn:shift(-2),maxMark:100},teacher)).status,400,'mocks only come in rounds');
  assert.equal((await call(`/assessment/classes/${cls2}/mocks`,'POST',{operationId:randomUUID(),termId,title:'Mock 1',heldOn:shift(-20),maxMark:100,subjectIds:[maths]},teacher)).status,404);
  await ok(route,'POST',{termId,title:'Mock 1',heldOn:shift(-20),maxMark:100,subjectIds:[maths,science]},teacher);
  assert.equal((await call(route,'POST',{operationId:randomUUID(),termId,title:'mock 1',heldOn:shift(-19),maxMark:100,subjectIds:[maths]},teacher)).status,409,'one round per title in a year');
  await ok(route,'POST',{termId,title:'Mock 2',heldOn:shift(-3),maxMark:50,subjectIds:[maths,science]},teacher);
  let r=(await call(route,'GET',undefined,teacher)).body;
  assert.deepEqual(r.rounds.map((x:any)=>[x.title,x.subjects.length]),[['Mock 1',2],['Mock 2',2]]);
  const id=(round:number,subject:string)=>r.rounds[round].subjects.find((s:any)=>s.subjectId===subject).assessmentId;
  const marks:[number,string,number[]][]=[[0,maths,[70,55,40]],[0,science,[80,50,45]],[1,maths,[40,25,15]],[1,science,[42,30,24]]];
  for(const [round,subject,values] of marks)await ok(`/assessment/classes/${cls}/assessments/${id(round,subject)}/marks`,'POST',{marks:kids.map((learnerId,i)=>({learnerId,mark:values[i]}))},teacher);
  r=(await call(route,'GET',undefined,teacher)).body;
  const by=(name:string)=>r.learners.find((l:any)=>l.fullName===name);
  assert.deepEqual(by('Ama Steady').latest,{key:'mock 2',average:82,change:7,below:[],atRisk:false});
  assert.deepEqual(by('Kojo Falling').latest,{key:'mock 2',average:55,change:2.5,below:[],atRisk:false});
  assert.deepEqual(by('Esi Struggling').latest,{key:'mock 2',average:39,change:-3.5,below:['Mathematics','Science'],atRisk:true});
  assert.equal(r.learners[0].fullName,'Esi Struggling','weakest first');
  assert.deepEqual(r.summary.map((s:any)=>[s.key,s.sat,s.atRisk]),[['mock 1',3,1],['mock 2',3,1]]);
  const after=JSON.stringify([(await call(`/assessment/classes/${cls}/progress?termId=${termId}`,'GET',undefined,teacher)).body,(await call(`/assessment/classes/${cls}/ca-suggestion?termId=${termId}&subjectId=${maths}`,'GET',undefined,teacher)).body,(await call(`/assessment/learners/${kids[2]}/progress?period=term`,'GET',undefined,teacher)).body]);
  assert.equal(after,before,'trends, the CA suggestion and learner progress leave mocks out');
  assert.equal((await call(`/assessment/classes/${cls}/assessments?termId=${termId}`,'GET',undefined,teacher)).body.items.filter((a:any)=>a.kind==='mock').length,4,'mocks still listed with the assessments');
});
