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
const strangerU=randomUUID(),teacher2U=randomUUID(),teacher2M=randomUUID(),suffix=randomUUID().slice(0,8);
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,teacher2:any,guardian:any,stranger:any,maths:string,termId:string,ama:string,yaw:string,kojo:string;
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
  await account(strangerU,`notes-stranger-${suffix}@example.test`);await account(teacher2U,`notes-teacher2-${suffix}@example.test`);
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));stranger=await login(`notes-stranger-${suffix}@example.test`);teacher2=await login(`notes-teacher2-${suffix}@example.test`);
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Notes school'),($2,'Notes other school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$6,$7,'headteacher'),($2,$6,$8,'teacher'),($3,$6,$9,'guardian'),($4,$6,$10,'guardian'),($5,$11,$7,'headteacher'),($12,$6,$13,'teacher')",[headM,teacherM,guardianM,strangerM,otherHeadM,school,headU,teacherU,guardianU,strangerU,other,teacher2M,teacher2U]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Notes year',$3,$4)",[year,school,shift(-100),shift(100)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'JHS 1','JHS',30)",[basic5,jhs1,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic study assignment',$7)",[randomUUID(),school,basic5,teacherM,shift(-30),shift(60),headM]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Yaa Second',$5,$6,'Synthetic notes assignment',$7)",[randomUUID(),school,jhs1,teacher2M,shift(-30),shift(60),headM]);
  ama=randomUUID();yaw=randomUUID();kojo=randomUUID();
  for(const [id,name,cls] of [[ama,'Ama Mensah',basic5],[yaw,'Yaw Boateng',jhs1],[kojo,'Kojo Quaye',basic5]]){await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`LN-${id.slice(0,8)}`,name]);
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


const write=(child:string,body:Record<string,unknown>,actor=teacher)=>call(`/learners/${child}/learning-notes`,'POST',{operationId:randomUUID(),...body},actor);
const list=(child:string,actor=head)=>call(`/learners/${child}/learning-notes`,'GET',undefined,actor);
const withdraw=(id:string,reason:string,actor=teacher)=>call(`/learning-notes/${id}/withdraw`,'POST',{operationId:randomUUID(),reason},actor);
const offered=async(child:string)=>((await overview(child)).topics as any[]).map(t=>t.indicatorId);

test('a teacher of the student, or the head, writes a note; nobody else can',async()=>{
  const first=await write(ama,{note:'Use money examples, and keep the sentences short'});assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal((await write(ama,{note:'Extra practice with carrying this month'},head)).status,201,'the head may write one too');
  assert.equal((await write(ama,{note:'A teacher of another class'},teacher2)).status,404,'a teacher who does not teach the student');
  assert.equal((await write(ama,{note:'A parent writing one'},guardian)).status,403);assert.equal((await write(ama,{note:'Someone with no link'},stranger)).status,403);
  assert.equal((await write(randomUUID(),{note:'Nobody here by that id'})).status,404);
  assert.equal((await write(ama,{note:'no'})).status,400,'too short');assert.equal((await write(ama,{note:'x'.repeat(241)})).status,400,'too long');
  assert.equal((await write(ama,{note:'Fine wording here',secret:'x'})).status,400,'unknown fields are refused');
  const seen=(await list(ama,teacher)).body;assert.equal(seen.items.length,2);
  const mine=seen.items.find((n:any)=>n.note.startsWith('Use money'));assert.deepEqual([mine.authorName.length>0,mine.mine,mine.canWithdraw,mine.withdrawn],[true,true,true,null]);
  assert.equal((await list(ama,teacher2)).status,404);assert.equal((await list(ama,guardian)).status,403);assert.equal((await list(ama,stranger)).status,403);
  assert.equal((await call(`/learners/${ama}/learning-notes`,'GET',undefined,head,other)).status,404,'another school has no such student');
});

test('a note is for how to help, so it keeps out names, health and family matters and labels',async()=>{
  const bad=async(note:string,why:RegExp)=>{const r=await write(ama,{note});assert.equal(r.status,400,`${note}: ${JSON.stringify(r.body)}`);assert.match(r.body.message,why);};
  await bad('Ama finds it hard to follow long explanations',/name/i);await bad('Mensah needs a seat near the front',/name/i);await bad(`Admission number LN-${ama.slice(0,8)} needs extra time`,/name|admission/i);
  for(const word of ['She is often unwell so go gently','Down with malaria again this week','She has asthma so she misses games','Recently bereaved, be gentle','Her parents are going through a divorce','He was diagnosed with dyslexia','On medication for epilepsy','This is a slow learner'])await bad(word,/health|family|private|label/i);
  assert.equal((await write(ama,{note:'Needs a seat near the front, and short instructions'})).status,201,'ordinary wording about how to help is fine');
  assert.equal(Number((await owner.query("SELECT count(*) FROM learning_notes WHERE school_id=$1 AND learner_id=$2",[school,ama])).rows[0].count),3,'refused notes are not stored');
});

test('a note can name a topic, which then comes first on the child\'s list without the family being told why',async()=>{
  assert.deepEqual(await offered(ama),[],'with no class work and no note, nothing is offered ahead of the child\'s own choice');
  const pinned=await write(ama,{note:'Extra practice on this topic this month',indicatorId:topic.decimals});assert.equal(pinned.status,201,JSON.stringify(pinned.body));
  assert.deepEqual(await offered(ama),[topic.decimals],'the topic comes first');
  const o=await overview(ama);assert.ok(!o.explore.some((t:any)=>t.indicatorId===topic.decimals),'and is not listed twice');
  // The family sees only the order: no note, no sign that one exists.
  assert.doesNotMatch(JSON.stringify(o),/Extra practice on this topic|learning|teacher picked|chosen by/i);
  // The family's own notes screen never shows it either.
  const family=await call(`/guardian/children/${ama}/notes`,'GET',undefined,guardian);assert.equal(family.status,200);assert.doesNotMatch(JSON.stringify(family.body),/Extra practice on this topic|Use money examples|short sentences/i);
  // Only a topic that can be practised counts: another class level's topic is ignored.
  assert.equal((await write(ama,{note:'Extra on equations please',indicatorId:topic.equations})).status,400,'a topic not approved for the student\'s class');
  assert.equal((await write(ama,{note:'A topic that is not there',indicatorId:randomUUID()})).status,404);
  // An end date: the topic stays first until the day passes, and a date already past is refused.
  assert.equal((await write(ama,{note:'Until yesterday only',indicatorId:topic.fractions,until:shift(-1)})).status,400);
  const timed=await write(ama,{note:'Fractions first until next week',indicatorId:topic.fractions,until:shift(7)});assert.equal(timed.status,201,JSON.stringify(timed.body));
  assert.deepEqual(await offered(ama),[topic.fractions,topic.decimals],'the newest note\'s topic leads');
  // Withdrawing a note takes its topic off the front.
  const items=(await list(ama)).body.items;
  await ok(`/learning-notes/${items.find((n:any)=>n.note.startsWith('Fractions first')).id}/withdraw`,'POST',{reason:'Fractions done for now'},teacher);
  assert.deepEqual(await offered(ama),[topic.decimals]);
  // A note whose end date has passed no longer puts its topic first, though the topic is one the child could practise.
  await owner.query("INSERT INTO learning_notes(id,school_id,learner_id,indicator_id,note,focus_until,author_membership_id,author_name) VALUES($1,$2,$3,$4,'An expired note about this topic',$5,$6,'Kofi Sample')",[randomUUID(),school,ama,topic.fractions,shift(-3),teacherM]);
  assert.deepEqual(await offered(ama),[topic.decimals],'an expired focus is ignored');
  // A topic the child can start from the front is startable: it is one of their offered topics.
  assert.equal((await startCheck(ama,topic.decimals)).status,201);
});

test('only the author or the head withdraws a note, once, with a reason, and it stays in the history',async()=>{
  const id=(await write(ama,{note:'Pair with a reading buddy for instructions'})).body.id as string;
  assert.equal((await withdraw(id,'no')).status,400,'a reason is needed');
  assert.equal((await withdraw(id,'Not mine to withdraw',teacher2)).status,404);assert.equal((await withdraw(id,'A parent trying',guardian)).status,403);
  const other2=(await write(ama,{note:'A second teacher\'s own note about layout'},head)).body.id as string;
  assert.equal((await withdraw(other2,'A teacher withdrawing the head\'s note')).status,403,'a teacher withdraws only their own');
  await ok(`/learning-notes/${id}/withdraw`,'POST',{reason:'This no longer applies'},teacher);
  assert.equal((await withdraw(id,'Again please',head)).status,404,'already withdrawn');
  await ok(`/learning-notes/${other2}/withdraw`,'POST',{reason:'Done with this one'},head);
  const history=(await list(ama)).body.items.find((n:any)=>n.id===id);assert.deepEqual([history.withdrawn.reason,typeof history.withdrawn.at],['This no longer applies','string']);
  await assert.rejects(owner.query("UPDATE learning_notes SET note='Rewritten later' WHERE id=$1",[id]),/only be withdrawn/);
  await assert.rejects(owner.query("UPDATE learning_notes SET withdrawal_reason='Edited later' WHERE id=$1",[id]),/only be withdrawn/);
  await assert.rejects(owner.query("DELETE FROM learning_notes WHERE id=$1",[id]),/are kept/);
});

test('notes belong to one school, are not for the family, and never reach Claude',async()=>{
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[other]);
    assert.equal((await client.query('SELECT 1 FROM learning_notes')).rowCount,0,'another school cannot read notes');
    await assert.rejects(client.query("INSERT INTO learning_notes(id,school_id,learner_id,note,author_membership_id,author_name) VALUES($1,$2,$3,'Should not be allowed',$4,'X')",[randomUUID(),school,ama,teacherM]),/row-level security/);
    await client.query('ROLLBACK');
  }finally{client.release();}
  // A note exists for Ama while Claude writes content: nothing of it is in what is sent.
  prompts.length=0;
  const retired=(await owner.query("SELECT id FROM topic_lessons WHERE school_id=$1 AND indicator_id=$2 AND retired_at IS NULL",[school,topic.fractions])).rows[0].id;
  await ok(`/learning/lessons/${retired}/retire`,'POST',{reason:'Making a new one to check the prompt'},teacher);
  assert.equal((await generate(approval.fractions)).body.lesson,'made');
  assert.ok(prompts.length>0&&!prompts.some(p=>/money examples|short sentences|reading buddy|carrying|seat near the front/i.test(p)),'no note wording is sent to the model');
  // The Ask assistant has no tool that reads them.
  const tools=require('fs').readFileSync(path.resolve(__dirname,'../src/modules/assistant/assistant.tools.ts'),'utf8');assert.doesNotMatch(tools,/learning_notes|learning-notes/);
  // Staff only: the read-only demo school blocks writing one.
  process.env.READ_ONLY_SCHOOL_IDS=school;
  try{const blocked=await write(ama,{note:'Trying on the demo school'});assert.equal(blocked.status,403);assert.equal(blocked.body.code,'READ_ONLY_DEMO');assert.equal((await list(ama)).status,200);}finally{delete process.env.READ_ONLY_SCHOOL_IDS;}
});

// ---- Review fixes (independent review of slice 4) ----
const {checkLearningNote}=require('../dist/modules/learning/notes');
const pupil=(full_name:string,admission_number='LN-1234')=>({full_name,admission_number});

test('ordinary classroom wording is not refused, and a refusal says which word it found',()=>{
  for(const note of ['Use familiar everyday examples','Mental maths warm-ups help','Use visual aids and real objects','Teaching aids work well here','Give a diagnostic quiz first','Calculate it mentally before writing','Practise the 12 times table','Slow down and check each step','Read the question aloud twice'])
    assert.equal(checkLearningNote(note,pupil('Ama Mensah','12')),null,note);
  const said=checkLearningNote('Has a bad cough most mornings',pupil('Ama Mensah'));assert.match(said,/cough/i,'the message names the word, which is the teacher\'s own');
});

test('health, family and home matters a careless note would mention are kept out',()=>{
  for(const note of ['His mother travels a lot so give homework a day early','Lives with his grandmother and aunt','Parents are separated','Comes without breakfast','School fees owing so often absent','Stomach ache most mornings','Has a bad cough','Wears glasses and cannot see the board','Stammers when reading aloud','Slow child, needs patience','Lazy in class','Mentally ill','Family problems at home','Her father passed away','HIV positive','Mental health concerns'])
    assert.ok(checkLearningNote(note,pupil('Ama Mensah')),`${note} should be refused`);
});

test('the student\'s name is caught however it is stored or written',()=>{
  const refused=(note:string,name:string,admission='LN-1234')=>assert.match(checkLearningNote(note,pupil(name,admission)),/name|admission/i,`${note} / ${name}`);
  refused('Mensah needs a front seat','Mensah, Ama');refused('Ansah needs a front seat','Owusu-Ansah Kofi');refused('Owusu needs a front seat','Owusu-Ansah Kofi');
  refused('Ɔbaa needs a front seat','Ɔbaa Mensah');refused('Kwamé needs a front seat','Kwamé Boateng');refused(`Mens${String.fromCharCode(0x200b)}ah needs a front seat`,'Ama Mensah');refused('AMA’S book is torn','Ama Mensah');
  refused('Admission SIS-26-A045 needs help','Ama Mensah','SIS/26/A045');refused('Admission SIS 26 A045 needs help','Ama Mensah','SIS/26/A045');
  assert.equal(checkLearningNote('Amazing progress with fractions',pupil('Ama Mensah')),null,'a name inside another word is not the name');
  assert.equal(checkLearningNote('Numbers to 101 on a number line',pupil('Ama Mensah','101')),null,'a short admission number is an ordinary number');
});

test('a student has a limited number of live notes, and withdrawing frees room',async()=>{
  const child=kojo;
  for(let i=0;i<30;i++){const r=await write(child,{note:`Cap note number ${i} about layout`},head);assert.equal(r.status,201,JSON.stringify(r.body));}
  const over=await write(child,{note:'One note too many about layout'},head);assert.equal(over.status,409,JSON.stringify(over.body));assert.match(over.body.message,/withdraw/i);
  const first=(await list(child)).body.items.at(-1);await ok(`/learning-notes/${first.id}/withdraw`,'POST',{reason:'Making room for a new note'},head);
  assert.equal((await write(child,{note:'Now there is room again for one'},head)).status,201);
});

test('input a database would refuse is a 400, not a server error',async()=>{
  assert.equal((await write(ama,{note:'Needs a front\u0000 seat today'})).status,400,'a NUL character');
  assert.equal((await write(ama,{note:String.fromCodePoint(0x2764,0xFE0F).repeat(130)})).status,400,'emoji that count short in the form check and long in the database');
  const id=(await write(ama,{note:'A note to withdraw with odd text'})).body.id as string;
  assert.equal((await withdraw(id,'Remove\u0000 this',head)).status,400,'a NUL character in a reason');
  assert.equal((await withdraw(id,'Remove, it names Mensah',head)).status,400,'a reason follows the same wording rules');
  assert.equal((await withdraw(id,'Remove, it mentions his mother',head)).status,400);
  await ok(`/learning-notes/${id}/withdraw`,'POST',{reason:'No longer needed'},head);
  const logged=(await owner.query("SELECT metadata::text AS m FROM audit_events WHERE school_id=$1 AND action='learning.note.withdrawn' AND target_id=$2",[school,id])).rows[0];
  assert.ok(logged,'the withdrawal is audited');assert.doesNotMatch(logged.m,/No longer needed/,'the reason is kept with the note, not copied into the audit log');
});

test('a teacher cannot tell a live note on another class from a note that is gone',async()=>{
  const id=(await write(yaw,{note:'Keep instructions to one step at a time'},teacher2)).body.id as string;
  const gone=(await write(yaw,{note:'A note that will be withdrawn first'},teacher2)).body.id as string;await ok(`/learning-notes/${gone}/withdraw`,'POST',{reason:'Not needed now'},teacher2);
  const live=await withdraw(id,'Trying someone else\'s note',teacher),past=await withdraw(gone,'Trying a withdrawn note',teacher),missing=await withdraw(randomUUID(),'No such note',teacher);
  assert.deepEqual([live.status,past.status,missing.status],[404,404,404]);assert.equal(live.body.message,past.body.message);assert.equal(past.body.message,missing.body.message);
});

test('the database itself keeps a note honest: a withdrawal has its reason, and time and withdrawal are not the caller\'s to set',async()=>{
  const live=(await owner.query("INSERT INTO learning_notes(id,school_id,learner_id,note,author_membership_id,author_name) VALUES($1,$2,$3,'Direct insert about layout',$4,'Kofi Sample') RETURNING id",[randomUUID(),school,ama,teacherM])).rows[0].id;
  await assert.rejects(owner.query("UPDATE learning_notes SET withdrawn_at=now(),withdrawn_by=$2,withdrawal_reason=NULL WHERE id=$1",[live,teacherM]),/check constraint/i,'withdrawn with no reason');
  const forged=(await owner.query("INSERT INTO learning_notes(id,school_id,learner_id,note,author_membership_id,author_name,created_at,withdrawn_at,withdrawn_by,withdrawal_reason) VALUES($1,$2,$3,'Direct insert about layout',$4,'Kofi Sample','2020-01-01',now(),$4,'Forged') RETURNING created_at,withdrawn_at,withdrawn_by,withdrawal_reason",[randomUUID(),school,ama,teacherM])).rows[0];
  assert.ok(Date.now()-new Date(forged.created_at).getTime()<60000,'created now, whatever the caller said');assert.deepEqual([forged.withdrawn_at,forged.withdrawn_by,forged.withdrawal_reason],[null,null,null],'inserted live, whatever the caller said');
});

test('a pin only counts for a topic that is approved this term, and no other file reads the notes table',async()=>{
  const home=app.get(require('../dist/modules/practice/home.service').HomePracticeService);
  const mk=(n:string)=>({indicatorId:n,subject:'Mathematics',topic:n,setId:n,lessonId:null});
  const [a,b,c,d]=['a','b','c','d'].map(mk);
  assert.deepEqual(home.offered({weak:[a,b,c,d],approved:[a]},[],['d']).map((p:any)=>p.indicatorId),['a','b','c'],'a pin for a topic that is not approved does not jump the queue');
  assert.deepEqual(home.offered({weak:[a,b,c],approved:[a,b,c,d]},[],['d']).map((p:any)=>p.indicatorId),['d','a','b'],'an approved pinned topic leads');
  const fs=require('fs'),dir=path.resolve(__dirname,'../src'),files:string[]=[];
  const walk=(p:string)=>{for(const f of fs.readdirSync(p,{withFileTypes:true})){const full=path.join(p,f.name);f.isDirectory()?walk(full):files.push(full);}};walk(dir);
  assert.deepEqual(files.filter(f=>/learning_notes/.test(fs.readFileSync(f,'utf8'))).map(f=>path.relative(dir,f)).sort(),['modules/learning/notes.service.ts','modules/practice/home.service.ts'],'only the staff notes service and the topic order read the table');
});
