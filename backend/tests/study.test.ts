import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
const {createApp}=require('../dist/main');
const {AiService}=require('../dist/modules/ai/ai.service');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),basic5=randomUUID(),jhs1=randomUUID();
const [headM,teacherM,guardianM,strangerM,otherHeadM]=Array.from({length:5},()=>randomUUID());
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const strangerU=randomUUID(),suffix=randomUUID().slice(0,8);
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,stranger:any,maths:string,termId:string,ama:string,yaw:string,kojo:string;
const topic:Record<string,string>={},approval:Record<string,string>={};
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,target=school){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}

// A scripted model: a lesson that names the topic, and plain sums with right answers.
const topicOf=(prompt:any)=>JSON.parse(/<indicator>\n([\s\S]*?)\n<\/indicator>/.exec(prompt.user)![1]).indicator as string;
let calls=0;const prompts:string[]=[];
const model=async(prompt:any)=>{
  prompts.push(prompt.system+'\n'+prompt.user);
  if(/short lesson/i.test(prompt.system)){const w=topicOf(prompt);return {text:JSON.stringify({lesson:{goal:`You will learn this: ${w}.`,steps:[
    {heading:'Start with the idea',text:`Think about "${w}" in your own life, for example when you share food at home.`},{heading:'Try a small case',text:'Take two small numbers and work through it one step at a time.'},
    {heading:'Check your work',text:'Read your answer again and ask yourself if it makes sense.'}],example:{problem:'What is 2 + 3?',working:'2 plus 3 is 5.'},recap:[`You can practise "${w}" every day.`,'Check each step before you move on.']}}),inputTokens:600,outputTokens:700};}
  const count=Number(/exactly (\d+) questions/.exec(prompt.system)![1]),seed=++calls;
  return {text:JSON.stringify({questions:Array.from({length:count},(_,i)=>({type:'choice',q:`What is ${seed*100+i*7+11} + ${3+i}?`,options:[String(seed*100+i*7+14+i),String(seed*100+i*7+24+i),String(seed*100+i*7+13+i)],answer:String(seed*100+i*7+14+i),why:'Add the two numbers.'}))}),inputTokens:900,outputTokens:count*60};
};
const practice='/guardian/children',study='/guardian/children';
const startStudy=(child:string,indicatorId:string,actor=guardian)=>call(`${study}/${child}/study/sessions`,'POST',{operationId:randomUUID(),indicatorId},actor);
const finishStudy=(child:string,id:string,actor=guardian)=>call(`${study}/${child}/study/sessions/${id}/finish`,'POST',{operationId:randomUUID()},actor);
const reportLesson=(child:string,lessonId:string,body:Record<string,unknown>={reason:'unclear'},actor=guardian)=>call(`${study}/${child}/study/lessons/${lessonId}/flag`,'POST',{operationId:randomUUID(),...body},actor);
const startCheck=(child:string,indicatorId:string,studySessionId?:string,actor=guardian)=>call(`${practice}/${child}/practice/sessions`,'POST',{operationId:randomUUID(),indicatorId,...(studySessionId?{studySessionId}:{})},actor);
const overview=async(child:string)=>(await call(`${practice}/${child}/practice`,'GET',undefined,guardian)).body;
const card=async(child:string,indicatorId:string)=>{const o=await overview(child);return [...o.topics,...o.explore].find((t:any)=>t.indicatorId===indicatorId);};
const generate=(id:string)=>call(`/learning/approvals/${id}/generate`,'POST',undefined,head);
async function account(id:string,email:string){const salt=randomBytes(16).toString('hex');await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[id,email.split('@')[0],email,`${salt}:${scryptSync('Synthetic-only-2026!',salt,64).toString('hex')}`]);}
async function play(child:string,sessionId:string,first:any){let view=first;for(let i=0;i<5;i++){const r=await call(`${practice}/${child}/practice/sessions/${sessionId}/answer`,'POST',{operationId:randomUUID(),questionId:view.next.questionId,choice:0},guardian);assert.equal(r.status,201,JSON.stringify(r.body));if(!r.body.summary)view=(await call(`${practice}/${child}/practice/sessions/${sessionId}`,'GET',undefined,guardian)).body;else return r.body;}}

before(async()=>{
  process.env.DEV_AUTH='synthetic-local';process.env.AI_ENABLED='true';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  app.get(AiService).providerOverride={name:'scripted',model:'scripted-1',async complete(prompt:any){return model(prompt);}};
  await account(strangerU,`study-stranger-${suffix}@example.test`);
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));stranger=await login(`study-stranger-${suffix}@example.test`);
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Study school'),($2,'Study other school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$6,$7,'headteacher'),($2,$6,$8,'teacher'),($3,$6,$9,'guardian'),($4,$6,$10,'guardian'),($5,$11,$7,'headteacher')",[headM,teacherM,guardianM,strangerM,otherHeadM,school,headU,teacherU,guardianU,strangerU,other]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Study year',$3,$4)",[year,school,shift(-100),shift(100)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'JHS 1','JHS',30)",[basic5,jhs1,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic study assignment',$7)",[randomUUID(),school,basic5,teacherM,shift(-30),shift(60),headM]);
  ama=randomUUID();yaw=randomUUID();kojo=randomUUID();
  for(const [id,name,cls] of [[ama,'Ama Mensah',basic5],[yaw,'Yaw Boateng',jhs1],[kojo,'Kojo Quaye',basic5]]){await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`ST-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,id,cls,shift(-50)]);}
  const link=(child:string,academic:boolean)=>owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',$5,false,true,false,now(),$6,'Synthetic verification')",[randomUUID(),school,child,guardianM,academic,headM]);
  await link(ama,true);await link(yaw,true);await link(kojo,false);
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 2',startDate:shift(-55),endDate:shift(30)})).id;
  const add=(grade:string|undefined,items:object[])=>ok('/assessment/indicators','POST',{subjectId:maths,origin:'local',sourceNote:'Synthetic scheme of work',...(grade?{grade}:{}),items});
  await add('Basic 5',[{code:'S5.1',description:'Adds fractions with like denominators'}]);await add('JHS 1',[{code:'S1.1',description:'Solves simple linear equations in one unknown'}]);await add(undefined,[{code:'SA.1',description:'Rounds decimals to the nearest whole number'}]);
  const items=(await call(`/assessment/indicators?subjectId=${maths}`)).body.items;const id=(code:string)=>items.find((i:any)=>i.code===code).id as string;
  Object.assign(topic,{fractions:id('S5.1'),equations:id('S1.1'),decimals:id('SA.1')});
  const setting=(await call('/practice/settings')).body;await ok('/practice/settings','PUT',{enabled:true,...(setting.version?{version:setting.version}:{})},head,200);
  await ok('/ai/settings','PUT',{enabled:true,monthlyRunCap:500,acknowledgement:'Parents agreed AI drafting in the data-protection notice'},head,200);
  const approved=(await ok('/learning/topics/approve','POST',{termId,items:[{indicatorId:topic.fractions},{indicatorId:topic.equations},{indicatorId:topic.decimals,grade:'Basic 5'}]},head)).approved;
  for(const a of approved){approval[Object.keys(topic).find(k=>topic[k]===a.indicatorId)!]=a.approvalId;const made=await generate(a.approvalId);assert.equal(made.body.generated,true,JSON.stringify(made.body));}
});
after(async()=>{delete process.env.AI_ENABLED;delete process.env.READ_ONLY_SCHOOL_IDS;await app?.close();await owner.end();await runtime.end();});

test('Study is offered only for a topic approved for the child\'s class that has a current lesson',async()=>{
  assert.equal((await card(ama,topic.fractions)).hasLesson,true);assert.equal((await card(ama,topic.decimals)).hasLesson,true);assert.equal((await card(yaw,topic.equations)).hasLesson,true);
  const lessonOf=async(indicatorId:string,grade:string)=>(await owner.query("SELECT id FROM topic_lessons WHERE school_id=$1 AND indicator_id=$2 AND lower(grade)=lower($3) AND retired_at IS NULL",[school,indicatorId,grade])).rows[0].id as string;
  await ok(`/learning/lessons/${await lessonOf(topic.decimals,'Basic 5')}/retire`,'POST',{reason:'The example is confusing'},teacher);
  assert.equal((await card(ama,topic.decimals)).hasLesson,false,'a retired lesson is not offered');
  assert.equal((await startStudy(ama,topic.decimals)).status,404,'and cannot be started');
  assert.equal((await startStudy(ama,topic.equations)).status,404,'a JHS 1 topic is not for a Basic 5 child');
  // Ama's class work turns out weak on that JHS 1 topic, and the school has a hand-written set for it, so she can practise it. The lesson made for JHS 1
  // is still not hers: a lesson counts only for a topic approved for the child's own class.
  const choice=(level:number,n:number)=>({level,kind:'choice',prompt:`Level ${level} choice ${n}: what is ${n} + ${level}?`,options:[String(n+level),String(n+level+1),String(n+level+2)],correctOption:0,explanation:`${n} plus ${level} is ${n+level}.`});
  await ok(`/assessment/indicators/${topic.equations}/questions`,'POST',{questions:[1,2,3].flatMap(level=>[1,2,3,4,5,6].map(n=>choice(level,n)))},teacher);
  const quiz=await ok(`/assessment/classes/${basic5}/assessments`,'POST',{termId,subjectId:maths,kind:'quiz',title:'Equations quiz',heldOn:shift(-4),maxMark:100,indicatorIds:[topic.equations]},teacher);
  await ok(`/assessment/classes/${basic5}/assessments/${quiz.id}/marks`,'POST',{marks:[{learnerId:ama,mark:10}]},teacher);
  const weak=await card(ama,topic.equations);assert.ok(weak,'offered as a weak topic from the teacher\'s set');assert.equal(weak.hasLesson,false,'but with no lesson');
  assert.equal((await startStudy(ama,topic.equations)).status,404);
  assert.equal((await startStudy(ama,randomUUID())).status,404);
  assert.equal((await startStudy(ama,topic.fractions,stranger)).status,404,'a guardian with no link to the child');
  assert.equal((await startStudy(kojo,topic.fractions)).status,404,'a link without the academic right');
  assert.equal((await startStudy(ama,topic.fractions,teacher)).status,403,'staff are not families');
  // Bring the lesson back for the tests that follow.
  assert.equal((await generate(approval.decimals)).body.lesson,'made');assert.equal((await card(ama,topic.decimals)).hasLesson,true);
});

test('starting Study returns the lesson in the presentation for the child\'s stage, and resuming returns the same session',async()=>{
  const first=await startStudy(ama,topic.fractions);assert.equal(first.status,201,JSON.stringify(first.body));
  assert.deepEqual([first.body.stage,first.body.label],['upper_primary',"Made by AI from your school's topics"]);
  assert.equal(first.body.lesson.steps.length,3);assert.match(first.body.lesson.goal,/You will learn this/);assert.ok(first.body.lesson.example.problem&&first.body.lesson.recap.length>=2);
  assert.equal(first.body.subject,'Mathematics');assert.equal(first.body.topic,'Adds fractions with like denominators');
  const again=await startStudy(ama,topic.fractions);assert.equal(again.body.studySessionId,first.body.studySessionId,'a lesson started again soon after resumes');
  const row=(await owner.query("SELECT lesson_id,finished_at,guardian_membership_id FROM study_sessions WHERE id=$1",[first.body.studySessionId])).rows[0];
  assert.equal(row.lesson_id,first.body.lessonId);assert.equal(row.finished_at,null);assert.equal(row.guardian_membership_id,guardianM);
  const jhs=await startStudy(yaw,topic.equations);assert.equal(jhs.status,201,JSON.stringify(jhs.body));assert.equal(jhs.body.stage,'jhs','JHS students get the whole lesson on one page');
  // Family practice must be switched on.
  const setting=(await call('/practice/settings')).body;await ok('/practice/settings','PUT',{enabled:false,version:setting.version},head,200);
  assert.equal((await startStudy(ama,topic.fractions)).status,409);
  const off=(await call('/practice/settings')).body;await ok('/practice/settings','PUT',{enabled:true,version:off.version},head,200);
});

test('finishing records the time once, and the check afterwards is a practice session tied to the study',async()=>{
  const s=(await startStudy(ama,topic.fractions)).body;
  const unfinished=(await startStudy(ama,topic.fractions)).body;
  assert.equal((await startCheck(ama,topic.fractions,unfinished.studySessionId)).status,400,'a check follows a lesson that was finished');
  const done=await finishStudy(ama,s.studySessionId);assert.equal(done.status,201,JSON.stringify(done.body));assert.deepEqual(done.body,{finished:true},'the family is told it is finished, not how long it took');
  assert.equal(Number((await owner.query("SELECT count(*) FROM audit_events WHERE school_id=$1 AND action='practice.study.finished' AND target_id=$2",[school,s.studySessionId])).rows[0].count),1,'finishing is recorded');
  assert.equal((await finishStudy(ama,s.studySessionId)).status,201,'finishing twice is harmless');
  assert.equal((await finishStudy(yaw,s.studySessionId)).status,404,'another child\'s study');assert.equal((await finishStudy(ama,s.studySessionId,stranger)).status,404);
  await assert.rejects(owner.query("UPDATE study_sessions SET finished_at=now() WHERE id=$1",[s.studySessionId]),/only be finished/);
  await assert.rejects(owner.query("UPDATE study_sessions SET lesson_id=lesson_id,started_at=now() WHERE id=$1",[s.studySessionId]),/only be finished/);
  await assert.rejects(owner.query("DELETE FROM study_sessions WHERE id=$1",[s.studySessionId]),/are kept/);
  // The check: a normal practice session, tied to the study.
  const yawStudy=(await startStudy(yaw,topic.equations)).body;
  assert.equal((await startCheck(ama,topic.fractions,yawStudy.studySessionId)).status,404,'a study that is not this child\'s');
  assert.equal((await startCheck(ama,topic.decimals,s.studySessionId)).status,400,'a study of another topic');
  assert.equal((await startCheck(ama,topic.fractions,randomUUID())).status,404);
  const check=await startCheck(ama,topic.fractions,s.studySessionId);assert.equal(check.status,201,JSON.stringify(check.body));
  assert.equal((await owner.query("SELECT study_session_id FROM practice_sessions WHERE id=$1",[check.body.sessionId])).rows[0].study_session_id,s.studySessionId);
  await assert.rejects(owner.query("UPDATE practice_sessions SET study_session_id=NULL WHERE id=$1",[check.body.sessionId]),/only be completed/,'the tie cannot be removed');
  const summary=await play(ama,check.body.sessionId,check.body);assert.equal(summary.summary.total,5);
  // Staff see the study beside class work: topic, when, minutes and how the check went.
  for(const who of [head,teacher]){
    const evidence=(await call(`/learners/${ama}/practice`,'GET',undefined,who)).body;
    const seen=evidence.studies.find((x:any)=>x.topic==='Adds fractions with like denominators');
    assert.ok(seen,'the study is listed');assert.ok(Number.isInteger(seen.minutes)&&seen.minutes>=0&&seen.minutes<=30,'minutes are a whole number, never more than half an hour');assert.deepEqual([seen.check.total,typeof seen.check.correct],[5,'number']);
  }
  assert.equal((await call(`/learners/${ama}/practice`,'GET',undefined,guardian)).status,403);
  // A study with no check yet shows without one.
  const lone=(await startStudy(yaw,topic.equations)).body;await finishStudy(yaw,lone.studySessionId);
  const evidenceYaw=(await call(`/learners/${yaw}/practice`)).body;assert.equal(evidenceYaw.studies[0].check,null);
  // Studying counts toward the daily limit only through the check: a second practice session on the topic is allowed, a third is not.
  const again=await startCheck(ama,topic.fractions,s.studySessionId);assert.equal(again.status,409,'a study has one check');assert.match(again.body.message,/already/);
  const second=await startCheck(ama,topic.fractions);assert.equal(second.status,201);await play(ama,second.body.sessionId,second.body);
  const third=await startCheck(ama,topic.fractions);assert.equal(third.status,409);assert.match(third.body.message,/enough practice/);
});

test('a parent can report a lesson their child was shown: it stops at once and the teacher is told without learning who',async()=>{
  const s=(await startStudy(ama,topic.decimals)).body;const lesson=s.lessonId as string;
  assert.equal((await reportLesson(ama,lesson,{reason:'bad'})).status,400);
  assert.equal((await reportLesson(ama,lesson,{reason:'unclear'},stranger)).status,404,'a guardian with no link');
  assert.equal((await reportLesson(kojo,lesson)).status,404,'a link without the academic right');
  assert.equal((await reportLesson(yaw,lesson)).status,404,'a lesson this child was not shown');
  assert.equal((await reportLesson(ama,randomUUID())).status,404);
  const done=await reportLesson(ama,lesson,{reason:'wrong_answer',note:'The example does not make sense'});assert.equal(done.status,201,JSON.stringify(done.body));assert.deepEqual(done.body,{flagged:true});
  const row=(await owner.query("SELECT retired_at,retired_by,retired_cause FROM topic_lessons WHERE id=$1",[lesson])).rows[0];assert.ok(row.retired_at);assert.deepEqual([row.retired_by,row.retired_cause],[null,'flag']);
  assert.equal((await reportLesson(ama,lesson,{reason:'unclear'})).status,201,'the same person reporting again is the same report');
  const flag=(await owner.query("SELECT question_id,lesson_id FROM content_flags WHERE school_id=$1 AND lesson_id=$2",[school,lesson])).rows;assert.deepEqual(flag.map(f=>[f.question_id,f.lesson_id]),[[null,lesson]]);
  assert.equal((await card(ama,topic.decimals)).hasLesson,false,'no current lesson, so Study is not offered');assert.equal((await startStudy(ama,topic.decimals)).status,404);
  assert.ok(await card(ama,topic.decimals),'practice on the topic still works');
  // The staff see the lesson that was reported and which topic it is for, not the parent.
  const flags=(await call('/learning/flags','GET',undefined,teacher)).body.items;const mine=flags.find((f:any)=>f.target==='lesson');
  assert.ok(mine);assert.deepEqual([mine.reason,mine.note,mine.topic.indicatorId],['wrong_answer','The example does not make sense',topic.decimals]);assert.match(mine.lesson.retired.reason,/something in it looks wrong/i,'the reason reads as a lesson\'s, not a question\'s');assert.match(mine.lesson.goal,/You will learn this/);assert.ok(mine.lesson.steps.length>=3);
  assert.doesNotMatch(JSON.stringify(flags),new RegExp(`Abena|${guardianM}|${guardianU}|guardian@example|raised`));
  assert.equal(flags.every((f:any)=>f.target==='lesson'||f.target==='question'),true);
  assert.equal((await call('/learning/flags','GET',undefined,guardian)).status,403);
  assert.equal(Number((await call(`/learning/topics?termId=${termId}`)).body.openFlags),1);
  await ok(`/learning/flags/${mine.id}/handle`,'POST',{outcome:'was_wrong'},teacher);assert.equal((await call('/learning/flags')).body.items.length,0);
  // The next request makes a new lesson, and Study is back.
  assert.equal((await generate(approval.decimals)).body.lesson,'made');assert.equal((await card(ama,topic.decimals)).hasLesson,true);
  await assert.rejects(owner.query("UPDATE content_flags SET lesson_id=NULL,question_id=(SELECT id FROM practice_questions LIMIT 1) WHERE lesson_id=$1",[lesson]),/only be handled/);
});

test('a report names exactly one thing, and one parent\'s reports share one daily allowance',async()=>{
  await assert.rejects(owner.query("INSERT INTO content_flags(id,school_id,raised_by,reason) VALUES($1,$2,$3,'other')",[randomUUID(),school,guardianM]),/violates check constraint/,'a report with nothing reported');
  const q=(await owner.query("SELECT q.id FROM practice_questions q LIMIT 1")).rows[0].id,l=(await owner.query("SELECT id FROM topic_lessons LIMIT 1")).rows[0].id;
  await assert.rejects(owner.query("INSERT INTO content_flags(id,school_id,question_id,lesson_id,raised_by,reason) VALUES($1,$2,$3,$4,$5,'other')",[randomUUID(),school,q,l,guardianM]),/violates check constraint/,'a report cannot name both');
  // Ten reports already made today (questions or lessons) leave nothing for a lesson report.
  const day="created_at>=(date_trunc('day',now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra')";
  const used=Number((await owner.query(`SELECT count(*) FROM content_flags WHERE school_id=$1 AND raised_by=$2 AND ${day}`,[school,guardianM])).rows[0].count);
  for(const r of (await owner.query("SELECT q.id FROM practice_questions q WHERE q.school_id=$1 AND NOT EXISTS (SELECT 1 FROM content_flags f WHERE f.question_id=q.id) ORDER BY q.id LIMIT $2",[school,10-used])).rows)
    await owner.query("INSERT INTO content_flags(id,school_id,question_id,raised_by,reason) VALUES($1,$2,$3,$4,'other')",[randomUUID(),school,r.id,guardianM]);
  const s=(await startStudy(yaw,topic.equations)).body;const over=await reportLesson(yaw,s.lessonId);assert.equal(over.status,429,JSON.stringify(over.body));
  assert.equal((await owner.query("SELECT retired_at FROM topic_lessons WHERE id=$1",[s.lessonId])).rows[0].retired_at,null,'a refused report retires nothing');
});

test('Study starts are limited to three a topic a day, and a lesson that is still open resumes instead of counting again',async()=>{
  const day="started_at>=(date_trunc('day',now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra')";
  const used=async()=>Number((await owner.query(`SELECT count(*) FROM study_sessions WHERE school_id=$1 AND learner_id=$2 AND indicator_id=$3 AND ${day}`,[school,ama,topic.fractions])).rows[0].count);
  // Starts for one child and topic go one at a time: with the lock held elsewhere, a start waits for it instead of racing past.
  const holder=await owner.connect(),key=`study:${ama}:${topic.fractions}`;let waiting:Promise<{status:number;body:any}>|undefined;
  try{
    await holder.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[key]);
    waiting=startStudy(ama,topic.fractions);let settled=false;void waiting.then(()=>{settled=true;});
    await new Promise(done=>setTimeout(done,500));assert.equal(settled,false,'the start is waiting its turn');
  }finally{await holder.query("SELECT pg_advisory_unlock_all()");holder.release();}
  assert.equal((await waiting!).status,201);
  // Two starts at once do not make two open lessons.
  const open=await Promise.all([startStudy(ama,topic.fractions),startStudy(ama,topic.fractions)]);
  assert.deepEqual(open.map(r=>r.status),[201,201]);assert.equal(open[0]!.body.studySessionId,open[1]!.body.studySessionId,'one session, however many taps');
  assert.equal(Number((await owner.query(`SELECT count(*) FROM study_sessions WHERE school_id=$1 AND learner_id=$2 AND indicator_id=$3 AND finished_at IS NULL AND ${day}`,[school,ama,topic.fractions])).rows[0].count),1);
  // Finish and start again until the day's three are used.
  let id=open[0]!.body.studySessionId as string;
  while(await used()<3){await finishStudy(ama,id);const next=await startStudy(ama,topic.fractions);assert.equal(next.status,201,JSON.stringify(next.body));id=next.body.studySessionId;}
  assert.equal(await used(),3);
  assert.equal((await startStudy(ama,topic.fractions)).body.studySessionId,id,'the lesson still open can be resumed at the limit');
  await finishStudy(ama,id);
  const over=await startStudy(ama,topic.fractions);assert.equal(over.status,409,JSON.stringify(over.body));assert.match(over.body.message,/enough study/);
  assert.equal(await used(),3,'a refused start records nothing');
  assert.equal((await startStudy(ama,topic.decimals)).status,201,'another topic has its own allowance');
});

test('a JHS class gets the whole lesson on one page whatever it is called, and the database keeps the study times and ties honest',async()=>{
  const form1=randomUUID(),esi=randomUUID();
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Form 1','JHS',30)",[form1,school,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Esi Owusu')",[esi,school,`ST-${esi.slice(0,8)}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,esi,form1,shift(-50)]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,true,false,now(),$5,'Synthetic verification')",[randomUUID(),school,esi,guardianM,headM]);
  const formApproval=(await ok('/learning/topics/approve','POST',{termId,items:[{indicatorId:topic.decimals,grade:'Form 1'}]},head)).approved[0].approvalId;
  const seen=prompts.length;assert.equal((await generate(formApproval)).body.generated,true);
  assert.ok(prompts.length>seen&&prompts.slice(seen).every(p=>/JHS Form 1/.test(p)),'Claude is told this is a JHS class, so the wording is pitched for JHS and not by the name');
  const jhs=await startStudy(esi,topic.decimals);assert.equal(jhs.status,201,JSON.stringify(jhs.body));assert.equal(jhs.body.stage,'jhs','the class is a JHS class, so the stage follows its level, not its name');

  // Times are the database's own: a start cannot be backdated or born finished, and a lesson belongs to its topic.
  const real=(await owner.query("SELECT learner_id,indicator_id,lesson_id,guardian_membership_id FROM study_sessions WHERE id=$1",[jhs.body.studySessionId])).rows[0];
  const forged=randomUUID();
  await owner.query("INSERT INTO study_sessions(id,school_id,learner_id,indicator_id,lesson_id,guardian_membership_id,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '3 hours',now())",[forged,school,real.learner_id,real.indicator_id,real.lesson_id,real.guardian_membership_id]);
  const row=(await owner.query("SELECT finished_at,started_at>now()-interval '1 minute' AS fresh FROM study_sessions WHERE id=$1",[forged])).rows[0];assert.deepEqual([row.finished_at,row.fresh],[null,true]);
  await assert.rejects(owner.query("INSERT INTO study_sessions(id,school_id,learner_id,indicator_id,lesson_id,guardian_membership_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),school,real.learner_id,topic.fractions,real.lesson_id,real.guardian_membership_id]),/violates foreign key/,'a lesson of another topic');
  const yawStudy=(await startStudy(yaw,topic.equations)).body.studySessionId as string,set=(await owner.query("SELECT id FROM practice_sets WHERE school_id=$1 AND indicator_id=$2 AND source='generated' LIMIT 1",[school,topic.fractions])).rows[0].id;
  await assert.rejects(owner.query("INSERT INTO practice_sessions(id,school_id,learner_id,indicator_id,set_id,guardian_membership_id,level,study_session_id) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[randomUUID(),school,ama,topic.fractions,set,guardianM,yawStudy]),/another child|another topic|study/i,'a check tied to someone else\'s study');
  // However long a page was left open, staff see at most half an hour.
  await owner.query("UPDATE study_sessions SET finished_at=started_at+interval '2 hours' WHERE id=$1",[forged]);
  const evidence=(await call(`/learners/${esi}/practice`)).body;assert.equal(evidence.studies.find((x:any)=>x.topic==='Rounds decimals to the nearest whole number').minutes,30);
});

test('study sessions belong to one school',async()=>{
  const real=(await owner.query("SELECT learner_id,indicator_id,lesson_id,guardian_membership_id FROM study_sessions WHERE school_id=$1 LIMIT 1",[school])).rows[0];
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[other]);
    assert.equal((await client.query('SELECT 1 FROM study_sessions')).rowCount,0,'another school cannot read study sessions');
    await assert.rejects(client.query("INSERT INTO study_sessions(id,school_id,learner_id,indicator_id,lesson_id,guardian_membership_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),school,real.learner_id,real.indicator_id,real.lesson_id,real.guardian_membership_id]),/row-level security/);
    await client.query('ROLLBACK');
  }finally{client.release();}
  assert.equal((await call(`${study}/${ama}/study/sessions`,'POST',{operationId:randomUUID(),indicatorId:topic.fractions},guardian,other)).status,404,'the other school has no such child');
});

test('on a read-only demo school Study can be tried, but a lesson cannot be reported',async()=>{
  process.env.READ_ONLY_SCHOOL_IDS=school;
  try{
    const s=await startStudy(yaw,topic.equations);assert.equal(s.status,201,JSON.stringify(s.body));assert.equal((await finishStudy(yaw,s.body.studySessionId)).status,201);
    const blocked=await reportLesson(yaw,s.body.lessonId);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'READ_ONLY_DEMO');
  }finally{delete process.env.READ_ONLY_SCHOOL_IDS;}
});
