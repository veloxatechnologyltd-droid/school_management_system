import { test,expect,Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');
const school='10000000-0000-4000-8000-000000000001',headMembership='30000000-0000-4000-8000-000000000001',teacherMembership='30000000-0000-4000-8000-000000000003',guardianMembership='30000000-0000-4000-8000-000000000004';
async function signIn(page:Page,email:string,landing:string) {
  await page.goto('/');await page.getByLabel('Email or phone number',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();const picker=page.getByRole('combobox',{name:'School',exact:true});if(await picker.count())await picker.selectOption(school);
  await expect(page.getByRole('heading',{name:'Adinkra Synthetic School',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:landing,exact:true}).click();
}
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

// The model is a stand-in (e2e/claude-standin.mjs, started by playwright.config.ts): every layer of ours runs for real, the provider does not.
// Its first sum in each batch is deliberately wrong, so every level comes back one question short and the screens show the top-up.
// Four people, a model that takes time to write four topics, and a phone: this test needs more than the 60 seconds the quicker tests get.
test.setTimeout(180_000);
test('the head approves a topic and Claude makes it; a teacher reads and retires; a parent reports a question on a phone; the head handles the report',async({page,browser})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page,'head@example.test','Topics');
  const suffix=randomUUID().slice(0,8),topic=`Fractions ${suffix}`,second=`Decimals ${suffix}`,third=`Measures ${suffix}`,fourth=`Shapes ${suffix}`,elsewhere=`Algebra ${suffix}`,className=`Topics class ${suffix}`,learnerName=`Topics Learner ${suffix}`,termName=`Topics term ${suffix}`,yearName=`Topics year ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
  async function send(method:'POST'|'PUT',route:string,body:Record<string,unknown>,status=201){const response=await page.request.fetch(`/api/v1/schools/${school}${route}`,{method,headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(status);return response.json();}
  const year=await send('POST','/academic-years',{name:yearName,startDate:shift(-60),endDate:shift(120)}),section=await send('POST','/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  const subject=await send('POST','/assessment/subjects',{name:`Maths ${suffix}`}),term=await send('POST','/assessment/terms',{academicYearId:year.id,name:termName,startDate:shift(-55),endDate:shift(30)});
  await send('POST','/assessment/indicators',{subjectId:subject.id,origin:'local',sourceNote:'Synthetic scheme of work',items:[{description:topic},{description:second},{description:third},{description:fourth}]});
  await send('POST','/assessment/indicators',{subjectId:subject.id,origin:'local',grade:`Elsewhere ${suffix}`,sourceNote:'Synthetic scheme of work',items:[{description:elsewhere}]});
  const indicator=(await (await page.request.get(`/api/v1/schools/${school}/assessment/indicators?subjectId=${subject.id}`)).json()).items.find((i:any)=>i.description===topic).id;
  // The class teacher has this class today; a learner in it is weak in the topic, and the school's own hand-written set exists for it.
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic topics assignment',$7)",[randomUUID(),school,section.id,teacherMembership,shift(-30),shift(60),headMembership]);
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`TP-${suffix}`,learnerName]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,section.id,shift(-50)]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Abena Sample',true,false,false,true,now(),$5,'Synthetic access')",[randomUUID(),school,learner,guardianMembership,headMembership]);
  const quiz=await send('POST',`/assessment/classes/${section.id}/assessments`,{termId:term.id,subjectId:subject.id,kind:'quiz',title:`Quiz ${suffix}`,heldOn:shift(-5),maxMark:10,indicatorIds:[indicator]});
  await send('POST',`/assessment/classes/${section.id}/assessments/${quiz.id}/marks`,{marks:[{learnerId:learner,mark:2}]});
  const choice=(level:number,n:number)=>({level,kind:'choice',prompt:`Level ${level} choice ${n}: what is ${n} + ${level}?`,options:[String(n+level),String(n+level+1),String(n+level+2)],correctOption:0,explanation:`${n} plus ${level} is ${n+level}.`});
  const number=(level:number,n:number)=>({level,kind:'number',prompt:`Level ${level} number ${n}: a pencil costs GH₵${n}. What do ${level+1} pencils cost in cedis?`,answer:n*(level+1),explanation:`${level+1} times ${n}.`});
  await send('POST',`/assessment/indicators/${indicator}/questions`,{questions:[1,2,3].flatMap(level=>[...[1,2,3,4].map(n=>choice(level,n)),...[5,6].map(n=>number(level,n))])});
  const practiceBefore=await (await page.request.get(`/api/v1/schools/${school}/practice/settings`)).json();
  if(!practiceBefore.enabled)await send('PUT','/practice/settings',{enabled:true,...(practiceBefore.version?{version:practiceBefore.version}:{})},200);
  const ai=await (await page.request.get(`/api/v1/schools/${school}/ai/settings`)).json();
  await send('PUT','/ai/settings',{enabled:true,monthlyRunCap:5000,acknowledgement:'Parents agreed AI drafting in the data-protection notice',...(ai.version?{version:ai.version}:{})},200);

  try {
    // ---- The headteacher approves the topic for the class and Claude makes the lesson and questions.
    await page.reload();await expect(page.getByRole('heading',{name:'Topics',exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'Term',exact:true}).selectOption({label:`${termName} · ${yearName} (now)`});
    await expect(page.getByRole('checkbox',{name:`Select ${elsewhere}`})).toBeVisible();
    await page.getByRole('checkbox',{name:`Select ${topic}`}).check();await page.getByRole('checkbox',{name:`Select ${second}`}).check();await page.getByRole('checkbox',{name:`Select ${third}`}).check();await page.getByRole('checkbox',{name:`Select ${fourth}`}).check();
    await page.getByRole('button',{name:/^Approve for /}).click();
    const dialog=page.getByRole('dialog',{name:/^Approve topics for /});
    await expect(dialog.getByText(/Nothing about any child or any member of staff is sent/)).toBeVisible();
    await dialog.getByRole('combobox',{name:'Class these topics are for',exact:true}).selectOption(className);
    await dialog.getByRole('button',{name:'Approve 4 topics',exact:true}).click();
    const row=page.locator('li').filter({hasText:topic}).filter({has:page.getByRole('button',{name:'Open',exact:true})});
    await expect(page.getByText(/4 topics approved for /)).toBeVisible();
    await expect(page.getByText('Questions 19 · 19 · 19').first()).toBeVisible({timeout:20000});await expect(page.getByText('Questions 19 · 19 · 19')).toHaveCount(4);
    await expect(row.getByText(/Lesson ready · questions 19 \/ 19 \/ 19 \(aim 20 each\)/)).toBeVisible();
    // The checks left one question out of each level; making the rest tops each level up to 20.
    await row.getByRole('button',{name:'Make the missing questions',exact:true}).click();
    await expect(row.getByText('Lesson and 20 questions at each level')).toBeVisible({timeout:20000});
    expect(await noOverflow(page)).toBe(true);

    // ---- Anyone can read what Claude made: the label, the lesson, every question with its answer.
    await row.getByRole('button',{name:'Open',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:topic});
    await expect(drawer.getByText("Made by AI from your school's topics")).toBeVisible();
    await expect(drawer.getByText(/You will learn this:/)).toBeVisible();await expect(drawer.getByText('Worked example')).toBeVisible();
    await expect(drawer.getByText('Level 1').first()).toBeVisible();await expect(drawer.getByText(/20 in use/).first()).toBeVisible();
    const first=drawer.locator('.q-list > li').first();await expect(first.locator('.q-options li.right')).toHaveCount(1);
    await first.getByRole('button',{name:'Retire',exact:true}).click();await first.getByLabel(/^Why\?/).fill('The wording is not clear');await first.getByRole('button',{name:'Retire now',exact:true}).click();
    await expect(drawer.getByText('By a teacher: The wording is not clear')).toBeVisible();await expect(drawer.getByText(/19 in use · 1 retired/)).toBeVisible();
    await page.keyboard.press('Escape');

    // ---- The class teacher sees their class's topic and not another class level's.
    const teacher=await browser.newPage();const teacherErrors:string[]=[];teacher.on('pageerror',error=>teacherErrors.push(error.message));
    await signIn(teacher,'teacher@example.test','Topics');
    await teacher.getByRole('combobox',{name:'Term',exact:true}).selectOption({label:`${termName} · ${yearName} (now)`});
    await expect(teacher.locator('li').filter({hasText:topic}).getByText('Approved',{exact:true})).toBeVisible();
    await expect(teacher.getByRole('checkbox',{name:`Select ${elsewhere}`})).toHaveCount(0);
    await teacher.locator('li').filter({hasText:topic}).getByRole('button',{name:'Open',exact:true}).click();
    await expect(teacher.getByRole('dialog',{name:topic}).getByText(/19 in use · 1 retired/)).toBeVisible();
    await teacher.keyboard.press('Escape');

    // ---- A parent reports a question on a phone; it stops at once and the teacher is told.
    const family=await browser.newPage();const familyErrors:string[]=[];family.on('pageerror',error=>familyErrors.push(error.message));
    await signIn(family,'guardian@example.test','My children');await family.setViewportSize({width:375,height:812});
    await family.getByRole('combobox',{name:'Linked child',exact:true}).selectOption(learner);
    const card=family.getByRole('region',{name:'Practice at home',exact:true});
    await expect(card.getByText(topic)).toBeVisible();await card.locator('li').filter({hasText:topic}).getByRole('button',{name:'Start practice',exact:true}).click();
    const play=family.getByRole('dialog');await expect(play.getByText('Question 1 of 5')).toBeVisible();
    await expect(play.getByText("Made by AI from your school's topics")).toHaveCount(0);
    const prompt=await play.locator('.practice-prompt').innerText();
    if(await play.getByRole('group',{name:'Choose an answer'}).count())await play.getByRole('group',{name:'Choose an answer'}).getByRole('button').first().click();
    else await play.getByLabel('Type your answer (a number)').fill(String(Number(/GH₵(\d+)/.exec(prompt)![1])*Number(/do (\d+) pencils/.exec(prompt)![1])));
    await play.getByRole('button',{name:'Check answer',exact:true}).click();
    await expect(play.getByText('Correct!')).toBeVisible();
    await play.getByRole('button',{name:'This looks wrong',exact:true}).click();
    await play.getByRole('combobox',{name:'What looks wrong?',exact:true}).selectOption('wrong_answer');await play.getByLabel(/^Anything to add/).fill('I think the answer is not right');
    expect(await noOverflow(family)).toBe(true);
    await play.getByRole('button',{name:'Send to the teacher',exact:true}).click();
    await expect(play.getByText('Thank you. We have told the teacher, and this question will not be shown again.')).toBeVisible();
    await expect(play.getByRole('button',{name:'Next question',exact:true})).toBeVisible();
    expect(await noOverflow(family)).toBe(true);

    // The child can also choose any other topic approved for their class this term; its questions are Claude's and say so.
    await family.keyboard.press('Escape');
    await expect(card.getByRole('heading',{name:'Choose a topic',exact:true})).toBeVisible();
    await expect(card.locator('li').filter({hasText:second})).toBeVisible();await expect(card.locator('li').filter({hasText:elsewhere})).toHaveCount(0);
    await card.locator('li').filter({hasText:second}).getByRole('button',{name:'Start practice',exact:true}).click();
    const chosen=family.getByRole('dialog',{name:`Practice: ${second}`});await expect(chosen.getByText('Question 1 of 5')).toBeVisible();
    await expect(chosen.getByText("Made by AI from your school's topics")).toBeVisible();
    expect(await noOverflow(family)).toBe(true);await family.keyboard.press('Escape');

    // Study first: the lesson one step at a time on a Primary child's phone, then straight into the check.
    await card.locator('li').filter({hasText:third}).getByRole('button',{name:'Study first',exact:true}).click();
    const lesson=family.getByRole('dialog',{name:`Study: ${third}`});
    await expect(lesson.getByText("Made by AI from your school's topics")).toBeVisible();await expect(lesson.getByText('Step 1 of 6')).toBeVisible();await expect(lesson.getByText(/You will learn this:/)).toBeVisible();
    await expect(lesson.getByRole('button',{name:'Check what you learned',exact:true})).toHaveCount(0);
    for(let i=0;i<5;i++)await lesson.getByRole('button',{name:'Next',exact:true}).click();
    await expect(lesson.getByText('Step 6 of 6')).toBeVisible();await expect(lesson.getByText('A worked example')).toHaveCount(0);await expect(lesson.getByText('Remember')).toBeVisible();
    expect(await noOverflow(family)).toBe(true);
    await lesson.getByRole('button',{name:'Check what you learned',exact:true}).click();
    const afterStudy=family.getByRole('dialog',{name:`Practice: ${third}`});await expect(afterStudy.getByText('Question 1 of 5')).toBeVisible();await family.keyboard.press('Escape');
    // The head sees the study on the learner's page, beside class work.
    await page.goto(`/#/learner/${learner}`);await expect(page.getByText('Lessons studied')).toBeVisible();await expect(page.getByText(/no check taken/)).toBeVisible();
    await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Topics',exact:true}).click();await expect(page.getByRole('heading',{name:'Topics',exact:true})).toBeVisible();
    // A parent can report a lesson: it stops at once, and Study is no longer offered for that topic.
    await card.locator('li').filter({hasText:fourth}).getByRole('button',{name:'Study first',exact:true}).click();
    const reported=family.getByRole('dialog',{name:`Study: ${fourth}`});await reported.getByRole('button',{name:'This looks wrong',exact:true}).click();
    await reported.getByRole('button',{name:'Send to the teacher',exact:true}).click();
    await expect(reported.getByText('Thank you. We have told the teacher, and this lesson will not be shown again.')).toBeVisible();expect(await noOverflow(family)).toBe(true);await family.keyboard.press('Escape');
    await expect(card.locator('li').filter({hasText:fourth}).getByRole('button',{name:'Study first',exact:true})).toHaveCount(0);await expect(card.locator('li').filter({hasText:fourth})).toHaveCount(1);

    // ---- The teacher and the head see the report, without the parent's name, and handle it.
    await teacher.reload();await teacher.getByRole('combobox',{name:'Term',exact:true}).selectOption({label:`${termName} · ${yearName} (now)`});
    const report=teacher.locator('li').filter({hasText:'Parent wrote: “I think the answer is not right”'});
    await expect(report).toBeVisible();await expect(report.getByText(/The answer looks wrong/)).toBeVisible();await expect(teacher.getByText(/Abena/)).toHaveCount(0);
    await page.reload();await page.getByRole('combobox',{name:'Term',exact:true}).selectOption({label:`${termName} · ${yearName} (now)`});
    const headReport=page.locator('li').filter({hasText:'Parent wrote: “I think the answer is not right”'});await expect(headReport).toBeVisible();
    await headReport.getByRole('button',{name:'It was wrong',exact:true}).click();await expect(headReport).toHaveCount(0);
    // The lesson the parent reported is in the same list, shown as a lesson.
    const lessonReport=page.locator('li').filter({hasText:'You will learn this:'}).filter({has:page.getByRole('button',{name:'It was wrong',exact:true})});
    await expect(lessonReport).toBeVisible();await lessonReport.getByRole('button',{name:'It was fine',exact:true}).click();await expect(lessonReport).toHaveCount(0);
    await expect(page.getByText(/Reported by parents \(/)).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});expect(await noOverflow(page)).toBe(true);

    // ---- A teacher's learning note is for staff only: refused if it names the student, kept and withdrawn with a reason, and never on a family's screen.
    await teacher.goto(`/#/learner/${learner}`);
    const notes=teacher.locator('.card').filter({has:teacher.getByRole('heading',{name:'Learning notes',exact:true})});await expect(notes).toBeVisible();
    await expect(notes.getByText(/parents never see these/)).toBeVisible();
    const how=notes.getByLabel('How to help this student'),add=notes.getByRole('button',{name:'Add learning note',exact:true});
    await how.fill(`Learner ${suffix} needs a front seat`);await add.click();await expect(notes.getByRole('alert')).toContainText("Leave the student's name");
    await how.fill('Feels unwell often so go gently');await add.click();await expect(notes.getByRole('alert')).toContainText('Health, family and home matters');
    const text='Short instructions and one example first';
    await how.fill(text);await notes.getByLabel(/Topic to put first/).selectOption({label:`Maths ${suffix}: ${second}`});await expect(notes.getByLabel(/Keep it first until/)).toBeVisible();await add.click();
    await expect(notes.getByRole('status')).toContainText('Note saved for staff.');await expect(notes.locator('li').filter({hasText:text})).toContainText(`First: ${second}`);
    // The family never sees it, on the practice screen or in the notes with the school.
    await family.reload();await family.getByRole('combobox',{name:'Linked child',exact:true}).selectOption(learner);
    await expect(card.getByText(topic)).toBeVisible();await expect(family.getByText(text)).toHaveCount(0);await expect(family.getByText(/Learning notes|put first/i)).toHaveCount(0);
    expect(await noOverflow(family)).toBe(true);
    await notes.locator('li').filter({hasText:text}).getByRole('button',{name:'Withdraw',exact:true}).click();
    await notes.getByLabel(/^Why\?/).fill('No longer needed');await notes.getByRole('button',{name:'Withdraw note',exact:true}).click();
    await expect(notes.getByRole('status')).toContainText('Note withdrawn');await notes.getByRole('button',{name:/Show 1 withdrawn note/}).click();
    await expect(notes.locator('li').filter({hasText:text})).toContainText('No longer needed');
    expect(errors).toEqual([]);expect(teacherErrors).toEqual([]);expect(familyErrors).toEqual([]);
  } finally {
    // Leave the school's settings as found.
    if(!practiceBefore.enabled)try{const now=await (await page.request.get(`/api/v1/schools/${school}/practice/settings`,{timeout:10000})).json();await page.request.fetch(`/api/v1/schools/${school}/practice/settings`,{method:'PUT',headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),enabled:false,version:now.version},timeout:10000});}catch{/* the test's own failure is the one to report */}
    await owner.end();
  }
});
