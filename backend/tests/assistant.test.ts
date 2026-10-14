import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {AssistantService}=require('../dist/modules/assistant/assistant.service');
const {refsIn}=require('../dist/modules/assistant/assistant.tools');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),cls=randomUUID(),cls2=randomUUID(),headM=randomUUID(),teacherM=randomUUID();
const [headU,teacherU,guardianU]=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
const names=['Abena Private Name','Kwabena Hidden Name','Yaw OtherClass Name'];
let app:any,base:string,head:any,teacher:any,guardian:any,termId:string,maths:string,indicator:string;const kids:string[]=[];
type Params={model:string;system:any[];messages:any[];tools?:any[];output_config?:any};
let sent:Params[]=[],script:(params:Params,step:number)=>any;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,target=school){const r=await fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,method:string,body:Record<string,unknown>,actor=head,status=201){const r=await call(route,method,{operationId:randomUUID(),...body},actor);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
const ask=(text:string|object[],actor=head,target=school)=>call('/assistant/chat','POST',{messages:typeof text==='string'?[{role:'user',text}]:text},actor,target);
// A scripted model turn: tool calls, or a final text answer.
const tools=(...uses:[string,object][])=>({content:uses.map(([name,input],i)=>({type:'tool_use',id:`toolu_${sent.length}_${i}`,name,input})),stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:0}});
const answer=(text:string)=>({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:40,cache_read_input_tokens:50}});
const resultsOf=(p:Params)=>p.messages[p.messages.length-1].content as {tool_use_id:string;content:string;is_error?:boolean}[];
const enable=async(on=true)=>{process.env.AI_ENABLED='true';const s=(await call('/ai/settings')).body;await ok('/ai/settings','PUT',{enabled:on,monthlyRunCap:50,acknowledgement:'Parents agreed AI assistance in the data-protection notice',...(s.version?{version:s.version}:{})},head,200);};

before(async()=>{
  process.env.DEV_AUTH='synthetic-local';process.env.ASSISTANT_PER_MINUTE='100';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  app.get(AssistantService).modelOverride=async(params:Params)=>{sent.push(JSON.parse(JSON.stringify(params)));return script(params,sent.length);};
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Assistant Sunrise School'),($2,'Other assistant school')",[school,other]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$3,$4,'headteacher'),($2,$3,$5,'teacher'),($6,$3,$7,'guardian'),($8,$9,$4,'headteacher')",[headM,teacherM,school,headU,teacherU,randomUUID(),guardianU,randomUUID(),other]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Assistant year',$3,$4)",[year,school,shift(-60),shift(120)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$3,$4,'Basic 5','Primary',30),($2,$3,$4,'Basic 6','Primary',30)",[cls,cls2,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic assistant assignment',$7)",[randomUUID(),school,cls,teacherM,shift(-30),shift(60),headM]);
    for(const [i,name] of names.entries()){const id=randomUUID(),e=randomUUID();kids.push(id);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[id,school,`AS-${id.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[e,school,id,i<2?cls:cls2,shift(-50)]);}
  maths=(await ok('/assessment/subjects','POST',{name:'Mathematics'})).id;
  termId=(await ok('/assessment/terms','POST',{academicYearId:year,name:'Term 1',startDate:shift(-55),endDate:shift(30)})).id;
  await ok('/assessment/indicators','POST',{subjectId:maths,origin:'local',grade:'Basic 5',sourceNote:'Basic 5 scheme of work',items:[{code:'B5.1.3',strand:'Number',subStrand:'Fractions',description:'Adds fractions with like denominators'}]});
  indicator=(await call(`/assessment/indicators?subjectId=${maths}`)).body.items[0].id;
  // Three weekly maths exercises: Abena strong, Kwabena below the pass line, all tagged with the fractions indicator.
  for(const [n,[a,b]] of [[85,30],[90,35],[80,40]].entries()){
    const assessment=await ok(`/assessment/classes/${cls}/assessments`,'POST',{termId,subjectId:maths,kind:'classwork',title:`Fractions exercise ${n+1}`,heldOn:shift(-21+n*7),maxMark:100,indicatorIds:[indicator]},teacher);
    await ok(`/assessment/classes/${cls}/assessments/${assessment.id}/marks`,'POST',{marks:[{learnerId:kids[0],mark:a},{learnerId:kids[1],mark:b}]},teacher);}
  // Five submitted registers: Kwabena absent three days, Abena present; one draft register that must not count.
  for(const d of [-9,-8,-7,-6,-5,-4]){const day=shift(d);
    await ok('/attendance/school-days','POST',{day,isOpen:true,reason:'Synthetic school day'});
    const marks=[{learnerId:kids[0],mark:'present'},{learnerId:kids[1],mark:[-9,-8,-7,-4].includes(d)?'absent':'present'}];
    const draft=await ok(`/attendance/classes/${cls}/register`,'POST',{day,version:0,action:'save',marks},teacher);
    if(d!==-4)await ok(`/attendance/classes/${cls}/register`,'POST',{day,version:draft.version,action:'submit',marks},teacher);}
});
beforeEach(()=>{sent=[];});
after(async()=>{delete process.env.AI_ENABLED;delete process.env.ASSISTANT_PER_MINUTE;await app?.close();await owner.end();});

test('learner references round-trip and are only parsed in the expected form',()=>{
  assert.deepEqual(refsIn(`Ask about [[L-${kids[0]}]] and L-${kids[0]} and [[L-not-a-uuid]]`),[kids[0]]);
});

test('the assistant needs AI switched on, a signed-in head or teacher, and well-formed history',async()=>{
  script=()=>answer('unused');
  delete process.env.AI_ENABLED;
  const off=await ask('How is Basic 5 doing?');assert.equal(off.status,409);assert.equal(off.body.code,'ai_disabled_platform');
  process.env.AI_ENABLED='true';assert.equal((await ask('How is Basic 5 doing?')).body.code,'ai_disabled_school');
  await enable();
  assert.equal((await ask('Hello',guardian)).status,403);
  assert.equal((await ask('Hello',teacher,other)).status,404,'no membership, no school');
  assert.equal((await ask([{role:'assistant',text:'hi'}])).status,400);
  assert.equal((await ask([{role:'user',text:'a'},{role:'user',text:'b'}])).status,400);
  assert.equal((await ask([{role:'user',text:'a'},{role:'assistant',text:'b'}])).status,400,'must end with a question');
  assert.equal((await ask(Array.from({length:21},(_,i)=>({role:i%2?'assistant':'user',text:'x'})))).status,400);
  assert.equal((await ask('x'.repeat(4001))).status,400);
  assert.equal((await call('/assistant/chat','POST',{messages:[{role:'user',text:'hi',extra:1}]})).status,400);
  assert.equal(sent.length,0,'nothing reached the model');
});

test('a head asks about class performance and gets grounded figures, with names restored only on the way out',async()=>{
  await enable();
  script=(p,step)=>{
    if(step===1){assert.equal(p.messages[0].content,'What is the performance of class 5?');return tools(['school_overview',{}]);}
    if(step===2){const overview=JSON.parse(resultsOf(p)[0]!.content);assert.deepEqual(overview.classes.map((c:any)=>c.name),['Basic 5','Basic 6']);assert.equal(overview.role,'headteacher');
      return tools(['class_performance',{class:'class 5'}],['curriculum_gaps',{class:'Basic 5'}]);}
    const [perf,gaps]=resultsOf(p).map(r=>JSON.parse(r.content));
    assert.equal(perf.class.name,'Basic 5');assert.equal(perf.classSize,2);
    assert.deepEqual(perf.subjects.map((s:any)=>[s.subject,s.termAverage]),[['Mathematics',60]]);
    const weak=perf.needsAttention.find((a:any)=>a.reason==='below_pass');assert.equal(weak.learnerRef,`L-${kids[1]}`);assert.equal(weak.recentAverage,35);
    assert.equal(gaps.weakest[0].code,'B5.1.3');assert.equal(gaps.weakest[0].classAverage,60);assert.equal(gaps.weakest[0].belowPassLine,1);
    return answer(`Basic 5 averages 60% in Mathematics. [[L-${kids[1]}]] is below the pass line at 35%; fractions are the weakest topic.`);
  };
  const r=await ask('What is the performance of class 5?');
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.reply,`Basic 5 averages 60% in Mathematics. [[L-${kids[1]}]] is below the pass line at 35%; fractions are the weakest topic.`);
  assert.deepEqual(r.body.people,{[`L-${kids[1]}`]:names[1]});
  assert.deepEqual(r.body.tools,['school_overview','class_performance','curriculum_gaps']);
  // Privacy: no learner name, admission number or the other school ever reached the model.
  const wire=JSON.stringify(sent);
  for(const name of names)assert.ok(!wire.includes(name),`${name} was sent to the model`);
  assert.ok(!wire.includes('AS-'),'admission numbers were sent to the model');
  assert.ok(!wire.includes('Other assistant school'));
  assert.equal(sent[0]!.model,'claude-opus-5-5');assert.equal(sent[0]!.output_config.effort,'medium');
  assert.ok(sent[0]!.system[0].cache_control,'stable instructions are cacheable');assert.match(sent[0]!.system[1].text,/Assistant Sunrise School.*headteacher.*Today is/s);
  assert.ok(!sent[0]!.tools!.some(t=>t.name==='unknown'));
  // The run is logged with tokens and tool names but no text.
  const run=(await owner.query("SELECT feature,source,status,source_refs,input_tokens,output_tokens,model FROM ai_runs WHERE id=$1",[r.body.runId])).rows[0];
  assert.deepEqual(run,{feature:'assistant.chat',source:'ai',status:'ok',source_refs:{tools:['school_overview','class_performance','curriculum_gaps']},input_tokens:300,output_tokens:80,model:'claude-opus-5-5'});
  assert.ok(!JSON.stringify(run).includes('60%'));
});

test('follow-up questions carry the conversation, and attendance counts only submitted registers',async()=>{
  await enable();
  const prior=[{role:'user',text:'What is the performance of class 5?'},{role:'assistant',text:`Basic 5 averages 60%. [[L-${kids[1]}]] needs attention.`}];
  script=(p,step)=>{
    if(step===1){assert.equal(p.messages.length,3);assert.equal(p.messages[1].content,prior[1]!.text);
      return tools(['attendance_report',{from:shift(-9),to:shift(-3)}],['practice_materials',{indicator_id:indicator}],['learner_profile',{learner:`L-${kids[1]}`}]);}
    const [att,materials,profile]=resultsOf(p).map(r=>JSON.parse(r.content));
    assert.deepEqual(att.classes,[{class:'Basic 5',registerDays:5,attendanceRate:70,absences:3,lates:0}]);
    assert.deepEqual(att.classesWithoutRegisters,['Basic 6']);
    assert.deepEqual(att.mostAbsent.map((l:any)=>[l.learnerRef,l.absences,l.daysMarked]),[[`L-${kids[1]}`,3,5]],'the draft register does not count');
    assert.deepEqual(materials,{materials:[]});
    assert.equal(profile.class,'Basic 5');assert.equal(profile.attendance.absencesLast30Days,3);assert.equal(profile.fees.invoice,'none');
    assert.deepEqual(profile.subjectsByTerm[0].terms.map((t:any)=>t.classWorkAverage),[35]);
    return answer(`Reteach fractions in a small group with [[L-${kids[1]}]] and call the family about the 3 absences.`);
  };
  const r=await ask([...prior,{role:'user',text:'What can we do about it?'}]);
  assert.equal(r.status,201,JSON.stringify(r.body));assert.deepEqual(r.body.people,{[`L-${kids[1]}`]:names[1]});
});

test('a teacher only sees assigned classes and learners, and has no fees tool',async()=>{
  await enable();
  script=(p,step)=>{
    if(step===1){const offered=p.tools!.map(t=>t.name);assert.ok(!offered.includes('fees_summary'));assert.ok(offered.includes('attendance_report'));
      return tools(['school_overview',{}],['class_performance',{class:'Basic 6'}],['class_performance',{class:cls2}],['learner_profile',{learner:`L-${kids[2]}`}],
        ['fees_summary',{}],['find_learner',{query:'Name'}],['attendance_report',{from:shift(-9),to:shift(-3)}],['support_plans',{class:'Basic 6'}]);}
    const [overview,byName,byId,profile,fees,found,att,plans]=resultsOf(p);
    assert.deepEqual(JSON.parse(overview!.content).classes.map((c:any)=>c.name),['Basic 5']);
    assert.equal(JSON.parse(overview!.content).registersToday,undefined);
    for(const denied of [byName,byId,profile,fees,plans])assert.equal(denied!.is_error,true,denied!.content);
    assert.match(byName!.content,/Classes: Basic 5$/);
    assert.match(fees!.content,/cannot use this tool/);
    assert.deepEqual(JSON.parse(found!.content).matches.map((m:any)=>m.learnerRef).sort(),[`L-${kids[0]}`,`L-${kids[1]}`].sort(),'search is limited to assigned classes');
    assert.deepEqual(JSON.parse(att!.content).classes.map((c:any)=>c.class),['Basic 5']);
    // Even if the model echoes a reference the teacher cannot see, no name comes back for it.
    return answer(`Your class is Basic 5. [[L-${kids[0]}]] is doing well. [[L-${kids[2]}]] is not in your class.`);
  };
  const r=await ask('How is Basic 6 doing?',teacher);
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.deepEqual(r.body.people,{[`L-${kids[0]}`]:names[0]});
});

test('bad tool input is reported to the model, and the loop always ends with an answer',async()=>{
  await enable();
  script=(p,step)=>{
    if(step===1)return tools(['attendance_report',{from:'yesterday',to:shift(0)}],['class_performance',{}],['no_such_tool',{}],['curriculum_gaps',{class:'Basic 5',subject:'Astronomy'}]);
    if(step===2){const r=resultsOf(p);assert.ok(r.every(x=>x.is_error),JSON.stringify(r));assert.match(r[0]!.content,/date like/);assert.match(r[1]!.content,/class is required/);assert.match(r[2]!.content,/Unknown tool/);assert.match(r[3]!.content,/No subject called/);}
    // Keeps asking for tools forever: the server stops offering tools on the last step.
    return p.tools ? tools(['school_overview',{}]) : answer('Here is what I found.');
  };
  const r=await ask('Tell me everything');
  assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.reply,'Here is what I found.');
  assert.equal(sent.length,8);assert.equal(sent[7]!.tools,undefined);assert.ok(sent[6]!.tools);
});

test('provider failures, refusals and the monthly cap are handled',async()=>{
  await enable();
  script=()=>{throw new Error('socket hang up');};
  const failed=await ask('How is Basic 5?');assert.equal(failed.status,503);assert.match(failed.body.message,/could not reach the AI provider/);
  script=()=>({content:[],stop_reason:'refusal',usage:{input_tokens:5,output_tokens:0}});
  const refused=await ask('Something odd');assert.equal(refused.status,201);assert.match(refused.body.reply,/can't help with that/);
  const s=(await call('/ai/settings')).body;
  await ok('/ai/settings','PUT',{enabled:true,monthlyRunCap:s.runsThisMonth,acknowledgement:'Parents agreed AI assistance in the data-protection notice',version:s.version},head,200);
  script=()=>answer('unused');sent=[];
  const capped=await ask('How is Basic 5?');assert.equal(capped.status,409);assert.equal(capped.body.code,'monthly_cap_reached');assert.equal(sent.length,0);
});

test('one person cannot flood the assistant',async()=>{
  await enable();script=()=>answer('ok');process.env.ASSISTANT_PER_MINUTE='2';
  try{
    assert.equal((await ask('one',teacher)).status,201);
    const statuses=[(await ask('two',teacher)).status,(await ask('three',teacher)).status];
    assert.ok(statuses.includes(429),JSON.stringify(statuses));
  }finally{process.env.ASSISTANT_PER_MINUTE='100';}
});
