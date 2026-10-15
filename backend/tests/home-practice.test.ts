import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {afterSession,parseNumber,sameNumber,SESSION_SIZE}=require('../dist/modules/practice/rules');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),cls=randomUUID(),headM=randomUUID(),teacherM=randomUUID(),guardianM=randomUUID();
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,termId:string,maths:string;
const kid:Record<string,string>={},topic:Record<string,string>={},links:Record<string,string>={};
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,target=school){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
// Level-L questions: four choices (the first option is right) and two numbers (the pencils sum in the wording).
const choice=(level:number,n:number)=>({level,kind:'choice',prompt:`Level ${level} choice ${n}: what is ${n} + ${level}?`,options:[String(n+level),String(n+level+1),String(n+level+2)],correctOption:0,explanation:`${n} plus ${level} is ${n+level}.`});
const number=(level:number,n:number)=>({level,kind:'number',prompt:`Level ${level} number ${n}: a pencil costs GH₵${n}. What do ${level+1} pencils cost in cedis?`,answer:n*(level+1),explanation:`${level+1} times ${n}.`});
const fullSet=()=>[1,2,3].flatMap(level=>[...[1,2,3,4].map(n=>choice(level,n)),...[5,6].map(n=>number(level,n))]);
const solve=(q:any,right=true)=>q.kind==='choice'?{choice:right?0:1}:{value:right?String(Number(/GH₵(\d+)/.exec(q.prompt)![1])*Number(/do (\d+) pencils/.exec(q.prompt)![1])):'0'};
const route=(child:string)=>`/guardian/children/${child}/practice`;
const start=(child:string,indicatorId:string,actor=guardian)=>call(`${route(child)}/sessions`,'POST',{operationId:randomUUID(),indicatorId},actor);
const answer=(child:string,session:string,q:any,right=true,actor=guardian)=>call(`${route(child)}/sessions/${session}/answer`,'POST',{operationId:randomUUID(),questionId:q.questionId,...solve(q,right)},actor);
// Plays a whole session; `rights` says which of the five answers are right. Returns the last answer's response.
async function play(child:string,indicatorId:string,rights:boolean[]){
  const s=await start(child,indicatorId);assert.equal(s.status,201,JSON.stringify(s.body));let view=s.body,last:any=null;
  for(const right of rights){const r=await answer(child,view.sessionId,view.next,right);assert.equal(r.status,201,JSON.stringify(r.body));last=r.body;if(!last.summary)view=(await call(`${route(child)}/sessions/${view.sessionId}`,'GET',undefined,guardian)).body;}
  return {sessionId:s.body.sessionId,first:s.body,last};
}
// A finished session from an earlier day, entered directly, to set up history the rules look at.
async function history(child:string,indicatorId:string,level:number,correct:number,outcome:string,levelAfter:number,daysAgo=1){
  const set=(await owner.query('SELECT id FROM practice_sets WHERE indicator_id=$1 AND retired_at IS NULL',[indicatorId])).rows[0].id;
  const at=new Date(Date.now()-daysAgo*86400000).toISOString();
  await owner.query("INSERT INTO practice_sessions(id,school_id,learner_id,indicator_id,set_id,guardian_membership_id,level,started_at,completed_at,correct,outcome,level_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)",[randomUUID(),school,child,indicatorId,set,guardianM,level,at,correct,outcome,levelAfter]);
}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Home practice school'),($2,'Home practice other school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$4,$5,'headteacher'),($2,$4,$6,'teacher'),($3,$4,$7,'guardian'),($8,$9,$5,'headteacher')",[headM,teacherM,guardianM,school,headU,teacherU,guardianU,randomUUID(),other]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Practice year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 5','Primary',30)",[cls,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic practice assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
  for(const [key,name] of [['ama','Ama Mensah'],['kojo','Kojo Quaye'],['esi','Esi Owusu'],['yaw','Yaw Elsewhere']]){const id=randomUUID();kid[key]=id;
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`HP-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-50)]);}
  // Ama: verified academic guardian. Kojo: verified, but only the pickup right. Esi: a link that is not verified yet. Yaw: no guardian here.
  const link=async(child:string,academic:boolean,verified:boolean)=>{const id=randomUUID();await owner.query(`INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',$5,false,true,false,${verified?'now()':'NULL'},${verified?'$6':'NULL'},${verified?"'Synthetic access'":'NULL'})`,verified?[id,school,child,guardianM,academic,headM]:[id,school,child,guardianM,academic]);return id;};
  links.ama=await link(kid.ama,true,true);await link(kid.kojo,false,true);await link(kid.esi,true,false);
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  await ok('/assessment/policy','PUT',{caWeight:30,examWeight:70,bands:[{min:50,grade:'P',remark:'Pass'},{min:0,grade:'F',remark:'Fail'}],sourceNote:'Synthetic practice policy'},head,200);
  const topics=[['fractions','Fractions',20],['decimals','Decimals',30],['measures','Measures',40],['percent','Percentages',45],['graphs','Reading graphs',90],['shapes','Shapes',35]] as const;
  await ok('/assessment/indicators','POST',{subjectId:maths,origin:'local',sourceNote:'Synthetic scheme of work',items:topics.map(([,description])=>({description}))});
  const items=(await call(`/assessment/indicators?subjectId=${maths}`)).body.items;
  for(const [key,description,mark] of topics){
    topic[key]=items.find((i:any)=>i.description===description).id;
    const a=await ok(`/assessment/classes/${cls}/assessments`,'POST',{termId,subjectId:maths,kind:'quiz',title:`${description} quiz`,heldOn:shift(-5),maxMark:100,indicatorIds:[topic[key]]},teacher);
    await ok(`/assessment/classes/${cls}/assessments/${a.id}/marks`,'POST',{marks:[{learnerId:kid.ama,mark}]},teacher);
    // Shapes is weak for Ama but has no approved questions, so it must never be offered.
    if(key!=='shapes')await ok(`/assessment/indicators/${topic[key]}/questions`,'POST',{questions:fullSet()},teacher);
  }
});
after(async()=>{delete process.env.READ_ONLY_SCHOOL_IDS;await app?.close();await owner.end();await runtime.end();});

test('a session moves up at 4 of 5, down after two weak sessions in a row at one level, never below Level 1, and finishes at Level 3',()=>{
  assert.equal(SESSION_SIZE,5);
  const t=(level:number,correct:number,previous:any=null)=>{const r=afterSession(level,correct,previous);return `${r.outcome}:${r.levelAfter}`;};
  assert.equal(t(1,5),'up:2');assert.equal(t(1,4),'up:2');assert.equal(t(2,4),'up:3');assert.equal(t(3,4),'done:3');assert.equal(t(3,5),'done:3');
  assert.equal(t(1,3),'stay:1','3 of 5 stays');assert.equal(t(2,3,{level:2,correct:0}),'stay:2','only weak sessions count towards moving down');
  assert.equal(t(2,2),'stay:2','one weak session stays');
  assert.equal(t(2,2,{level:2,correct:2}),'down:1','two weak sessions in a row move down');assert.equal(t(3,0,{level:3,correct:1}),'down:2');
  assert.equal(t(2,2,{level:3,correct:0}),'stay:2','a weak session at another level does not count');
  assert.equal(t(2,2,{level:2,correct:3}),'stay:2','a middling session in between breaks the run');
  assert.equal(t(1,0,{level:1,correct:0}),'stay:1','never below Level 1');
  assert.equal(parseNumber('12'),12);assert.equal(parseNumber(' 0.5 '),0.5);assert.equal(parseNumber('.5'),0.5);assert.equal(parseNumber('1,200'),1200);assert.equal(parseNumber('1,200.50'),1200.5);assert.equal(parseNumber('-3'),-3);
  for(const bad of ['','abc','1/2','0,5','1.2.3','12 cedis','--1'])assert.equal(parseNumber(bad),null,`"${bad}" is not a number`);
  assert.ok(sameNumber(0.5,0.50));assert.ok(sameNumber(1200,1200.0));assert.ok(!sameNumber(0.5,0.51));assert.ok(sameNumber(0.1+0.2,0.3));
});

test('home practice is off until the headteacher switches it on; only the head changes it',async()=>{
  assert.deepEqual((await call('/practice/settings','GET',undefined,teacher)).body,{enabled:false,version:null,updatedAt:null},'off by default');
  assert.equal((await call('/practice/settings','GET',undefined,guardian)).status,403,'families do not read the school setting');
  assert.equal((await call(route(kid.ama),'GET',undefined,guardian)).body.enabled,false,'a family sees nothing while it is off');
  assert.equal((await start(kid.ama,topic.fractions)).status,409,'no sessions while it is off');
  assert.equal((await call('/practice/settings','PUT',{operationId:randomUUID(),enabled:true},teacher)).status,403);
  assert.equal((await call('/practice/settings','PUT',{operationId:randomUUID(),enabled:true},guardian)).status,403);
  assert.equal((await ok('/practice/settings','PUT',{enabled:true},head,200)).version,1);
  assert.equal((await call('/practice/settings','PUT',{operationId:randomUUID(),enabled:false})).status,409,'a stale version is refused');
  assert.deepEqual((await call('/practice/settings','GET',undefined,teacher)).body.enabled,true);
});

test('only a verified guardian with the academic right reaches their own child; staff do not use the family routes',async()=>{
  assert.equal((await call(route(kid.ama),'GET',undefined,guardian)).status,200);
  for(const [why,child] of [['another family\'s child',kid.yaw],['a verified link without the academic right',kid.kojo],['an unverified link',kid.esi]] as const){
    assert.equal((await call(route(child),'GET',undefined,guardian)).status,404,why);
    assert.equal((await start(child,topic.fractions)).status,404,`${why}: no session`);
  }
  assert.equal((await call(route(kid.ama),'GET',undefined,teacher)).status,403,'teachers use the staff views');
  assert.equal((await call(route(kid.ama),'GET',undefined,head)).status,403);
  assert.equal((await start(kid.ama,topic.fractions,teacher)).status,403);
});

test('a child is offered their weakest topics that have approved questions, with no marks shown',async()=>{
  const view=(await call(route(kid.ama),'GET',undefined,guardian)).body;
  assert.equal(view.enabled,true);assert.equal(view.firstName,'Ama');
  assert.deepEqual(view.topics.map((t:any)=>t.topic),['Fractions','Decimals','Measures'],'the weakest three, weakest first; Percentages is a fourth, Shapes has no questions, Reading graphs is strong');
  assert.deepEqual(view.topics.map((t:any)=>[t.level,t.levels,t.sessionsThisWeek,t.open,t.availableToday]),[[1,3,0,null,true],[1,3,0,null,true],[1,3,0,null,true]]);
  assert.deepEqual(view.practised,[]);
  assert.doesNotMatch(JSON.stringify(view),/average|percent|rank|position|score|\d+%/i,'no percentages, ranks or marks reach the family');
  assert.equal((await start(kid.ama,topic.percent)).status,404,'a fourth topic is not offered');
  assert.equal((await start(kid.ama,topic.graphs)).status,404,'a strong topic is not offered');
  assert.equal((await start(kid.ama,topic.shapes)).status,404,'a topic with no approved questions is not offered');
  assert.equal((await start(kid.ama,randomUUID())).status,404);
});

test('a session gives five questions without answers, marks each one, and moves the child up at 4 of 5',async()=>{
  const s=await start(kid.ama,topic.fractions);assert.equal(s.status,201,JSON.stringify(s.body));
  assert.deepEqual([s.body.topic,s.body.level,s.body.total,s.body.answered,s.body.summary],['Fractions',1,5,0,null]);
  assert.match(s.body.next.prompt,/^Level 1 /);
  assert.doesNotMatch(JSON.stringify(s.body),/correctOption|explanation|answer_number|"answer"/,'the right answer is not sent before the child answers');
  const again=await start(kid.ama,topic.fractions);assert.equal(again.body.sessionId,s.body.sessionId,'starting again resumes the same session');
  assert.deepEqual((await call(route(kid.ama),'GET',undefined,guardian)).body.topics[0].open,{sessionId:s.body.sessionId,answered:0,total:5});

  let view=s.body;const seen=new Set<string>();
  // First answer wrong: the child is told the right answer and why.
  const q1=view.next;seen.add(q1.questionId);
  if(q1.kind==='choice'){const r=await answer(kid.ama,view.sessionId,q1,false);assert.equal(r.status,201);assert.deepEqual([r.body.correct,r.body.correctOption,r.body.answered],[false,0,1]);assert.match(r.body.explanation,/plus 1 is/);}
  else{const r=await answer(kid.ama,view.sessionId,q1,false);assert.equal(r.status,201);assert.equal(r.body.correct,false);assert.equal(typeof r.body.correctNumber,'number');}
  assert.equal((await answer(kid.ama,view.sessionId,q1)).status,409,'a question is answered once');
  view=(await call(`${route(kid.ama)}/sessions/${view.sessionId}`,'GET',undefined,guardian)).body;assert.equal(view.answered,1);assert.notEqual(view.next.questionId,q1.questionId,'the next unanswered question is shown');
  assert.equal((await call(`${route(kid.ama)}/sessions/${view.sessionId}/answer`,'POST',{operationId:randomUUID(),questionId:view.next.questionId,choice:9},guardian)).status,400,'an option that does not exist');
  const numberQ=async()=>{const r=await call(`${route(kid.ama)}/sessions/${view.sessionId}/answer`,'POST',{operationId:randomUUID(),questionId:view.next.questionId,value:'twelve'},guardian);return r;};
  if(view.next.kind==='number')assert.equal((await numberQ()).status,400,'words are not a number');
  assert.equal((await call(`${route(kid.ama)}/sessions/${view.sessionId}/answer`,'POST',{operationId:randomUUID(),questionId:randomUUID(),choice:0},guardian)).status,404,'a question from another session');
  // The other four are right: 4 of 5 moves up.
  let last:any=null;
  for(let i=0;i<4;i++){last=(await answer(kid.ama,view.sessionId,view.next,true));assert.equal(last.status,201,JSON.stringify(last.body));assert.equal(last.body.correct,true);
    if(!last.body.summary)view=(await call(`${route(kid.ama)}/sessions/${view.sessionId}`,'GET',undefined,guardian)).body;}
  assert.deepEqual(last.body.summary,{correct:4,total:5,outcome:'up',levelAfter:2});
  const done=(await call(`${route(kid.ama)}/sessions/${view.sessionId}`,'GET',undefined,guardian)).body;assert.deepEqual([done.next,done.summary?.outcome],[null,'up']);
  assert.equal((await answer(kid.ama,view.sessionId,view.next??q1)).status,409,'a finished session takes no more answers');
  const state=(await call(route(kid.ama),'GET',undefined,guardian)).body;
  const fractions=state.topics.find((t:any)=>t.topic==='Fractions');assert.deepEqual([fractions.level,fractions.sessionsThisWeek,fractions.open],[2,1,null]);
  assert.deepEqual(state.practised.map((p:any)=>[p.topic,p.level,p.done,p.sessionsThisWeek]),[['Fractions',2,false,1]]);
  // The stored record keeps the questions, every answer and the outcome, and cannot be changed or removed.
  const items=(await owner.query('SELECT position,given,correct,answered_at FROM practice_session_items WHERE session_id=$1 ORDER BY position',[s.body.sessionId])).rows;
  assert.equal(items.length,5);assert.ok(items.every(i=>i.answered_at));assert.equal(items.filter(i=>i.correct).length,4);
  await assert.rejects(owner.query("UPDATE practice_session_items SET correct=true WHERE session_id=$1",[s.body.sessionId]),/only be recorded once/);
  await assert.rejects(owner.query("UPDATE practice_sessions SET correct=5 WHERE id=$1",[s.body.sessionId]),/only be completed, once/);
  await assert.rejects(owner.query("DELETE FROM practice_sessions WHERE id=$1",[s.body.sessionId]),/are kept/);
  await assert.rejects(owner.query("DELETE FROM practice_session_items WHERE session_id=$1",[s.body.sessionId]),/are kept/);
  // The next session is at Level 2, and the audit log has the events without any question or answer text.
  const next=await start(kid.ama,topic.fractions);assert.match(next.body.next.prompt,/^Level 2 /);
  const log=(await owner.query("SELECT action,metadata FROM audit_events WHERE school_id=$1 AND action LIKE 'practice.session.%' ORDER BY created_at",[school])).rows;
  assert.ok(log.some(l=>l.action==='practice.session.completed'&&l.metadata.outcome==='up'));assert.doesNotMatch(JSON.stringify(log),/pencil|Level \d choice/);
  for(const q of [next.body.next])assert.ok(q);
  // Finish it with 1 of 5 right (it is the second session today on this topic).
  let v=next.body;for(let i=0;i<5;i++){const r=await answer(kid.ama,v.sessionId,v.next,i===0);if(r.body.summary){assert.deepEqual(r.body.summary,{correct:1,total:5,outcome:'stay',levelAfter:2},'one weak session stays');break;}v=(await call(`${route(kid.ama)}/sessions/${v.sessionId}`,'GET',undefined,guardian)).body;}
  const capped=await start(kid.ama,topic.fractions);assert.equal(capped.status,409);assert.match(capped.body.message,/Come back tomorrow/);
  assert.equal((await call(route(kid.ama),'GET',undefined,guardian)).body.topics.find((t:any)=>t.topic==='Fractions').availableToday,false);
});

test('two weak sessions in a row at a level move the child down; finishing Level 3 marks the topic done and it stops being offered',async()=>{
  // Decimals: an earlier weak session at Level 2, then another today, takes the child back to Level 1.
  await history(kid.ama,topic.decimals,1,5,'up',2,3);await history(kid.ama,topic.decimals,2,1,'stay',2,2);
  const down=await play(kid.ama,topic.decimals,[true,false,false,false,false]);
  assert.match(down.first.next.prompt,/^Level 2 /,'the child was at Level 2');assert.deepEqual(down.last.summary,{correct:1,total:5,outcome:'down',levelAfter:1});
  const state=(await call(route(kid.ama),'GET',undefined,guardian)).body;assert.equal(state.topics.find((t:any)=>t.topic==='Decimals').level,1);
  // Measures: at Level 3 with 4 of 5 the topic is done.
  await history(kid.ama,topic.measures,2,5,'up',3,2);
  const finished=await play(kid.ama,topic.measures,[true,true,true,true,false]);
  assert.match(finished.first.next.prompt,/^Level 3 /);assert.deepEqual(finished.last.summary,{correct:4,total:5,outcome:'done',levelAfter:3});
  const after=(await call(route(kid.ama),'GET',undefined,guardian)).body;
  assert.ok(!after.topics.some((t:any)=>t.topic==='Measures'),'a finished topic is no longer offered');
  assert.deepEqual(after.topics.map((t:any)=>t.topic),['Fractions','Decimals','Percentages'],'the next weakest topic takes its place');
  assert.equal(after.practised.find((p:any)=>p.topic==='Measures').done,true);
  assert.equal((await start(kid.ama,topic.measures)).status,404);
});

test('a session in progress can be finished after the set is retired or the guardian is revoked only until the revocation; revoked guardians lose access at once',async()=>{
  const s=await start(kid.ama,topic.percent);assert.equal(s.status,201,JSON.stringify(s.body));
  // Retiring the set does not strand a child mid-session; it only stops new sessions from using it.
  const set=(await call(`/assessment/indicators/${topic.percent}/questions`,'GET',undefined,teacher)).body.current;
  await ok(`/assessment/practice-sets/${set.id}/retire`,'POST',{reason:'Checking a retired set mid-session'},head);
  const a=await answer(kid.ama,s.body.sessionId,s.body.next);assert.equal(a.status,201,'answering still works');
  const listed=(await call(route(kid.ama),'GET',undefined,guardian)).body;
  assert.ok(listed.topics.some((t:any)=>t.topic==='Percentages'&&t.open),'the unfinished session stays visible so it can be finished');
  // Revoking the guardian's academic right stops everything at once.
  await ok(`/guardian-links/${links.ama}/revoke`,'POST',{version:1,reason:'Synthetic revocation for the practice test'},head,201);
  assert.equal((await call(route(kid.ama),'GET',undefined,guardian)).status,404);
  assert.equal((await answer(kid.ama,s.body.sessionId,s.body.next)).status,404,'no more answers once revoked');
  assert.equal((await start(kid.ama,topic.fractions)).status,404);
});

test('practice records belong to one school',async()=>{
  const id=(await owner.query('SELECT id FROM practice_sessions WHERE school_id=$1 LIMIT 1',[school])).rows[0].id;
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[other]);
    assert.equal((await client.query('SELECT 1 FROM practice_sessions WHERE id=$1',[id])).rowCount,0,'another school cannot read sessions');
    assert.equal((await client.query('SELECT 1 FROM practice_session_items WHERE session_id=$1',[id])).rowCount,0,'or answers');
    assert.equal((await client.query('SELECT 1 FROM home_practice_settings')).rowCount,0,'or the setting');
    await client.query('ROLLBACK');
  }finally{client.release();}
});

test('in a read-only demo school a family can still try practice, but staff cannot change the setting',async()=>{
  // Revoked above, so use a fresh verified link for a new child.
  const child=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'HP-DEMO','Demo Child')",[child,school]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,false,false,now(),$5,'Synthetic access')",[randomUUID(),school,child,guardianM,headM]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,child,cls,shift(-50)]);
  const quiz=(await call(`/assessment/classes/${cls}/assessments?termId=${termId}`,'GET',undefined,teacher)).body.items.find((a:any)=>a.title==='Fractions quiz');
  await ok(`/assessment/classes/${cls}/assessments/${quiz.id}/marks`,'POST',{marks:[{learnerId:child,mark:15}]},teacher);
  process.env.READ_ONLY_SCHOOL_IDS=school;
  const refused=await call('/practice/settings','PUT',{operationId:randomUUID(),enabled:false,version:1},head);assert.equal(refused.status,403);assert.equal(refused.body.code,'READ_ONLY_DEMO');
  const tried=await start(child,topic.fractions);assert.equal(tried.status,201,`starting practice is not blocked as read-only: ${JSON.stringify(tried.body)}`);
  const first=await answer(child,tried.body.sessionId,tried.body.next);assert.equal(first.status,201,`answering is not blocked either: ${JSON.stringify(first.body)}`);
  assert.equal((await call(`/assessment/indicators/${topic.fractions}/questions`,'POST',{operationId:randomUUID(),questions:fullSet()},teacher)).body.code,'READ_ONLY_DEMO','approving questions is a staff change and stays blocked');
  delete process.env.READ_ONLY_SCHOOL_IDS;
});
