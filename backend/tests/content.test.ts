import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
const {createApp}=require('../dist/main');
const {checkBody,arithmeticOf,numericOption,runChecks,readingLevel,stageOf}=require('../dist/modules/content/checks');
const {checkQuestion,checkQuestions}=require('../dist/modules/practice/questions');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const password='Content-team-2026!';
const ids={admin:randomUUID(),lead:randomUUID(),author:randomUUID(),author2:randomUUID(),reviewer:randomUUID(),outsider:randomUUID()};
const email=(who:string)=>`content-${who}-${ids[who as keyof typeof ids].slice(0,8)}@example.test`;
let app:any,base:string;
type Login={cookie:string;csrf:string};
async function loginAs(address:string,pass:string):Promise<Login>{
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:address,password:pass})});
  assert.equal(response.status,201);
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
const login=(who:string)=>loginAs(email(who),password);
async function call(url:string,account?:Login,method='GET',body?:unknown){
  const response=await fetch(`${base}${url}`,{method,headers:{'content-type':'application/json',...(account?{cookie:account.cookie,'x-csrf-token':account.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json().catch(()=>null)};
}
const person=async(who:string,name:string,roles:string[])=>{
  const salt=randomBytes(16).toString('hex');
  await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[ids[who as keyof typeof ids],name,email(who),`${salt}:${scryptSync(password,salt,64).toString('hex')}`]);
  for(const role of roles)await owner.query('INSERT INTO content_staff(id,user_id,role,granted_by) VALUES($1,$2,$3,$4)',[randomUUID(),ids[who as keyof typeof ids],role,ids.admin]);
};
let lead:Login,author:Login,author2:Login,reviewer:Login,outsider:Login,admin:Login,indicator:string;
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  await person('admin','Platform Admin',[]);await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)',[ids.admin]);
  await person('lead','Lena Lead',['lead']);await person('author','Ama Author',['author']);await person('author2','Kofi Author',['author']);await person('reviewer','Efua Reviewer',['reviewer']);await person('outsider','Not on the team',[]);
  [admin,lead,author,author2,reviewer,outsider]=await Promise.all(['admin','lead','author','author2','reviewer','outsider'].map(login));
  indicator=(await call('/content/catalogue',lead,'POST',{subject:'Mathematics',level:'Basic 5',code:'B5.1.1',strand:'Number',description:'Adds fractions with like denominators',origin:'platform',sourceNote:'Written by the platform team'})).body.id;
});
after(async()=>{await app?.close();await runtime.end();await owner.end();});

const question=(extra:Record<string,unknown>={})=>({kind:'choice',prompt:'What is 12 + 7?',options:['19','18','20'],correctOption:0,explanation:'12 plus 7 is 19.',...extra});
const guide=(extra:Record<string,unknown>={})=>({learning:'Your child is learning to add fractions that have the same bottom number.',example:'One quarter plus two quarters is three quarters.',mistakes:['Adding the bottom numbers as well'],activity:'Cut a loaf of bread into four slices and count the slices.',...extra});

test('questions and guides are cleaned to a stored shape; bad wording is refused with a reason',()=>{
  const ok=checkBody('question',1,question());assert.equal(ok.ok,true);assert.equal('level' in ok.body,false);
  const fail=(body:any,reason:string,kind='question',level=1)=>{const r=checkBody(kind,level,body);assert.equal(r.ok,false);assert.equal(r.reason,reason);};
  fail(question({options:['19','19 ','20']}),'bad_options');
  fail(question({options:['19','20','All of the above']}),'bad_options');
  fail(question({correctOption:5}),'bad_answer');
  fail(question({prompt:'Why?'}),'bad_prompt');
  fail(question({kind:'essay'}),'bad_kind');
  fail(question(),'bad_level','question',4);
  fail(null,'bad_body');
  assert.equal(checkBody('guide',null,guide()).ok,true);
  fail(guide({learning:'Too short'}),'bad_guide_text','guide',null as any);
  fail(guide({mistakes:[]}),'bad_mistakes','guide',null as any);
  fail(guide({mistakes:['a','b','c','d','e']}),'bad_mistakes','guide',null as any);
  assert.equal(checkBody('question',2,{kind:'number',prompt:'A pencil costs GH₵3. What do 4 pencils cost?',answer:12}).ok,true);
  // The school's set checker and the platform's single-question checker agree.
  assert.deepEqual(checkQuestion({level:2,...question()}).question.prompt,'What is 12 + 7?');
  assert.equal(checkQuestions([]).ok,false);
});

test('a sum is worked out by the computer; story problems are left to the reviewer',()=>{
  assert.equal(arithmeticOf('What is 12 + 7?'),19);
  assert.equal(arithmeticOf('3 × 4 + 2 = ?'),14);
  assert.equal(arithmeticOf('Calculate (2 + 3) x 4'),20);
  assert.equal(arithmeticOf('Work out 10 ÷ 4'),2.5);
  assert.equal(arithmeticOf('15 − 6'),9);
  assert.equal(arithmeticOf('10 ÷ 0'),null);
  assert.equal(arithmeticOf('What is 1/4 + 2/4?'),null,'a slash is a fraction, not division');
  assert.equal(arithmeticOf('12 / 4'),null);
  assert.equal(arithmeticOf('A pencil costs 5 cedis. What do 3 cost?'),null);
  assert.equal(arithmeticOf('Which number is 5 + 3 less than 20?'),null);
  assert.equal(arithmeticOf('2024-05-01 is a date'),null);
  assert.equal(numericOption('1,200'),1200);assert.equal(numericOption('GH₵5.50'),5.5);assert.equal(numericOption('12 cm'),12);assert.equal(numericOption('1/2'),null);assert.equal(numericOption('twelve'),null);
});

test('automatic checks block wrong answers, labels and exact repeats, and warn about near repeats and hard reading',()=>{
  const body=(extra:any={})=>checkBody('question',1,question(extra)).body;
  const codes=(r:any)=>r.findings.map((f:any)=>f.code);
  const good=runChecks('question','upper_primary',body(),[]);assert.equal(good.blocking,0);assert.equal(good.machineChecked,true);
  const wrong=runChecks('question','upper_primary',body({correctOption:1}),[]);assert.equal(wrong.blocking,1);assert.deepEqual(codes(wrong),['wrong_answer']);assert.match(wrong.findings[0].message,/19, not 18/);
  const twin=runChecks('question','upper_primary',body({options:['19','19.0','20']}),[]);assert.deepEqual(codes(twin),['two_right_answers']);
  const story=runChecks('question','upper_primary',checkBody('question',1,{kind:'number',prompt:'A pencil costs GH₵3. What do 4 pencils cost in cedis?',answer:99}).body,[]);assert.equal(story.blocking,0);assert.equal(story.machineChecked,false);
  const fraction=runChecks('question','upper_primary',checkBody('question',1,{kind:'choice',prompt:'What is 1/4 + 2/4?',options:['3/4','3/8','2/4'],correctOption:0}).body,[]);assert.equal(fraction.blocking,0);assert.equal(fraction.machineChecked,false);
  const worded=runChecks('question','upper_primary',body({options:['nineteen','18','20']}),[]);assert.equal(worded.blocking,0,'an answer in words is left to the reviewer');assert.equal(worded.machineChecked,false);
  assert.deepEqual(codes(runChecks('question','upper_primary',body({explanation:'Slow learners often miss this.'}),[])),['labelling_language']);
  const longGuide=runChecks('guide','lower_primary',checkBody('guide',null,guide({learning:'Your child is learning to add fractions that share the same denominator, which is the number written at the bottom of a fraction in every example.'})).body,[]);assert.equal(longGuide.warnings,0,'guides are written for parents, not read by the child');
  assert.deepEqual(codes(runChecks('question','upper_primary',body(),[{itemId:'x',text:'what is 12 + 7'}])),['duplicate']);
  const near=runChecks('question','upper_primary',checkBody('question',1,question({prompt:'Kofi has 12 mangoes and gets 7 more mangoes. How many mangoes now?',options:['19','18','20']})).body,[{itemId:'y',text:'Kofi has 12 mangoes and gets 7 more mangoes. How many mangoes now then?'}]);
  assert.deepEqual(codes(near),['near_duplicate']);assert.equal(near.blocking,0);assert.equal(near.warnings,1);
  const long=checkBody('question',1,{kind:'number',prompt:'A farmer picks twelve baskets of mangoes in the morning and shares them with his three neighbours at noon. How many?',answer:3}).body;
  assert.ok(codes(runChecks('question','lower_primary',long,[])).includes('reading_level'),'sentences too long for Basic 1 to 3');
  assert.ok(!codes(runChecks('question','upper_primary',long,[])).includes('reading_level'));
  const heavy=checkBody('question',1,{kind:'number',prompt:'Photosynthesis requires chlorophyll. Transpiration involves evaporation. How many?',answer:3}).body;
  assert.ok(codes(runChecks('question','upper_primary',heavy,[])).includes('reading_level'),'too many long words');
  assert.ok(!codes(runChecks('question','jhs',long,[])).includes('reading_level'));
  assert.equal(stageOf('Basic 3'),'lower_primary');assert.equal(stageOf('Basic 4'),'upper_primary');assert.equal(stageOf('JHS 1'),'jhs');
  assert.ok(readingLevel('Go. Run fast.').sentence<=2);
});

test('only people with a content role reach the library; a school role is not one',async()=>{
  assert.equal((await call('/content/me')).status,401);
  const head=await loginAs('head@example.test','Synthetic-only-2026!');
  for(const account of [head,outsider,admin]){
    for(const url of ['/content/me','/content/catalogue','/content/items','/content/queue'])assert.equal((await call(url,account)).status,403,url);
    assert.equal((await call('/content/catalogue',account,'POST',{subject:'Maths',level:'Basic 1',description:'Counts to ten',origin:'platform',sourceNote:'Sneaky'})).status,403);
  }
  assert.deepEqual((await call('/content/me',author)).body,{userId:ids.author,roles:['author'],queue:0});
  assert.deepEqual((await call('/content/me',lead)).body.roles,['lead']);
  assert.deepEqual((await call('/auth/session',author)).body.contentRoles,['author']);
  assert.deepEqual((await call('/auth/session',outsider)).body.contentRoles,[]);
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true)",[ids.author]);
    assert.equal((await client.query('SELECT user_requires_mfa() AS yes')).rows[0].yes,true);
    await assert.rejects(client.query('SELECT * FROM content_staff'),/permission denied/);
    await client.query('ROLLBACK');await client.query('BEGIN');await client.query("SELECT set_config('app.user_id','20000000-0000-4000-8000-000000000001',true)");
    assert.equal((await client.query('SELECT user_requires_mfa() AS yes')).rows[0].yes,true,'a headteacher already needed it');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM content_versions')).rows[0].n,0,'a school user sees no content rows');
    await assert.rejects(client.query("INSERT INTO catalogue_indicators(id,subject,level,description,origin,source_note,created_by) VALUES(gen_random_uuid(),'Maths','Basic 1','Counts','platform','x y z',$1)",[ids.lead]),/row-level security/);
    await client.query('ROLLBACK');
  }finally{client.release();}
});

test('only a lead edits the catalogue; an entry is retired, never changed',async()=>{
  const entry={subject:'English',level:'Basic 2',code:'B2.1.1',description:'Reads three-letter words',origin:'platform',sourceNote:'Written by the platform team'};
  for(const account of [author,reviewer])assert.equal((await call('/content/catalogue',account,'POST',entry)).status,403);
  const made=await call('/content/catalogue',lead,'POST',{...entry,termGuidance:[2,1,2]});assert.equal(made.status,201);
  assert.equal((await call('/content/catalogue',lead,'POST',{...entry,subject:'english'})).status,409,'same code, subject and level');
  assert.equal((await call('/content/catalogue',lead,'POST',{...entry,level:'Nursery 1'})).status,400);
  const list=await call('/content/catalogue?level=Basic 2&subject=english',author);assert.equal(list.status,200);
  assert.equal(list.body.items.length,1);assert.deepEqual(list.body.items[0].termGuidance,[1,2]);assert.equal(list.body.items[0].publishedQuestions,0);
  assert.equal((await call(`/content/catalogue/${made.body.id}/retire`,author,'POST',{reason:'Not mine to retire'})).status,403);
  assert.equal((await call(`/content/catalogue/${made.body.id}/retire`,lead,'POST',{reason:'x'})).status,400);
  assert.equal((await call(`/content/catalogue/${made.body.id}/retire`,lead,'POST',{reason:'Dropped from the scheme'})).status,201);
  assert.equal((await call(`/content/catalogue/${made.body.id}/retire`,lead,'POST',{reason:'Dropped from the scheme'})).status,404);
  assert.equal((await call('/content/catalogue?level=Basic 2',author)).body.items.length,0);
  assert.equal((await call('/content/catalogue?level=Basic 2&includeRetired=true',author)).body.items.length,1);
  assert.equal((await call('/content/items',author,'POST',{kind:'question',indicatorId:made.body.id,level:1,body:question()})).status,409,'no new items on a retired entry');
  await assert.rejects(owner.query("UPDATE catalogue_indicators SET description='Changed' WHERE id=$1",[made.body.id]),/can only be retired/);
  await assert.rejects(owner.query('DELETE FROM catalogue_indicators WHERE id=$1',[made.body.id]),/are kept/);
});

test('a question is written, checked, reviewed by someone else, published and replaced by a newer version',async()=>{
  const created=await call('/content/items',author,'POST',{kind:'question',indicatorId:indicator,level:1,body:question({correctOption:1})});
  assert.equal(created.status,201,JSON.stringify(created.body));const {itemId,versionId}=created.body;
  assert.equal((await call('/content/items',reviewer,'POST',{kind:'question',indicatorId:indicator,level:1,body:question()})).status,403,'a reviewer does not write');
  assert.equal((await call('/content/items',author,'POST',{kind:'question',indicatorId:indicator,body:question()})).status,400,'a question needs a level');
  assert.equal((await call('/content/items',author,'POST',{kind:'guide',indicatorId:indicator,level:2,body:guide()})).status,400,'a guide has no level');
  // The draft is the author's to reword; nobody else's.
  assert.equal((await call(`/content/versions/${versionId}`,author2,'PUT',{body:question()})).status,403);
  assert.equal((await call(`/content/versions/${versionId}/submit`,author2,'POST',{})).status,403);
  // The computer finds the wrong answer and refuses the submit, with the findings.
  const blocked=await call(`/content/versions/${versionId}/submit`,author,'POST',{});
  assert.equal(blocked.status,422);assert.equal(blocked.body.code,'CHECKS_FAILED');assert.equal(blocked.body.details.findings[0].code,'wrong_answer');
  assert.equal((await call(`/content/versions/${versionId}`,author,'PUT',{body:question({correctOption:5})})).status,400);
  assert.equal((await call(`/content/versions/${versionId}`,author,'PUT',{body:question()})).status,200);
  const submitted=await call(`/content/versions/${versionId}/submit`,author,'POST',{});
  assert.equal(submitted.status,201,JSON.stringify(submitted.body));assert.equal(submitted.body.report.machineChecked,true);
  // Once submitted the wording is frozen, for the author too.
  assert.equal((await call(`/content/versions/${versionId}`,author,'PUT',{body:question({prompt:'What is 12 + 8?'})})).status,409);
  assert.equal((await call(`/content/versions/${versionId}/submit`,author,'POST',{})).status,409);
  // Review: not the author, not another author, only a reviewer.
  assert.equal((await call(`/content/versions/${versionId}/approve`,author,'POST',{})).status,403);
  assert.equal((await call(`/content/versions/${versionId}/approve`,author2,'POST',{})).status,403);
  assert.equal((await call('/content/queue',author)).status,403);
  const queue=(await call('/content/queue',reviewer)).body;assert.equal(queue.items.some((i:any)=>i.id===versionId),true);
  const queued=queue.items.find((i:any)=>i.id===versionId);assert.equal(queued.itemId,itemId);assert.equal(queued.authorName,'Ama Author');assert.equal(queued.stage,'upper_primary');assert.equal(queued.checks.machineChecked,true);
  assert.equal((await call('/content/me',reviewer)).body.queue>=1,true);
  assert.equal((await call(`/content/versions/${versionId}/approve`,reviewer,'POST',{note:'Checked the working'})).status,201);
  assert.equal((await call(`/content/versions/${versionId}/approve`,reviewer,'POST',{})).status,409,'already published');
  let item=(await call(`/content/items/${itemId}`,author2)).body;
  assert.equal(item.versions[0].status,'published');assert.equal(item.versions[0].reviewerName,'Efua Reviewer');assert.equal(item.versions[0].reviewNote,'Checked the working');assert.ok(item.versions[0].publishedAt);
  assert.equal((await call('/content/catalogue?search=B5.1',author)).body.items[0].publishedQuestions,1);
  // A fix is a new version; publishing it retires the old one in the same step.
  assert.equal((await call(`/content/items/${itemId}/versions`,author,'POST',{body:question({prompt:'What is 13 + 7?',options:['20','19','21']})})).status,201);
  assert.equal((await call(`/content/items/${itemId}/versions`,author,'POST',{body:question({prompt:'What is 14 + 7?'})})).status,409,'one open version at a time');
  const v2=(await call(`/content/items/${itemId}`,author)).body.versions[0];assert.equal(v2.version,2);assert.equal(v2.status,'draft');
  assert.equal((await call(`/content/versions/${v2.id}/submit`,author,'POST',{})).status,201);
  assert.equal((await call(`/content/versions/${v2.id}/approve`,reviewer,'POST',{})).status,201);
  item=(await call(`/content/items/${itemId}`,author)).body;
  assert.deepEqual(item.versions.map((v:any)=>[v.version,v.status]),[[2,'published'],[1,'retired']]);
  assert.equal(item.versions[1].retirementReason,'Replaced by version 2');assert.equal(item.versions[1].retiredByName,'Efua Reviewer');
  assert.equal((await call('/content/catalogue?search=B5.1',author)).body.items[0].publishedQuestions,1,'still one live question');
  // An author cannot take a published version out of use; a reviewer can, with a reason.
  assert.equal((await call(`/content/versions/${v2.id}/retire`,author,'POST',{reason:'I changed my mind'})).status,403);
  assert.equal((await call(`/content/versions/${v2.id}/retire`,reviewer,'POST',{reason:'x'})).status,400);
  assert.equal((await call(`/content/versions/${v2.id}/retire`,reviewer,'POST',{reason:'Parents say the answer is wrong'})).status,201);
  assert.equal((await call(`/content/versions/${v2.id}/retire`,reviewer,'POST',{reason:'Parents say the answer is wrong'})).status,409);
  assert.equal((await call('/content/catalogue?search=B5.1',author)).body.items[0].publishedQuestions,0);
  const listed=await call(`/content/items?indicatorId=${indicator}&kind=question&mine=true`,author);assert.equal(listed.status,200);assert.ok(listed.body.items.some((i:any)=>i.id===itemId&&i.status==='retired'&&i.lead==='What is 13 + 7?'));
  assert.equal((await call('/content/items?mine=true',author2)).body.items.some((i:any)=>i.id===itemId),false);
});

test('rejecting needs a reason and a reviewer; duplicates and labels stop a submit; a draft can be withdrawn',async()=>{
  const make=async(who:Login,body:any,kind='question',level:number|null=1)=>{const r=await call('/content/items',who,'POST',{kind,indicatorId:indicator,...(level?{level}:{}),body});assert.equal(r.status,201,JSON.stringify(r.body));return r.body as {itemId:string;versionId:string};};
  const first=await make(author,question({prompt:'What is 30 + 12?',options:['42','32','52'],explanation:undefined}));
  assert.equal((await call(`/content/versions/${first.versionId}/submit`,author,'POST',{})).status,201);
  // The same wording from a second author is blocked while the first is in review.
  const twin=await make(author2,question({prompt:'What is 30 + 12?',options:['42','32','52']}));
  const dup=await call(`/content/versions/${twin.versionId}/submit`,author2,'POST',{});assert.equal(dup.status,422);assert.equal(dup.body.details.findings[0].code,'duplicate');assert.deepEqual(dup.body.details.findings[0].related,[first.itemId]);
  // A draft is withdrawn by its author with a reason, not by another author, which frees the slot.
  assert.equal((await call(`/content/versions/${twin.versionId}/retire`,author,'POST',{reason:'Not my draft to withdraw'})).status,403);
  assert.equal((await call(`/content/versions/${twin.versionId}/retire`,author2,'POST',{reason:'Already written by Ama'})).status,201);
  const label=await make(author2,question({prompt:'Which fruit is red?',options:['Apple','Banana','Lime'],explanation:'Children with dyslexia may find reading hard.'}));
  assert.equal((await call(`/content/versions/${label.versionId}/submit`,author2,'POST',{})).body.details.findings[0].code,'labelling_language');
  // Rejection: a reviewer, a reason, and the version stays as written.
  assert.equal((await call(`/content/versions/${first.versionId}/reject`,reviewer,'POST',{})).status,400);
  assert.equal((await call(`/content/versions/${first.versionId}/reject`,author2,'POST',{note:'Not a reviewer'})).status,403);
  assert.equal((await call(`/content/versions/${first.versionId}/reject`,reviewer,'POST',{note:'Option C is also a sensible answer'})).status,201);
  const item=(await call(`/content/items/${first.itemId}`,author)).body;assert.equal(item.versions[0].status,'rejected');assert.equal(item.versions[0].reviewNote,'Option C is also a sensible answer');
  assert.equal((await call(`/content/versions/${first.versionId}/approve`,reviewer,'POST',{})).status,409,'a rejected version cannot be approved later');
  assert.equal((await call(`/content/items/${first.itemId}/versions`,author,'POST',{body:question({prompt:'What is 30 + 12?',options:['42','32','52']})})).status,201,'a fix is a new version');
  // A lead may review work that is not theirs, but never their own.
  const leads=await make(lead,guide(),'guide',null);
  assert.equal((await call(`/content/versions/${leads.versionId}/submit`,lead,'POST',{})).status,201);
  assert.equal((await call(`/content/versions/${leads.versionId}/approve`,lead,'POST',{})).status,403);
  assert.equal((await call(`/content/versions/${leads.versionId}/approve`,reviewer,'POST',{})).status,201);
  const guided=(await call(`/content/items/${leads.itemId}`,author)).body;assert.equal(guided.kind,'guide');assert.equal(guided.level,null);assert.equal(guided.stage,'upper_primary');
  const authored=await make(author,question({prompt:'What is 5 + 5?',options:['10','11','12']}));
  assert.equal((await call(`/content/versions/${authored.versionId}/submit`,author,'POST',{})).status,201);
  assert.equal((await call(`/content/versions/${authored.versionId}/approve`,lead,'POST',{})).status,201,'a lead reviews someone else’s item');
});

test('the database itself refuses what the rules forbid, whatever the service does',async()=>{
  const created=(await call('/content/items',author,'POST',{kind:'question',indicatorId:indicator,level:2,body:question({prompt:'What is 8 + 9?',options:['17','16','18']})})).body;
  const as=async(user:string,sql:string,params:unknown[]=[])=>{const client=await runtime.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true)",[user]);return await client.query(sql,params);}finally{await client.query('ROLLBACK');client.release();}};
  // Skipping review: a draft cannot become published.
  await assert.rejects(as(ids.reviewer,"UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),published_at=now() WHERE id=$1",[created.versionId,ids.reviewer]),/cannot become published|violates check constraint/);
  await call(`/content/versions/${created.versionId}/submit`,author,'POST',{});
  // Approving in someone else's name, or as the author, or without the role.
  await assert.rejects(as(ids.reviewer,"UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),published_at=now() WHERE id=$1",[created.versionId,ids.author]),/in their own name/);
  await assert.rejects(as(ids.author,"UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),published_at=now() WHERE id=$1",[created.versionId,ids.author]),/in their own name|check constraint/);
  await assert.rejects(as(ids.author2,"UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),published_at=now() WHERE id=$1",[created.versionId,ids.author2]),/in their own name/);
  // A submitted version keeps its wording and its author.
  await assert.rejects(as(ids.author,"UPDATE content_versions SET body='{}' WHERE id=$1",[created.versionId]),/cannot be changed/);
  await assert.rejects(as(ids.lead,"UPDATE content_versions SET author_id=$2 WHERE id=$1",[created.versionId,ids.lead]),/permission denied/);
  await assert.rejects(as(ids.lead,'DELETE FROM content_versions WHERE id=$1',[created.versionId]),/permission denied/);
  await assert.rejects(as(ids.lead,"UPDATE content_items SET level=3 WHERE id=$1",[created.itemId]),/permission denied/);
  await assert.rejects(as(ids.lead,"UPDATE content_versions SET review_note='Sneaky edit' WHERE id=$1",[created.versionId]),/only changes by moving/);
  // An author cannot write as someone else.
  await assert.rejects(as(ids.author,"INSERT INTO content_versions(id,item_id,version,body,author_id) VALUES(gen_random_uuid(),$1,9,'{}',$2)",[created.itemId,ids.author2]),/row-level security/);
  // A revoked role stops working at once.
  await owner.query("UPDATE content_staff SET revoked_at=now(),revoked_by=$2 WHERE user_id=$1 AND role='author'",[ids.author2,ids.admin]);
  assert.equal((await call('/content/me',author2)).status,403);
  assert.equal((await call('/auth/session',author2)).body.contentRoles.length,0);
  // The same unique active (user, role) rule holds.
  await assert.rejects(owner.query("INSERT INTO content_staff(id,user_id,role,granted_by) VALUES(gen_random_uuid(),$1,'author',$2),(gen_random_uuid(),$1,'author',$2)",[ids.author,ids.admin]),/content_staff_active/);
});

test('the platform administrator grants and revokes content roles; granting is not automatic access',async()=>{
  assert.equal((await call('/platform/content-staff',lead)).status,403);
  assert.equal((await call('/platform/content-staff',lead,'POST',{role:'lead',email:email('author')})).status,403);
  assert.equal((await call('/platform/content-staff',admin,'POST',{role:'reviewer',email:`nobody-${randomUUID().slice(0,8)}@example.test`})).status,404);
  const fresh=`new-reviewer-${randomUUID().slice(0,8)}@example.test`;
  const made=await call('/platform/content-staff',admin,'POST',{role:'reviewer',email:fresh,name:'Nana New'});assert.equal(made.status,201,JSON.stringify(made.body));assert.ok(made.body.temporaryPassword.length>=16);
  const grant=await call('/platform/content-staff',admin,'POST',{role:'reviewer',email:email('outsider')});assert.equal(grant.status,201);
  assert.equal((await call('/platform/content-staff',admin,'POST',{role:'reviewer',email:email('outsider')})).status,409);
  assert.equal((await call('/platform/content-staff',admin,'POST',{role:'bursar',email:email('outsider')})).status,400);
  // The platform administrator is not on the content team by being the administrator.
  assert.equal((await call('/content/me',admin)).status,403);
  const people=(await call('/platform/content-staff',admin)).body.items;assert.ok(people.some((p:any)=>p.login===fresh&&p.name==='Nana New'&&p.role==='reviewer'));
  const newbie=await loginAs(fresh,made.body.temporaryPassword);
  assert.equal((await call('/content/me',newbie)).body.code,'PASSWORD_CHANGE_REQUIRED','a new account changes its temporary password first');
  const oldOutsider=await login('outsider');assert.deepEqual((await call('/content/me',oldOutsider)).body.roles,['reviewer']);
  const row=people.find((p:any)=>p.userId===ids.outsider&&p.role==='reviewer');
  assert.equal((await call(`/platform/content-staff/${row.id}/revoke`,lead,'POST',{})).status,403);
  assert.equal((await call(`/platform/content-staff/${row.id}/revoke`,admin,'POST',{})).status,201);
  assert.equal((await call(`/platform/content-staff/${row.id}/revoke`,admin,'POST',{})).status,404);
  assert.equal((await call('/content/me',oldOutsider)).status,403);
});

// ---- Findings from the independent review of migration 046 (fixed in 047 and the service)
const as=async(user:string,sql:string,params:unknown[]=[])=>{const client=await runtime.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true)",[user]);return await client.query(sql,params);}finally{await client.query('ROLLBACK');client.release();}};
const draft=async(who:Login,prompt:string,level=1)=>{const r=await call('/content/items',who,'POST',{kind:'question',indicatorId:indicator,level,body:question({prompt,options:['1','2','3'],correctOption:0})});assert.equal(r.status,201,JSON.stringify(r.body));return r.body as {itemId:string;versionId:string};};

test('questions that differ only in the operation or in non-English letters are not duplicates',()=>{
  const codes=(prompt:string,answer:number,others:string[])=>runChecks('question','upper_primary',checkBody('question',1,{kind:'number',prompt,answer}).body,others.map((text,i)=>({itemId:`n${i}`,text}))).findings.map((f:any)=>f.code);
  assert.deepEqual(codes('What is 12 − 7?',5,['What is 12 + 7?','What is 12 × 7?','What is 12 ÷ 7?']),[],'a different operation is a different question');
  assert.deepEqual(codes('What is 1.5 + 2?',3.5,['What is 15 + 2?']),[],'a decimal point matters');
  assert.ok(!codes('Which word has the sound ɔ in it?',1,['Which word has the sound in it?']).includes('duplicate'),'letters such as ɔ and ɛ are kept, so these are not exact repeats (a near repeat only warns)');
  assert.deepEqual(codes('What is 12 + 7?',19,['what is 12 + 7']),['duplicate'],'capitals, the question mark and spacing do not matter');
});

test('the database keeps history on every status change and ties AI authorship to a run',async()=>{
  const one=await draft(author,'Which number is the smallest?');
  const owner1=await as(ids.author,'SELECT id FROM content_versions WHERE id=$1',[one.versionId]);assert.equal(owner1.rowCount,1);
  const submitSql="UPDATE content_versions SET status='in_review',checks='{\"blocking\":0,\"warnings\":0,\"machineChecked\":false,\"findings\":[]}',submitted_at=now()";
  // A submit cannot also write a review note.
  await assert.rejects(as(ids.author,`${submitSql},review_note='Sneaky' WHERE id=$1`,[one.versionId]),/keeps the rest/);
  assert.equal((await call(`/content/versions/${one.versionId}/submit`,author,'POST',{})).status,201);
  const approveSql="UPDATE content_versions SET status='published',reviewer_id=$2,reviewed_at=now(),published_at=now()";
  // A review cannot also rewrite what the checks found or when it was submitted.
  await assert.rejects(as(ids.reviewer,`${approveSql},checks='{}' WHERE id=$1`,[one.versionId,ids.reviewer]),/keeps the rest/);
  await assert.rejects(as(ids.reviewer,`${approveSql},submitted_at=now()-interval '9 days' WHERE id=$1`,[one.versionId,ids.reviewer]),/keeps the rest/);
  assert.equal((await call(`/content/versions/${one.versionId}/approve`,reviewer,'POST',{})).status,201);
  // Taking it out of use cannot erase who reviewed it or when it went live.
  const retireSql="UPDATE content_versions SET status='retired',retired_at=now(),retired_by=$2,retirement_reason='Taken out of use'";
  await assert.rejects(as(ids.reviewer,`${retireSql},reviewer_id=NULL,reviewed_at=NULL,published_at=NULL WHERE id=$1`,[one.versionId,ids.reviewer]),/keeps the rest/);
  assert.equal((await as(ids.reviewer,`${retireSql} WHERE id=$1`,[one.versionId,ids.reviewer])).rowCount,1,'a plain retire is still allowed');
  // A rejection needs its note, and a retirement its reason, even when the application is skipped.
  const two=await draft(author,'Which number is the largest?');await call(`/content/versions/${two.versionId}/submit`,author,'POST',{});
  await assert.rejects(as(ids.reviewer,"UPDATE content_versions SET status='rejected',reviewer_id=$2,reviewed_at=now() WHERE id=$1",[two.versionId,ids.reviewer]),/check constraint|rejected_note/);
  await assert.rejects(as(ids.lead,"UPDATE catalogue_indicators SET retired_at=now(),retired_by=$2 WHERE id=$1",[indicator,ids.lead]),/retired_reason|check constraint/);
  await assert.rejects(as(ids.lead,"UPDATE catalogue_indicators SET retired_at=now(),retired_by=$2,retirement_reason='Not the lead who retires' WHERE id=$1",[indicator,ids.author]),/row-level security/);
  // Claude drafts are not self-declared: a person cannot mark their own insert as AI-written to dodge review by someone else.
  await assert.rejects(as(ids.lead,"INSERT INTO content_versions(id,item_id,version,body,author_id,author_kind) VALUES(gen_random_uuid(),$1,9,'{}',$2,'ai')",[one.itemId,ids.lead]),/row-level security|check constraint/);
});

test('a person who loses the author role can no longer reword or submit their own draft, even at the database',async()=>{
  const ex=randomUUID(),salt=randomBytes(16).toString('hex');
  await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[ex,'Former Author',`ex-${ex.slice(0,8)}@example.test`,`${salt}:${scryptSync(password,salt,64).toString('hex')}`]);
  await owner.query("INSERT INTO content_staff(id,user_id,role,granted_by) VALUES($1,$2,'author',$3)",[randomUUID(),ex,ids.admin]);
  const created=await owner.query("INSERT INTO content_items(id,kind,indicator_id,level,created_by) VALUES(gen_random_uuid(),'question',$1,1,$2) RETURNING id",[indicator,ex]);
  const version=randomUUID();await owner.query("INSERT INTO content_versions(id,item_id,version,body,author_id) VALUES($1,$2,1,$3,$4)",[version,created.rows[0].id,JSON.stringify(question({prompt:'Which shape has three sides?',options:['Triangle','Square','Circle']})),ex]);
  await owner.query("UPDATE content_staff SET revoked_at=now(),revoked_by=$2 WHERE user_id=$1",[ex,ids.admin]);
  await owner.query("INSERT INTO content_staff(id,user_id,role,granted_by) VALUES($1,$2,'reviewer',$3)",[randomUUID(),ex,ids.admin]);
  await assert.rejects(as(ex,"UPDATE content_versions SET body='{}' WHERE id=$1",[version]),/content author/);
  await assert.rejects(as(ex,"UPDATE content_versions SET status='in_review',checks='{}',submitted_at=now() WHERE id=$1",[version]),/author/);
});

test('submitting or approving on a retired catalogue entry is refused, and short reasons and names are refused plainly',async()=>{
  const entry=(await call('/content/catalogue',lead,'POST',{subject:'Science',level:'Basic 3',code:'B3.9.9',description:'Names the parts of a plant',origin:'platform',sourceNote:'Written by the platform team'})).body.id;
  const made=await call('/content/items',author,'POST',{kind:'question',indicatorId:entry,level:1,body:question({prompt:'Which part of a plant takes in water?',options:['Root','Leaf','Flower']})});assert.equal(made.status,201);
  assert.equal((await call(`/content/versions/${made.body.versionId}/submit`,author,'POST',{})).status,201);
  assert.equal((await call(`/content/catalogue/${entry}/retire`,lead,'POST',{reason:'ab '})).status,400,'trimmed, too short: a plain refusal, not a database error');
  assert.equal((await call(`/content/catalogue/${entry}/retire`,lead,'POST',{reason:'Dropped from the scheme'})).status,201);
  assert.equal((await call(`/content/versions/${made.body.versionId}/approve`,reviewer,'POST',{})).status,409,'nothing is published on a retired entry');
  const again=await call('/content/items',author,'POST',{kind:'question',indicatorId:indicator,level:1,body:question({prompt:'Which number comes after 4?',options:['5','6','3']})});
  assert.equal((await call(`/content/versions/${again.body.versionId}/submit`,author,'POST',{})).status,201);
  assert.equal((await call(`/content/versions/${again.body.versionId}/reject`,reviewer,'POST',{note:'ab '})).status,400);
  assert.equal((await call('/content/catalogue',lead,'POST',{subject:'Science',level:'Basic 3',code:'B3.9.8',strand:'a ',description:'Names the parts of a flower',origin:'platform',sourceNote:'Written by the platform team'})).status,400);
  assert.equal((await call('/platform/content-staff',admin,'POST',{role:'author',email:`blank-${randomUUID().slice(0,8)}@example.test`,name:'   '})).status,400,'a blank name does not create an account');
});
