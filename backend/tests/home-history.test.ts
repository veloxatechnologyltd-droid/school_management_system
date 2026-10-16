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
  await account(strangerU,`history-stranger-${suffix}@example.test`);
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));stranger=await login(`history-stranger-${suffix}@example.test`);
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'History school'),($2,'History other school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$6,$7,'headteacher'),($2,$6,$8,'teacher'),($3,$6,$9,'guardian'),($4,$6,$10,'guardian'),($5,$11,$7,'headteacher')",[headM,teacherM,guardianM,strangerM,otherHeadM,school,headU,teacherU,guardianU,strangerU,other]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'History year',$3,$4)",[year,school,shift(-100),shift(100)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'JHS 1','JHS',30)",[basic5,jhs1,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic history assignment',$7)",[randomUUID(),school,basic5,teacherM,shift(-30),shift(60),headM]);
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

// The history a family can revisit and staff can read: lessons read and practice sessions finished, with each question, what the child chose, the right answer and why.
const history=(child:string,actor=guardian)=>call(`${practice}/${child}/history`,'GET',undefined,actor);
const entry=(child:string,kind:string,id:string,actor=guardian)=>call(`${practice}/${child}/history/${kind}/${id}`,'GET',undefined,actor);
const staffHistory=(child:string,actor=teacher)=>call(`/learners/${child}/practice/history`,'GET',undefined,actor);
const staffEntry=(child:string,kind:string,id:string,actor=teacher)=>call(`/learners/${child}/practice/history/${kind}/${id}`,'GET',undefined,actor);
// Answers every question of a check, choosing option 0, 1, 0, 1, 0, and remembers what the child was told each time.
async function sit(child:string,indicatorId:string,studyId?:string,stopAfter=5){
  const started=await startCheck(child,indicatorId,studyId);assert.equal(started.status,201,JSON.stringify(started.body));
  let view=started.body;const answers:any[]=[];
  for(let i=0;i<stopAfter;i++){
    const choice=i%2,r=await call(`${practice}/${child}/practice/sessions/${view.sessionId}/answer`,'POST',{operationId:randomUUID(),questionId:view.next.questionId,choice},guardian);assert.equal(r.status,201,JSON.stringify(r.body));
    answers.push({questionId:view.next.questionId,prompt:view.next.prompt,choice,result:r.body});
    if(r.body.summary)return {sessionId:view.sessionId as string,answers,summary:r.body.summary};
    view=(await call(`${practice}/${child}/practice/sessions/${view.sessionId}`,'GET',undefined,guardian)).body;
  }
  return {sessionId:view.sessionId as string,answers,summary:null};
}
const done:{studyId?:string,checkId?:string,answers?:any[],summary?:any}={};

test('a child who has done nothing has an empty history',async()=>{
  const r=await history(ama);assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.items,[]);assert.equal(r.body.enabled,true);
});

test('the history lists finished lessons and checks, newest first; what was started and not finished is left out; the family is not told the minutes',async()=>{
  const study=await startStudy(ama,topic.fractions);assert.equal(study.status,201,JSON.stringify(study.body));await finishStudy(ama,study.body.studySessionId);
  const check=await sit(ama,topic.fractions,study.body.studySessionId);
  Object.assign(done,{studyId:study.body.studySessionId,checkId:check.sessionId,answers:check.answers,summary:check.summary});
  // Started and not finished: a lesson never reached the end of, and a check with two of five answered.
  assert.equal((await startStudy(ama,topic.decimals)).status,201);const partial=await sit(ama,topic.decimals,undefined,2);assert.equal(partial.summary,null);
  const r=await history(ama);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i:any)=>i.kind),['practice','study'],'the check, then the lesson before it; nothing unfinished');
  const [practiceItem,studyItem]=r.body.items;
  assert.deepEqual([practiceItem.id,practiceItem.subject,practiceItem.topic,practiceItem.level,practiceItem.correct,practiceItem.total,practiceItem.afterStudy],[done.checkId,'Mathematics','Adds fractions with like denominators',1,done.summary.correct,5,true]);
  assert.deepEqual([studyItem.id,studyItem.topic,studyItem.check],[done.studyId,'Adds fractions with like denominators',{correct:done.summary.correct,total:5}]);
  assert.match(practiceItem.on,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal('minutes' in studyItem,false,'minutes are for staff');
  const text=JSON.stringify(r.body);assert.doesNotMatch(text,/guardian|membership|operation/i,'nothing about who did it');
});

test('a finished check shows each question, what the child chose, the right answer and why',async()=>{
  const r=await entry(ama,'practice',done.checkId!);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual([r.body.kind,r.body.topic,r.body.level,r.body.correct,r.body.total,r.body.madeByAi],['practice','Adds fractions with like denominators',1,done.summary.correct,5,true]);
  assert.equal(r.body.questions.length,5);
  r.body.questions.forEach((q:any,i:number)=>{
    const said=done.answers![i];
    assert.deepEqual([q.position,q.prompt,q.kind,q.given,q.correct,q.correctOption,q.explanation,q.withdrawn],[i+1,said.prompt,'choice',said.choice,said.result.correct,said.result.correctOption,said.result.explanation,false]);
    assert.equal(q.options.length,3);
  });
  assert.equal(r.body.questions.filter((q:any)=>q.correct).length,done.summary.correct);
});

test('a finished lesson can be read again exactly as it was shown, with its check',async()=>{
  const r=await entry(ama,'study',done.studyId!);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.kind,'study');assert.equal(r.body.topic,'Adds fractions with like denominators');assert.equal(r.body.withdrawn,false);
  assert.equal(r.body.lesson.steps.length,3);assert.match(r.body.lesson.goal,/You will learn this/);assert.ok(r.body.lesson.example.problem&&r.body.lesson.recap.length>=2);
  assert.equal(r.body.label,"Made by AI from your school's topics");assert.deepEqual(r.body.check,{sessionId:done.checkId,correct:done.summary.correct,total:5});
  assert.equal('minutes' in r.body,false);
});

test('an unfinished session is not in the history: its questions and answers stay hidden until it is done',async()=>{
  const open=(await owner.query("SELECT id FROM practice_sessions WHERE school_id=$1 AND learner_id=$2 AND completed_at IS NULL",[school,ama])).rows[0].id as string;
  assert.equal((await entry(ama,'practice',open)).status,404);
  const unread=(await owner.query("SELECT id FROM study_sessions WHERE school_id=$1 AND learner_id=$2 AND finished_at IS NULL",[school,ama])).rows[0].id as string;
  assert.equal((await entry(ama,'study',unread)).status,404);
  assert.equal((await entry(ama,'anything',done.checkId!)).status,404,'only lessons and practice');
  assert.equal((await entry(ama,'practice',randomUUID())).status,404);
});

test('only the child\'s verified guardian with the academic right can open it, and another child\'s session is not reachable through this child',async()=>{
  assert.equal((await history(ama,stranger)).status,404);assert.equal((await entry(ama,'practice',done.checkId!,stranger)).status,404,'a guardian of no one here');
  assert.equal((await history(kojo)).status,404,'a link without the academic right');
  assert.equal((await entry(yaw,'practice',done.checkId!)).status,404,'Ama\'s session through Yaw\'s page');
  assert.equal((await history(ama,teacher)).status,403,'staff use their own page');assert.equal((await entry(ama,'practice',done.checkId!,teacher)).status,403);
  assert.ok([403,404].includes((await call(`${practice}/${ama}/history`,'GET',undefined,head,other)).status),'another school');
  // Guardian rights cannot be edited in place, so a link is revoked through its own route, on a child of its own.
  const esi=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Esi Quartey')",[esi,school,`ST-${esi.slice(0,8)}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,esi,basic5,shift(-50)]);
  const linkId=randomUUID();
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,false,false,clock_timestamp(),$5,'Synthetic history verification')",[linkId,school,esi,guardianM,headM]);
  const study=await startStudy(esi,topic.fractions);await finishStudy(esi,study.body.studySessionId);const check=await sit(esi,topic.fractions,study.body.studySessionId);
  assert.equal((await history(esi)).body.items.length,2);assert.equal((await entry(esi,'practice',check.sessionId)).status,200);
  await ok(`/guardian-links/${linkId}/revoke`,'POST',{version:1,reason:'Synthetic revocation for the history test'},head,201);
  assert.equal((await history(esi)).status,404,'a revoked link sees nothing');assert.equal((await entry(esi,'practice',check.sessionId)).status,404);assert.equal((await entry(esi,'study',study.body.studySessionId)).status,404);
});

test('staff see the same history with the minutes, only for a learner they teach today',async()=>{
  const r=await staffHistory(ama);assert.equal(r.status,200,JSON.stringify(r.body));
  const studyItem=r.body.items.find((i:any)=>i.kind==='study');assert.equal(typeof studyItem.minutes,'number');
  assert.equal((await staffEntry(ama,'practice',done.checkId!)).body.questions.length,5);
  const lesson=await staffEntry(ama,'study',done.studyId!);assert.equal(lesson.status,200);assert.equal(typeof lesson.body.minutes,'number');
  assert.equal((await staffHistory(ama,head)).status,200,'the headteacher');
  assert.equal((await staffHistory(yaw)).status,404,'a learner in a class the teacher does not teach');assert.equal((await staffEntry(yaw,'practice',done.checkId!)).status,404);
  assert.equal((await staffHistory(ama,guardian)).status,403,'a family is not staff');
});

test('a question reported meanwhile or a lesson retired is still listed, but its answer key and text are withdrawn',async()=>{
  const flagged=done.answers![0];
  const report=await call(`${practice}/${ama}/practice/questions/${flagged.questionId}/flag`,'POST',{operationId:randomUUID(),reason:'wrong_answer'},guardian);assert.equal(report.status,201,JSON.stringify(report.body));
  const r=await entry(ama,'practice',done.checkId!);assert.equal(r.status,200);
  const [first,...rest]=r.body.questions;
  assert.deepEqual([first.withdrawn,first.correct,first.correctOption,first.explanation,first.prompt,first.given],[true,null,null,null,flagged.prompt,flagged.choice],'the child\'s own answer stays; the key and explanation do not');
  assert.ok(rest.every((q:any)=>q.withdrawn===false&&q.correctOption!==null));
  const lessonId=(await owner.query("SELECT lesson_id FROM study_sessions WHERE id=$1",[done.studyId])).rows[0].lesson_id as string;
  await ok(`/learning/lessons/${lessonId}/retire`,'POST',{reason:'The example is confusing'},teacher);
  const lesson=await entry(ama,'study',done.studyId!);assert.equal(lesson.status,200);assert.deepEqual([lesson.body.withdrawn,lesson.body.lesson],[true,null]);
  const staff=await staffEntry(ama,'practice',done.checkId!);assert.equal(staff.body.questions[0].withdrawn,true,'staff see the withdrawal too');
});

test('when home practice is switched off a family sees an empty history, and staff can still read it',async()=>{
  const setting=(await call('/practice/settings')).body;await ok('/practice/settings','PUT',{enabled:false,version:setting.version},head,200);
  try{
    const r=await history(ama);assert.equal(r.status,200);assert.deepEqual([r.body.enabled,r.body.items],[false,[]]);
    assert.equal((await entry(ama,'practice',done.checkId!)).status,409);
    assert.equal((await staffHistory(ama)).status,200);assert.ok((await staffHistory(ama)).body.items.length>=2);
  }finally{const now=(await call('/practice/settings')).body;await ok('/practice/settings','PUT',{enabled:true,version:now.version},head,200);}
});
