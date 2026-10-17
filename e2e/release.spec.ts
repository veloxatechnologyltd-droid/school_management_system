import { test,expect,Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const {JobWorker}=require('../backend/dist/jobs/worker');
const school='10000000-0000-4000-8000-000000000001';
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));});
// Only accounts with more than one school see the school picker.
async function pickSchool(p:Page) {
  await expect(p.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();const picker=p.getByRole('combobox',{name:'School',exact:true});if(await picker.count())await picker.selectOption(school);
}
async function openSetting(page:Page,name:string){await page.getByRole('navigation',{name:'Settings',exact:true}).getByRole('link',{name,exact:true}).click();}
async function signIn(page:Page,email='head@example.test',tab='') {
  await page.goto('/#/signin');await page.getByLabel('Email or phone number',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await pickSchool(page);
  await expect(page.getByRole('heading',{name:'Adinkra Synthetic School',exact:true})).toBeVisible();
  if(tab){await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:tab,exact:true}).click();}
}
// A parent with one child has no child picker; with several, the test picks. Wait for the children to load first.
async function chooseChild(page:Page,id:string) {
  await expect(page.locator('.page-eyebrow').first()).not.toHaveText('My family');
  const picker=page.getByRole('combobox',{name:'Linked child',exact:true});if(await picker.count())await picker.selectOption(id);
}
test('CSV import requires fresh review, commits selected students and retains approval on reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Students');
  const suffix=randomUUID().slice(0,8),className=`CSV class ${suffix}`,fileName=`learners-${suffix}.csv`,reason='Reviewed synthetic source and distinct identities';
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`CSV year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  await page.getByRole('button',{name:'Import existing students',exact:true}).click();
  await page.getByLabel('Search import classes',{exact:true}).fill(className);await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await page.getByRole('combobox',{name:'Target class',exact:true}).selectOption(section.id);
  await page.getByLabel('Search import classes',{exact:true}).fill('no matching class');await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await expect(page.getByRole('combobox',{name:'Target class',exact:true})).toHaveValue('');
  await page.getByLabel('Search import classes',{exact:true}).fill(className);await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await page.getByRole('combobox',{name:'Target class',exact:true}).selectOption(section.id);
  await page.getByLabel('Enrolment start date',{exact:true}).fill('2026-09-01');
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:fileName,mimeType:'text/csv',buffer:Buffer.from(`admission_number,full_name,date_of_birth\nCSV-A-${suffix},Synthetic Import A ${suffix},2019-01-01\nCSV-B-${suffix},Synthetic Import B ${suffix},\nINVALID!,Invalid student,`)});
  await page.getByRole('button',{name:'Stage CSV for validation',exact:true}).click();await expect(page.getByRole('heading',{name:`Preview: ${fileName}`,exact:true})).toBeVisible();
  await expect(page.getByLabel(`Row 2: Synthetic Import A ${suffix} · CSV-A-${suffix} · Born 2019-01-01`,{exact:true})).toBeDisabled();
  await page.reload();await pickSchool(page);await page.getByRole('button',{name:'Import existing students',exact:true}).click();
  await page.getByLabel('Search import batches',{exact:true}).fill(fileName);await page.getByRole('button',{name:'Search batches',exact:true}).click();await page.locator('li').filter({hasText:fileName}).getByRole('button',{name:'Open import preview',exact:true}).click();
  await page.getByRole('button',{name:'Revalidate this preview',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Validation refreshed.'})).toBeVisible();
  const first=page.getByLabel(`Row 2: Synthetic Import A ${suffix} · CSV-A-${suffix} · Born 2019-01-01`,{exact:true}),second=page.getByLabel(`Row 3: Synthetic Import B ${suffix} · CSV-B-${suffix}`,{exact:true}),confirmation=page.getByLabel('I reviewed the validation results and selected student identities for this import.',{exact:true});
  await first.check();await page.getByLabel('Import approval reason',{exact:true}).fill(reason);await confirmation.check();await expect(page.getByRole('button',{name:'Commit 1 selected rows',exact:true})).toBeEnabled();
  await second.check();await expect(confirmation).not.toBeChecked();await expect(page.getByRole('button',{name:'Commit 2 selected rows',exact:true})).toBeDisabled();await confirmation.check();
  await page.getByLabel('Import approval reason',{exact:true}).fill(reason+' reviewed');await expect(confirmation).not.toBeChecked();await confirmation.check();
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Commit 2 selected rows',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Import committed. 2 student rows were processed.'})).toBeVisible();
  await page.reload();await pickSchool(page);await page.getByRole('button',{name:'Import existing students',exact:true}).click();await page.getByLabel('Search import batches',{exact:true}).fill(fileName);await page.getByRole('button',{name:'Search batches',exact:true}).click();await page.locator('li').filter({hasText:fileName}).getByRole('button',{name:'Open import preview',exact:true}).click();
  await expect(page.getByText(`Approval reason: ${reason} reviewed`,{exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'This import is committed'})).toBeVisible();
  const learners=await (await page.request.get(`/api/v1/schools/${school}/learners?search=CSV-A-${suffix}`)).json();expect(learners.total).toBe(1);const detail=await (await page.request.get(`/api/v1/schools/${school}/learners/${learners.items[0].id}`)).json();expect(detail.enrolments).toHaveLength(1);expect(detail.enrolments[0].class_id).toBe(section.id);expect(errors).toEqual([]);
});
test('collection verifies pickup, records headteacher exceptions and preserves consumed authority after correction',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Pickup');const suffix=randomUUID().slice(0,8),name=`Synthetic Collection Child ${suffix}`,number=`PICK-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const roster=await (await page.request.get(`/api/v1/schools/${school}/collection/learners`)).json(),today=roster.date,previous=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
  const year=await post('/academic-years',{name:`Collection year ${suffix}`,startDate:previous,endDate:'2027-08-01'}),section=await post('/classes',{name:`Collection KG ${suffix}`,level:'KG',capacity:5,academicYearId:year.id});
  let admission=await post('/admissions',{fullName:name,admissionNumber:number,classId:section.id,startDate:previous});for(const action of ['review','offer','accept','enrol'])admission=await post(`/admissions/${admission.id}/transition`,{version:admission.version,action});
  const guardian=await post('/guardian-links',{learnerId:admission.learner_id,guardianMembershipId:'30000000-0000-4000-8000-000000000004',academic:false,billing:false,pickup:true,contact:false});await post(`/guardian-links/${guardian.id}/verify`,{version:1,reason:'Head reviewed synthetic pickup authority'});
  const context=await browser.newContext(),frontdesk=await context.newPage();frontdesk.on('pageerror',error=>errors.push(error.message));
  async function choose(target:Page){const panel=target.locator('section').filter({has:target.getByRole('heading',{name:'Student collection',exact:true})});await panel.getByLabel('Search students',{exact:true}).fill(number);await panel.getByRole('button',{name:'Search collection roster',exact:true}).click();await panel.getByRole('button',{name,exact:true}).click();await expect(panel.getByRole('heading',{name,exact:true})).toBeVisible();return panel;}
  try{
    await signIn(frontdesk,'frontdesk@example.test');const deskPanel=await choose(frontdesk);await deskPanel.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true}).selectOption(`parent:${guardian.id}`);
    const confirmation=deskPanel.getByLabel('I confirmed the collector’s identity in person and am handing the student into their care now.',{exact:true});await deskPanel.getByLabel('Staff verification reason',{exact:true}).fill('Compared synthetic collector in person against reviewed school record');await confirmation.check();await deskPanel.getByLabel('Staff verification reason',{exact:true}).fill('Rechecked synthetic collector in person against reviewed school record');await expect(confirmation).not.toBeChecked();await confirmation.check();
    await frontdesk.setViewportSize({width:375,height:812});expect(await frontdesk.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await deskPanel.getByRole('button',{name:'Record student release',exact:true}).click();await expect(deskPanel.getByRole('status').filter({hasText:'Collection release recorded for Abena Sample.'})).toBeVisible();await expect(deskPanel.getByRole('button',{name:'Record student release',exact:true})).toHaveCount(0);
    const headPanel=await choose(page);await headPanel.getByText('Correct mistaken release record',{exact:true}).click();await headPanel.getByLabel('Correction reason',{exact:true}).fill('Synthetic mistaken recording correction; no physical return claimed');await headPanel.getByRole('button',{name:'Void mistaken release record',exact:true}).click();await expect(headPanel.getByRole('status').filter({hasText:'Release record voided as a correction.'})).toBeVisible();
    await post(`/guardian-links/${guardian.id}/revoke`,{version:2,reason:'Synthetic pickup authority ended'});
    await frontdesk.reload();await pickSchool(frontdesk);const requestPanel=await choose(frontdesk);await expect(requestPanel.getByText('No current pickup authorization or approved exception is available.',{exact:true})).toBeVisible();await requestPanel.getByText('Request an unexpected collector review',{exact:true}).click();await requestPanel.getByLabel('Unexpected collector name',{exact:true}).fill('Synthetic Alternate Collector');await requestPanel.getByLabel('Reason for requesting this exception',{exact:true}).fill('Unexpected collector requires separate headteacher verification');await requestPanel.getByRole('button',{name:'Request headteacher review',exact:true}).click();await expect(requestPanel.getByRole('status').filter({hasText:'Unexpected collector request recorded'})).toBeVisible();await expect(requestPanel.getByRole('button',{name:'Approve one-time exception',exact:true})).toHaveCount(0);
    await headPanel.getByRole('button',{name:'Refresh collection records',exact:true}).click();const reviewer=await choose(page);const pending=reviewer.locator('li').filter({hasText:'Synthetic Alternate Collector · pending'});await pending.getByLabel('Review reason',{exact:true}).fill('Head reviewed separate one-time permission');await pending.getByLabel('In-person identity verification reason (required to approve)',{exact:true}).fill('Synthetic head verified identity through the school procedure');await pending.getByRole('button',{name:'Approve one-time exception',exact:true}).click();await expect(reviewer.getByRole('status').filter({hasText:'Collector request approved.'})).toBeVisible();
    await requestPanel.getByRole('button',{name:'Refresh collection records',exact:true}).click();const releasePanel=await choose(frontdesk);await expect(releasePanel.getByText('Identity verification:',{exact:false})).toHaveCount(0);await releasePanel.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true}).selectOption({label:'Approved one-time exception: Synthetic Alternate Collector'});await releasePanel.getByLabel('Staff verification reason',{exact:true}).fill('Staff confirmed the exceptional collector in person');await releasePanel.getByLabel('I confirmed the collector’s identity in person and am handing the student into their care now.',{exact:true}).check();await releasePanel.getByRole('button',{name:'Record student release',exact:true}).click();await expect(releasePanel.getByRole('status').filter({hasText:'Collection release recorded for Synthetic Alternate Collector.'})).toBeVisible();
    await reviewer.getByRole('button',{name:'Refresh collection records',exact:true}).click();const correction=await choose(page);const exceptional=correction.locator('li').filter({hasText:'One-time exception used.'});await exceptional.getByText('Correct mistaken release record',{exact:true}).click();await exceptional.getByLabel('Correction reason',{exact:true}).fill('Correct synthetic entry without restoring consumed authority');await exceptional.getByRole('button',{name:'Void mistaken release record',exact:true}).click();await expect(correction.getByRole('status').filter({hasText:'Release record voided as a correction.'})).toBeVisible();await expect(correction.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();await expect(correction.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true})).toHaveCount(0);
    await frontdesk.reload();await pickSchool(frontdesk);const persisted=await choose(frontdesk);await expect(persisted.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();await expect(persisted.getByText('No current pickup authorization or approved exception is available.',{exact:true})).toBeVisible();
    await post(`/learners/${admission.learner_id}/withdraw`,{version:1,effectiveDate:today,reason:'Synthetic departed child retains collection history'});await persisted.getByRole('button',{name:'Refresh collection records',exact:true}).click();await persisted.getByLabel('Include students with collection history',{exact:true}).check();const historical=await choose(frontdesk);await expect(historical.getByRole('status').filter({hasText:'Collection activity is history-only'})).toBeVisible();await expect(historical.getByRole('button',{name:'Record student release',exact:true})).toHaveCount(0);await expect(historical.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();expect(errors).toEqual([]);
  }finally{await context.close();}
});
test('admission decisions, enrolment, transfer and reload preserve history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8),yearName=`Browser year ${suffix}`,first=`Primary Blue ${suffix}`,second=`Primary Green ${suffix}`,name=`Synthetic Browser Student ${suffix}`,admission=`WEB-${suffix}`;
  await signIn(page,'head@example.test','Classes');
  await page.getByLabel('Year name',{exact:true}).fill(yearName);await page.getByLabel('Start date',{exact:true}).fill('2026-09-02');await page.getByLabel('End date (exclusive)',{exact:true}).fill('2027-08-01');await page.getByRole('button',{name:'Add academic year',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Academic year added.'})).toBeVisible();
  for(const className of [first,second]) {
    await page.getByLabel('Class name',{exact:true}).fill(className);await page.getByLabel('Capacity',{exact:true}).fill('5');await page.getByRole('combobox',{name:'Academic year',exact:true}).selectOption({label:yearName});
    await page.getByRole('button',{name:'Add class',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Class added.'})).toBeVisible();await expect(page.getByLabel('Class name',{exact:true})).toHaveValue('');
  }
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Students',exact:true}).click();
  await page.getByRole('button',{name:'New application',exact:true}).click();await page.getByLabel('Student full name',{exact:true}).fill(name);await page.getByLabel('Admission number',{exact:true}).fill(admission);await page.getByRole('combobox',{name:'Intended class',exact:true}).selectOption({label:`${first} · Primary · ${yearName}`});await page.getByLabel('Proposed start date',{exact:true}).fill('2026-09-02');await page.getByRole('button',{name:'Record application',exact:true}).click();
  const application=page.locator('tr').filter({hasText:admission});await expect(application).toContainText('Application');
  await application.getByRole('link',{name,exact:true}).click();
  for(const action of ['Start review','Offer place','Record acceptance','Enrol student']){await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);}
  await expect(page.locator('.admission-next')).toContainText('on the roll');await page.goBack();
  async function findLearner(){const panel=page.getByRole('region',{name:'Admissions and students'});await panel.getByRole('tab',{name:/^Student roll/}).click();await panel.getByLabel('Search students',{exact:true}).fill(admission);await panel.locator('form').filter({hasText:'Search students'}).getByRole('button',{name:'Search',exact:true}).click();await panel.getByRole('button',{name,exact:true}).click();}
  await findLearner();
  await expect(page.getByRole('heading',{name:'Class history',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'New class',exact:true}).selectOption({label:`${second} · Primary · ${yearName}`});await page.getByLabel('Effective date',{exact:true}).fill('2026-10-01');await page.getByLabel('Transfer reason',{exact:true}).fill('Synthetic browser transfer review');await page.getByRole('button',{name:'Record transfer',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Previous enrolment history is retained.'})).toBeVisible();await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText('2026-10-01');
  await page.reload();await pickSchool(page);await findLearner();
  const history=page.locator('div').filter({has:page.getByRole('heading',{name:'Class history',exact:true})}).last();
  await expect(history).toContainText('Synthetic browser transfer review');await expect(history).toContainText(second);await expect(history).toContainText('Scheduled');
  await page.setViewportSize({width:375,height:812});await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/admissions-mobile.png'});expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Withdraw student',exact:true}).click();await page.getByLabel('Withdrawal date (first day out of class)',{exact:true}).fill('2026-09-29');await page.getByLabel('Withdrawal reason',{exact:true}).fill('Synthetic reviewed school departure');await page.getByRole('button',{name:'Record withdrawal',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Withdrawal recorded.'})).toBeVisible();await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toHaveCount(0);
  await page.reload();await pickSchool(page);await findLearner();
  await expect(page.locator('li').filter({hasText:'Synthetic reviewed school departure'}).filter({hasText:'2026-09-29'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:second}).filter({hasText:'Superseded'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText(first);
  await expect(page.getByText('No open enrolment. Previous student and class records are retained.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Withdraw student',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test('authorized audit export is generated and downloaded with tenant-scoped records',async({page})=>{
  await signIn(page,'head@example.test','Settings');await openSetting(page,'Activity log');await page.getByRole('button',{name:'Export audit history',exact:true}).click();await page.getByRole('button',{name:'Prepare export',exact:true}).click();await expect(page.getByRole('button',{name:'Check export progress',exact:true})).toBeVisible();
  const worker=new JobWorker();try{await worker.runOnce();}finally{await worker.close();}
  await page.getByRole('button',{name:'Check export progress',exact:true}).click();await expect(page.getByRole('button',{name:'Download audit JSON',exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download audit JSON',exact:true}).click();const download=await downloadEvent;await download.saveAs('.local/browser-audit-export.json');
  const result=JSON.parse(await readFile('.local/browser-audit-export.json','utf8'));expect(result.schoolId).toBe(school);expect(result.rows.length).toBeGreaterThan(0);expect(result.rows.length).toBeLessThanOrEqual(500);
});
test('teacher browser exposes no admissions controls and server rejects direct administration',async({page})=>{
  await signIn(page,'teacher@example.test');await expect(page.getByRole('heading',{name:'Admissions and students',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export audit history',exact:true})).toHaveCount(0);
  const denied=await page.request.get(`/api/v1/schools/${school}/admissions`);expect(denied.status()).toBe(403);
});
test('parent verification, distinct rights and revocation persist across two browser sessions',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Parents');
  const suffix=randomUUID().slice(0,8),name=`Synthetic Parent Child ${suffix}`,admission=`FAM-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Family year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Family class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:name,dateOfBirth:'2018-05-03',admissionNumber:admission,classId:section.id,startDate:'2026-09-01'});
  for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const family=page.locator('section').filter({has:page.getByRole('heading',{name:'Parent rights',exact:true})});
  await family.getByRole('button',{name:'Link a parent',exact:true}).click();await family.getByLabel('Search students',{exact:true}).fill(name);await family.getByRole('button',{name:'Search students',exact:true}).click();await family.getByRole('combobox',{name:'Student',exact:true}).selectOption({label:`${name} · ${admission}`});
  async function create(right:string){await family.getByRole('combobox',{name:'Existing active parent',exact:true}).selectOption('30000000-0000-4000-8000-000000000004');await family.getByRole('checkbox',{name:right,exact:true}).check();await family.getByRole('button',{name:'Create pending parent link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'pending verification'})).toBeVisible();}
  await create('Billing information');let pending=family.locator('tr').filter({hasText:name}).filter({hasText:'Pending verification'});await expect(pending).toBeVisible();
  const context=await browser.newContext();const portal=await context.newPage();portal.on('pageerror',error=>errors.push(error.message));await portal.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));
  try{
    await signIn(portal,'guardian@example.test');await expect(portal.getByRole('heading',{name:'Home',exact:true})).toBeVisible();await expect(portal.getByText('No children linked yet')).toBeVisible();await expect(portal.getByText(`Admission number ${admission}`)).toHaveCount(0);
    await pending.getByRole('button',{name:/^Review /}).click();await family.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed billing authority');await family.getByRole('button',{name:'Verify parent link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Parent link verified.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh parent records',exact:true}).click();await expect(portal.getByText(`Admission number ${admission}`)).toBeVisible();await expect(portal.getByRole('heading',{name,exact:true})).toBeVisible();await expect(portal.getByRole('heading',{name:'Your verified access',exact:true})).toBeVisible();await expect(portal.getByRole('heading',{name:/^About /})).toHaveCount(0);
    const billing=await (await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).json();expect(billing.billing).toBe(true);expect(billing).not.toHaveProperty('date_of_birth');expect(billing).not.toHaveProperty('enrolments');
    const verified=family.locator('tr').filter({hasText:name}).filter({hasText:'Synthetic reviewed billing authority'});await verified.getByRole('button',{name:/^Review /}).click();await family.getByLabel('Revocation reason',{exact:true}).fill('Synthetic sponsor authority ended');await family.getByRole('button',{name:'Revoke parent link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Parent link revoked.'})).toBeVisible();
    expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).status()).toBe(404);await portal.getByRole('button',{name:'Refresh parent records',exact:true}).click();await expect(portal.getByText('No children linked yet')).toBeVisible();await expect(portal.getByText(`Admission number ${admission}`)).toHaveCount(0);
    await family.getByRole('button',{name:'Link a parent',exact:true}).click();await create('Academic records');pending=family.locator('tr').filter({hasText:name}).filter({hasText:'Pending verification'});await pending.getByRole('button',{name:/^Review /}).click();await family.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed academic authority');await family.getByRole('button',{name:'Verify parent link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Parent link verified.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh parent records',exact:true}).click();await expect(portal.getByText(`Admission number ${admission}`)).toBeVisible();await expect(portal.getByText('Date of birth: 3 May 2018',{exact:true})).toBeVisible();await expect(portal.locator('li').filter({hasText:`Family class ${suffix}`})).toContainText('Active today');
    await portal.setViewportSize({width:375,height:812});expect(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await portal.getByRole('heading',{name:'Home',exact:true}).scrollIntoViewIfNeeded();await portal.screenshot({path:'.local/guardian-mobile.png'});
    expect((await portal.request.get(`/api/v1/schools/${school}/learners/${application.learner_id}`)).status()).toBe(403);expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${randomUUID()}`)).status()).toBe(404);
    const academic=family.locator('tr').filter({hasText:name}).filter({hasText:'Synthetic reviewed academic authority'});await academic.getByRole('button',{name:/^Review /}).click();await family.getByLabel('Revocation reason',{exact:true}).fill('Synthetic academic authority ended');await family.getByRole('button',{name:'Revoke parent link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Parent link revoked.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh parent records',exact:true}).click();await expect(portal.getByText('Date of birth: 3 May 2018',{exact:true})).toHaveCount(0);await expect(portal.getByText(`Admission number ${admission}`)).toHaveCount(0);await expect(portal.getByText('No children linked yet')).toBeVisible();expect(errors).toEqual([]);
  }finally{await context.close();}
});
test('dated teacher grant, fresh roster and revocation work across two browser sessions',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Teachers');await page.getByRole('tab',{name:'Class assignments',exact:true}).click();
  const suffix=randomUUID().slice(0,8),className=`Roster class ${suffix}`,name=`Synthetic Roster Student ${suffix}`,lateName=`Synthetic Late Student ${suffix}`;
  const today=new Date().toISOString().slice(0,10),day=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Roster year ${suffix}`,startDate:day(-30),endDate:day(100)}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  for(const [fullName,startDate,admissionNumber] of [[name,today,`REG-${suffix}`],[lateName,day(1),`LATE-${suffix}`]]){
    let application=await post('/admissions',{fullName,startDate,admissionNumber,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  }
  const teaching=page.getByRole('region',{name:'Teacher assignments',exact:true});await teaching.getByRole('button',{name:'Refresh assignments',exact:true}).click();await teaching.getByRole('button',{name:'Assign a teacher',exact:true}).click();
  const assign=page.getByRole('dialog',{name:'Assign a teacher',exact:true});if(await assign.getByLabel('Find a class',{exact:true}).count()){await assign.getByLabel('Find a class',{exact:true}).fill(className);await assign.getByRole('button',{name:'Search classes',exact:true}).click();}await assign.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);
  const context=await browser.newContext(),teacherPage=await context.newPage();teacherPage.on('pageerror',error=>errors.push(error.message));await teacherPage.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
  try{
    await signIn(teacherPage,'teacher@example.test');expect((await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).status()).toBe(404);
    await assign.getByRole('combobox',{name:'Teacher',exact:true}).selectOption('30000000-0000-4000-8000-000000000003');await assign.getByLabel('Assignment start date (inclusive)',{exact:true}).fill(today);await assign.getByLabel('Assignment end date (exclusive)',{exact:true}).fill(day(100));await assign.getByLabel('Reason authorizing whole-class roster access',{exact:true}).fill('Synthetic headteacher reviewed class responsibility');await assign.getByRole('button',{name:'Create teacher assignment',exact:true}).click();await expect(teaching.getByRole('status').filter({hasText:'Teaching assignment created.'})).toBeVisible();
    const sections=teacherPage.getByRole('navigation',{name:'Sections',exact:true});
    await sections.getByRole('link',{name:'Classes',exact:true}).click();await teacherPage.getByRole('button',{name:'Refresh class access',exact:true}).click();
    await sections.getByRole('link',{name:'Today',exact:true}).click();const teacherAttendance=teacherPage.locator('section').filter({has:teacherPage.getByRole('heading',{name:'Attendance',exact:true})});await teacherAttendance.getByLabel('Date',{exact:true}).fill(today);await teacherAttendance.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);
    await sections.getByRole('link',{name:'Classes',exact:true}).click();await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);
    const teacherRoster=teacherPage.locator('section').filter({has:teacherPage.getByRole('heading',{name:'My classes',exact:true})});await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(1);await expect(teacherRoster.locator('li').filter({hasText:lateName})).toHaveCount(0);
    const roster=await (await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).json();expect(roster.total).toBe(1);expect(Object.keys(roster.items[0]).sort()).toEqual(['admission_number','enrolment_id','full_name','id']);
    await teacherPage.getByLabel('Class date',{exact:true}).fill(day(1));await teacherPage.getByRole('button',{name:'Show classes for date',exact:true}).click();await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);await expect(teacherRoster.locator('li').filter({hasText:lateName})).toHaveCount(1);
    await teacherPage.reload();await pickSchool(teacherPage);await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(1);
    await teacherPage.setViewportSize({width:375,height:812});expect(await teacherPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await teacherPage.getByRole('heading',{name:'My classes',exact:true}).scrollIntoViewIfNeeded();await teacherPage.screenshot({path:'.local/teacher-mobile.png'});
    await teaching.getByRole('row').filter({hasText:className}).getByRole('button',{name:/^Revoke /}).click();const revoke=page.getByRole('dialog',{name:/^Revoke /});await revoke.getByLabel('Revocation reason',{exact:true}).fill('Synthetic reviewed teaching responsibility ended');await revoke.getByRole('button',{name:'Revoke assignment',exact:true}).click();await expect(teaching.getByRole('status').filter({hasText:'Assignment revoked for Kofi Sample.'})).toBeVisible();
    expect((await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).status()).toBe(404);
    await teacherPage.getByLabel('Search this roster',{exact:true}).fill(name);await teacherPage.getByRole('button',{name:'Search roster',exact:true}).click();await expect(teacherPage.getByRole('alert').filter({hasText:'Class access could not be refreshed'})).toBeVisible();await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(0);
    await teacherPage.getByRole('button',{name:'Refresh class access',exact:true}).click();await expect(teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).locator('option').filter({hasText:className})).toHaveCount(0);
    await teacherPage.getByRole('button',{name:'Menu',exact:true}).click();await sections.getByRole('link',{name:'Today',exact:true}).click();await expect(teacherAttendance.getByRole('combobox',{name:'Class',exact:true}).locator('option').filter({hasText:className})).toHaveCount(0);
    await page.reload();await pickSchool(page);await expect(page.getByRole('row').filter({hasText:className}).filter({hasText:'Synthetic reviewed teaching responsibility ended'})).toContainText(className);expect(errors).toEqual([]);
  }finally{await context.close();}
});
test('a teacher can submit a fresh register without saving a draft first',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Attendance');
  const suffix=randomUUID().slice(0,8),day='2026-09-29',name=`Synthetic Direct Submit ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Direct submit year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Direct submit class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:name,startDate:'2026-09-28',admissionNumber:`DIR-${suffix}`,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const existing=(await (await page.request.get(`/api/v1/schools/${school}/attendance/school-days?day=${day}`)).json())[0];await post('/attendance/school-days',{day,isOpen:true,reason:'Synthetic open day for direct submit',...(existing?{version:existing.version}:{})});
  const attendance=page.locator('section').filter({has:page.getByRole('heading',{name:'Attendance',exact:true})});
  await attendance.getByLabel('Date',{exact:true}).fill(day);await attendance.getByLabel('Find a class',{exact:true}).fill(`Direct submit class ${suffix}`);await attendance.getByRole('button',{name:'Find class',exact:true}).click();await attendance.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);
  await attendance.getByRole('group',{name:`Attendance for ${name}`,exact:true}).getByRole('button',{name:'Present',exact:true}).click();await attendance.getByRole('button',{name:'Submit register',exact:true}).click();
  await expect(attendance.getByText(/Status: submitted\./)).toBeVisible();await expect(attendance.getByRole('alert')).toHaveCount(0);expect(errors).toEqual([]);
});
test('attendance screen records an open day, submits, locks and corrects a register',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Attendance');
  const suffix=randomUUID().slice(0,8),today='2026-09-28',name=`Synthetic Attendance Student ${suffix}`,admission=`ATT-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Attendance year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Attendance class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:name,startDate:today,admissionNumber:admission,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const attendance=page.locator('section').filter({has:page.getByRole('heading',{name:'Attendance',exact:true})});
  await attendance.getByLabel('Date',{exact:true}).fill(today);await attendance.getByLabel('School day reason',{exact:true}).fill('Synthetic browser open-day review');await attendance.getByRole('button',{name:'Save school day',exact:true}).click();await expect(attendance.getByRole('status')).toContainText(/School day (saved|updated)\./);
  await attendance.getByLabel('Find a class',{exact:true}).fill(`Attendance class ${suffix}`);await attendance.getByRole('button',{name:'Find class',exact:true}).click();await attendance.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);await expect(attendance.getByText(name,{exact:true})).toBeVisible();await attendance.getByRole('group',{name:`Attendance for ${name}`,exact:true}).getByRole('button',{name:'Present',exact:true}).click();
  await attendance.getByRole('button',{name:'Save draft',exact:true}).click();await expect(attendance.getByRole('status').filter({hasText:'Attendance saved as draft.'})).toBeVisible();await attendance.getByRole('button',{name:'Submit register',exact:true}).click();await expect(attendance.getByText(/Status: submitted\./)).toBeVisible();
  await expect(attendance.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0);await attendance.getByRole('group',{name:`Attendance for ${name}`,exact:true}).getByRole('button',{name:'Absent',exact:true}).click();await attendance.getByLabel('Correction reason',{exact:true}).fill('Synthetic review before locking');await attendance.getByRole('button',{name:'Save correction',exact:true}).click();await expect(attendance.getByRole('status').filter({hasText:'Attendance corrected.'})).toBeVisible();await expect(attendance.getByLabel('School day reason',{exact:true})).toHaveValue('Synthetic browser open-day review');await expect(attendance.getByLabel('Correction reason',{exact:true})).toHaveValue('');
  await attendance.getByRole('button',{name:'Lock register',exact:true}).click();await expect(attendance.getByText(/Status: locked\./)).toBeVisible();await attendance.getByLabel('Correction reason',{exact:true}).fill('Synthetic browser reviewed correction');await attendance.getByRole('group',{name:`Attendance for ${name}`,exact:true}).getByRole('button',{name:'Late',exact:true}).click();await attendance.getByRole('button',{name:'Save correction',exact:true}).click();await expect(attendance.getByRole('status').filter({hasText:'Attendance corrected.'})).toBeVisible();
  await page.reload();await pickSchool(page);await attendance.getByLabel('Find a class',{exact:true}).fill(`Attendance class ${suffix}`);await attendance.getByRole('button',{name:'Find class',exact:true}).click();await attendance.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);await expect(attendance.getByText(/Status: locked\./)).toBeVisible();await expect(attendance.getByRole('group',{name:`Attendance for ${name}`,exact:true}).getByRole('button',{name:'Late',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Nursery report draft passes review, publishes and appears in the parent portal',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Early years');
  const suffix=randomUUID().slice(0,8),today='2026-09-28',learnerName=`Synthetic KG Report Student ${suffix}`,admission=`REP-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Report year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Report Nursery ${suffix}`,level:'Nursery',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:learnerName,startDate:today,admissionNumber:admission,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const candidates=await (await page.request.get(`/api/v1/schools/${school}/guardian-candidates`)).json(),guardianCandidate=candidates.find((item:any)=>item.display_name==='Abena Sample');expect(guardianCandidate).toBeTruthy();
  const link=await post('/guardian-links',{learnerId:application.learner_id,guardianMembershipId:guardianCandidate.id,academic:true,billing:false,pickup:false,contact:false});await post(`/guardian-links/${link.id}/verify`,{version:link.version,reason:'Synthetic academic reporting permission verified'});
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Nursery and KG progress reports'});await expect(panel.getByRole('heading',{name:'Nursery and KG progress reports'})).toBeVisible();
  await panel.getByRole('button',{name:'New report',exact:true}).click();await panel.getByRole('combobox',{name:'Level'}).selectOption('Nursery');await panel.getByRole('button',{name:'Refresh classes',exact:true}).click();await panel.getByRole('combobox',{name:'Class'}).selectOption(section.id);await expect(panel.getByRole('option',{name:new RegExp(learnerName)})).toHaveCount(1);const roster=await (await page.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).json(),reportLearner=roster.items.find((item:any)=>item.full_name===learnerName);expect(reportLearner).toBeTruthy();await panel.getByRole('combobox',{name:'Student'}).selectOption(reportLearner.id);
  await panel.getByLabel('Strengths and progress').fill('Joined a shared activity and took turns with peers.');await panel.getByLabel('Next steps').fill('Continue offering a chance to lead a short group activity.');await panel.getByLabel('Teacher note (optional)').fill('Synthetic note for parent preview.');await panel.getByRole('button',{name:'Save report draft'}).click();
  const report=panel.locator('li').filter({hasText:learnerName});await expect(report).toContainText('draft');await report.getByRole('button',{name:'Submit for review'}).click();await expect(report).toContainText('submitted');await report.getByRole('button',{name:'Approve'}).click();await expect(report).toContainText('approved');await report.getByRole('button',{name:'Publish to parents'}).click();await expect(report).toContainText('published');
  const context=await browser.newContext(),guardianPage=await context.newPage();guardianPage.on('pageerror',error=>errors.push(error.message));await guardianPage.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
  try{await signIn(guardianPage,'guardian@example.test','Report cards');await chooseChild(guardianPage,reportLearner.id);const guardianPanel=guardianPage.getByRole('region',{name:'Nursery and KG progress reports'});const guardianReport=guardianPanel.locator('li').filter({hasText:learnerName});await expect(guardianReport).toContainText('Joined a shared activity and took turns with peers.');await expect(guardianReport).toContainText('Continue offering a chance to lead a short group activity.');expect(errors).toEqual([]);}
  finally{await context.close();}
});
test('connection and proxy failures show a plain-language retry message, not a parser error',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page,'head@example.test','Students');
  await page.route('**/api/v1/schools/*/academic-years*',route=>route.fulfill({status:502,contentType:'text/html',body:'<html><body>Bad gateway</body></html>'}));
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Admissions and students'});
  await expect(panel.getByRole('alert')).toContainText('Wait a moment and try again');
  await page.unroute('**/api/v1/schools/*/academic-years*');
  await page.route('**/api/v1/schools/*/academic-years*',route=>route.abort('connectionrefused'));
  await page.reload();await pickSchool(page);
  await expect(panel.getByRole('alert')).toContainText('Your changes were not saved');
  expect(errors.join(' ')).not.toContain('Unexpected token');
});
test('platform administrator creates a school; its headteacher signs in with the temporary password and must change it',async({page,browser})=>{
  const {Pool}=require('pg');const {randomBytes,scryptSync}=require('node:crypto');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const suffix=randomUUID().slice(0,8),adminEmail=`platform-${suffix}@example.test`,headEmail=`head-${suffix}@example.test`,schoolName=`Real School ${suffix}`,salt=randomBytes(16).toString('hex');
  try {
    const adminId=randomUUID();
    await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[adminId,'Platform Admin',adminEmail,`${salt}:${scryptSync('Platform-admin-2026!',salt,64).toString('hex')}`]);
    await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)',[adminId]);
    await page.goto('/#/signin');await page.getByLabel('Email or phone number',{exact:true}).fill(adminEmail);await page.getByLabel('Password',{exact:true}).fill('Platform-admin-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    const panel=page.getByRole('region',{name:'Platform administration'});await expect(panel).toBeVisible();
    await panel.getByLabel('School name',{exact:true}).fill(schoolName);await panel.getByLabel('Headteacher name',{exact:true}).fill('Efua Mensah');await panel.getByLabel('Headteacher email',{exact:true}).fill(headEmail);
    await panel.getByRole('button',{name:'Create school',exact:true}).click();
    const credentials=panel.getByRole('status');await expect(credentials).toContainText(headEmail);
    const temporary=(await credentials.locator('code').textContent())!.trim();expect(temporary.length).toBeGreaterThanOrEqual(16);
    await expect(panel.locator('li').filter({hasText:schoolName})).toContainText('1 headteacher');
    const context=await browser.newContext(),headPage=await context.newPage();
    try {
      await headPage.goto('/#/signin');await headPage.getByLabel('Email or phone number',{exact:true}).fill(headEmail);await headPage.getByLabel('Password',{exact:true}).fill(temporary);await headPage.getByRole('button',{name:'Sign in',exact:true}).click();
      await expect(headPage.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
      await headPage.getByLabel('Temporary password',{exact:true}).fill(temporary);await headPage.getByLabel('New password',{exact:true}).fill('Brand-new-passphrase-77');await headPage.getByRole('button',{name:'Save new password'}).click();
      await expect(headPage.getByRole('heading',{name:schoolName,exact:true})).toBeVisible();await expect(headPage.getByRole('region',{name:'Platform administration'})).toHaveCount(0);
    } finally {await context.close();}
  } finally {await owner.end();}
});
test('headteacher drafts and approves a notice; the linked parent reads it',async({page,browser})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Notices');
  const suffix=randomUUID().slice(0,8),className=`Notice class ${suffix}`,title=`Trip notice ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Notice year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Notice Student')",[learner,school,`NT-${suffix}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),school,learner,section.id]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,'30000000-0000-4000-8000-000000000004','Abena Sample',true,false,false,true,now(),'30000000-0000-4000-8000-000000000001','Checked in person')",[randomUUID(),school,learner]);
  await owner.end();await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Notices to parents',exact:true});
  await panel.getByRole('button',{name:'New notice',exact:true}).click();await panel.getByLabel('Title',{exact:true}).fill(title);await panel.getByLabel('Message',{exact:true}).fill('Bring a packed lunch on Friday.');
  const selects=panel.locator('form select');await selects.nth(0).selectOption('class');await selects.nth(1).selectOption(section.id);
  await panel.getByRole('button',{name:'Save draft',exact:true}).click();await expect(panel.getByText('Saved as a draft. Nothing is sent until you approve it.')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await panel.locator('li').filter({hasText:title}).getByRole('button',{name:'Approve and send',exact:true}).click();
  await expect(panel.getByText('Approved for 1 parent; 0 will also get an SMS.')).toBeVisible();
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const guardianPage=await browser.newPage();await guardianPage.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));await signIn(guardianPage,'guardian@example.test','Notices');
  const mine=guardianPage.getByRole('region',{name:'Notices from the school',exact:true});await expect(mine.getByText(title)).toBeVisible();await expect(mine.getByText('Bring a packed lunch on Friday.')).toBeVisible();
  await guardianPage.close();expect(errors).toEqual([]);
});
test('an Excel-style class list with "Admission No." headers and DD/MM/YYYY dates stages once the date order is chosen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Students');
  const suffix=randomUUID().slice(0,8),className=`Excel class ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Excel year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'});await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  await page.getByRole('button',{name:'Import existing students',exact:true}).click();
  await page.getByLabel('Search import classes',{exact:true}).fill(className);await page.getByRole('button',{name:'Search classes',exact:true}).first().click();
  await page.getByRole('combobox',{name:'Target class',exact:true}).selectOption({index:1});
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:`excel-${suffix}.csv`,mimeType:'text/csv',buffer:Buffer.from(`Student Name,Gender,Admission No.,DOB\r\n"Mensah, Ama ${suffix}",F,EX-${suffix},03/04/2015\r\n`)});
  const stage=page.getByRole('button',{name:'Stage CSV for validation',exact:true});await expect(stage).toBeDisabled();
  const format=page.getByRole('combobox',{name:/How are dates written/});await expect(format).toBeVisible();await expect(format.locator('option',{hasText:'3 April 2015'})).toHaveCount(1);await expect(format.locator('option',{hasText:'4 March 2015'})).toHaveCount(1);
  await format.selectOption('dmy');await expect(stage).toBeEnabled();await stage.click();
  await expect(page.getByText(new RegExp(`EX-${suffix} · Born 2015-04-03`))).toBeVisible();expect(errors).toEqual([]);
});
test('each role lands on its own daily work; the section stays in the address across reload at phone width',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:375,height:812});
  const links=async(p:Page)=>p.getByRole('navigation',{name:'Sections',exact:true}).locator('a .label').allTextContents();
  await signIn(page);expect(await links(page)).toEqual(['Home','Kobby AI','Students','Parents','Teachers','Staff','Classes','Attendance','Pickup','Curriculum','Assessment','Performance','Early years','Accounts','Notices','Settings']);
  await expect(page.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('region',{name:'Notices to parents'})).toHaveCount(0);
  await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('link',{name:'Notices',exact:true}).click();await expect(page.getByRole('region',{name:'Notices to parents'})).toBeVisible();
  await page.reload();await pickSchool(page);await expect(page.getByRole('region',{name:'Notices to parents'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const [email,expected] of [['teacher@example.test',['Today','Kobby AI','Classes','Curriculum','Assessment','Performance','Early years']],['frontdesk@example.test',['Pickup','Students']],['guardian@example.test',['Home','Learn at home','Performance','Report cards','Notes','Fees','Notices']]] as const){
    const other=await browser.newPage();await other.setViewportSize({width:375,height:812});await other.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));await signIn(other,email);expect(await links(other)).toEqual(expected);
    expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await other.close();
  }
  expect(errors).toEqual([]);
});
test('a new sign-up sees a setup guide instead of empty daily screens, and daily work appears once a class exists',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:375,height:812});
  const suffix=randomUUID().slice(0,8),schoolName=`Signup School ${suffix}`;
  await page.goto('/#/signin');await page.getByRole('button',{name:'Create an account',exact:true}).click();
  await page.getByLabel('Your full name',{exact:true}).fill('Esi Owusu');await page.getByLabel('School name',{exact:true}).fill(schoolName);await page.getByLabel('Email',{exact:true}).fill(`signup-${suffix}@example.test`);await page.getByLabel('Password (at least 12 characters)',{exact:true}).fill('Signup-passphrase-2026');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  const guide=page.getByRole('region',{name:`Let's get ${schoolName} ready`});await expect(guide).toBeVisible();await expect(guide).toContainText('0 of 5 done');
  await expect(page.getByRole('combobox',{name:'School',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Needs attention'})).toHaveCount(0);
  await guide.getByLabel('Year name',{exact:true}).fill('2026/2027');await guide.getByLabel('First day of the year',{exact:true}).fill('2026-09-01');await guide.getByLabel('Day after the last day',{exact:true}).fill('2027-08-01');
  await guide.getByRole('button',{name:'Save academic year',exact:true}).click();await expect(guide).toContainText('1 of 5 done');
  await guide.getByLabel('Class name',{exact:true}).fill('Primary 1');await guide.getByRole('button',{name:'Add class',exact:true}).click();
  await expect(guide.getByRole('status')).toContainText('Added: Primary 1');await expect(guide).toContainText('2 of 5 done');
  await expect(guide.getByRole('link',{name:'Add teachers'})).toBeVisible();await expect(page.getByRole('heading',{name:'Needs attention'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('class teacher remarks and the headteacher remark appear on the printed report card with attendance and reopening date',async({page})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Assessment');
  const suffix=randomUUID().slice(0,8),name=`Report Student ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function send(route:string,body:Record<string,unknown>,method='post',status=201){const response=await page.request[method as 'post'](`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(status);return response.json();}
  const year=await send('/academic-years',{name:`Report year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await send('/classes',{name:`Report class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  const term=await send('/assessment/terms',{academicYearId:year.id,name:`Term ${suffix}`,startDate:'2026-09-01',endDate:'2026-12-15'});await send('/assessment/terms',{academicYearId:year.id,name:`Next ${suffix}`,startDate:'2027-01-05',endDate:'2027-04-01'});
  const subject=await send('/assessment/subjects',{name:`Maths ${suffix}`});
  const policy=(await (await page.request.get(`/api/v1/schools/${school}/assessment/policy`)).json()).policy;
  if(!policy)await send('/assessment/policy',{caWeight:30,examWeight:70,bands:[{min:50,grade:'1',remark:'Pass'},{min:0,grade:'9',remark:'Lowest'}],sourceNote:'Synthetic policy'},'put',200);
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`RP-${suffix}`,name]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),school,learner,section.id]);await owner.end();
  await send('/attendance/school-days',{day:'2026-09-25',isOpen:true,reason:'Normal day'}).catch(()=>undefined);
  const register=await (await page.request.get(`/api/v1/schools/${school}/attendance/classes/${section.id}/register?day=2026-09-25`)).json();
  const draft=await send(`/attendance/classes/${section.id}/register`,{day:'2026-09-25',version:register.version,action:'save',marks:[{learnerId:learner,mark:'present'}]});
  await send(`/attendance/classes/${section.id}/register`,{day:'2026-09-25',version:draft.version,action:'submit',marks:[{learnerId:learner,mark:'present'}]});
  await send(`/assessment/classes/${section.id}/scores`,{termId:term.id,subjectId:subject.id,scores:[{learnerId:learner,kind:'ca',score:70},{learnerId:learner,kind:'exam',score:80}]});
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Assessment and terminal reports',exact:true});
  await panel.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);await panel.getByRole('combobox',{name:'Term',exact:true}).selectOption(term.id);
  await panel.getByRole('tab',{name:'Remarks',exact:true}).click();await panel.getByLabel(`${name} Conduct`,{exact:true}).fill('Very good');await panel.getByLabel(`${name} Class teacher's remark`,{exact:true}).fill('A careful worker.');
  await panel.getByLabel(`${name} Headteacher's remark`,{exact:true}).fill('Well done.');
  await panel.getByRole('button',{name:'Save remarks',exact:true}).click();await expect(panel.getByText('Report card remarks saved.')).toBeVisible();
  await send(`/assessment/classes/${section.id}/publish`,{termId:term.id});
  await panel.getByRole('tab',{name:'Report cards',exact:true}).click();await panel.getByRole('button',{name:'Report cards',exact:true}).click();
  const card=page.getByRole('dialog',{name:'Report cards',exact:true}).locator('article.report-card');
  await expect(card.getByText(name)).toBeVisible();await expect(card.getByText('1 out of 1')).toBeVisible();await expect(card.getByText('A careful worker.')).toBeVisible();
  await expect(card.getByText('Well done.')).toBeVisible();await expect(card.getByText('Next term begins',{exact:true})).toBeVisible();await expect(card.getByText('1st of 1')).toBeVisible();
  // The same cards for a whole level, one per printed page; a level with nothing published says so.
  await page.getByRole('dialog',{name:'Report cards',exact:true}).getByRole('button',{name:'Close'}).click();
  await panel.getByRole('combobox',{name:'Report cards for',exact:true}).selectOption('JHS');await panel.getByRole('button',{name:'Print report cards',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('No terminal reports have been published for JHS this term yet.');
  await panel.getByRole('combobox',{name:'Report cards for',exact:true}).selectOption('Primary');await panel.getByRole('button',{name:'Print report cards',exact:true}).click();
  const levelCards=page.getByRole('dialog',{name:'Report cards',exact:true}).locator('article.report-card');await expect(levelCards).toHaveCount(1);await expect(levelCards.getByText(name)).toBeVisible();
  await page.emulateMedia({media:'print'});expect(await page.locator('.report-sheet article.report-card').first().evaluate(el=>getComputedStyle(el).breakAfter)).toBe('page');await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('CA cannot be typed: class work recorded on the Assessment page makes the CA, the exam is entered beside it, and Performance shows the term result',async({page})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Assessment');
  const suffix=randomUUID().slice(0,8),name=`CA Student ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function send(route:string,body:Record<string,unknown>,method='post',status=201){const response=await page.request[method as 'post'](`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(status);return response.json();}
  const year=await send('/academic-years',{name:`CA year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await send('/classes',{name:`CA class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  const term=await send('/assessment/terms',{academicYearId:year.id,name:`CA term ${suffix}`,startDate:'2026-09-01',endDate:'2026-12-15'});
  const subject=await send('/assessment/subjects',{name:`Science ${suffix}`});
  let policy=(await (await page.request.get(`/api/v1/schools/${school}/assessment/policy`)).json()).policy;
  if(!policy){await send('/assessment/policy',{caWeight:30,examWeight:70,bands:[{min:50,grade:'1',remark:'Pass'},{min:0,grade:'9',remark:'Lowest'}],sourceNote:'Synthetic policy'},'put',200);policy=(await (await page.request.get(`/api/v1/schools/${school}/assessment/policy`)).json()).policy;}
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`CA-${suffix}`,name]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),school,learner,section.id]);await owner.end();
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Assessment and terminal reports',exact:true});
  await panel.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);await panel.getByRole('combobox',{name:'Term',exact:true}).selectOption(term.id);
  // Class work is recorded here, on its own tab: a class exercise marked 15 out of 20.
  await expect(panel.getByRole('tab',{name:'Class work',exact:true})).toHaveAttribute('aria-selected','true');
  await panel.getByRole('button',{name:'Add class work',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add class work',exact:true});
  await add.getByRole('combobox',{name:'Subject',exact:true}).selectOption(subject.id);await add.getByLabel('Title',{exact:true}).fill('Plants exercise');await add.getByLabel('Date',{exact:true}).fill('2026-09-21');
  await add.getByRole('button',{name:'Add and enter marks',exact:true}).click();
  const marks=page.getByRole('dialog',{name:'Plants exercise · out of 20',exact:true});await marks.getByLabel(`${name} mark`,{exact:true}).fill('15');
  await marks.getByRole('button',{name:'Save marks',exact:true}).click();await expect(panel.getByText('Saved 1 mark(s) for Plants exercise.')).toBeVisible();
  // The exam tab shows the CA from class work and offers no box to type it.
  await panel.getByRole('tab',{name:'Exam scores',exact:true}).click();await panel.getByRole('combobox',{name:'Subject',exact:true}).selectOption(subject.id);
  const row=panel.getByRole('row').filter({hasText:name});await expect(row.getByText('75',{exact:true})).toBeVisible();
  await expect(panel.getByLabel(/continuous assessment/)).toHaveCount(0);
  await row.getByLabel(`${name} exam`,{exact:true}).fill('60');await panel.getByRole('button',{name:'Save exam scores',exact:true}).click();
  await expect(panel.getByText(/Saved 1 exam mark\(s\) and the CA from class work for 1 student\(s\)/)).toBeVisible();
  const grid=await (await page.request.get(`/api/v1/schools/${school}/assessment/classes/${section.id}/grid?termId=${term.id}&subjectId=${subject.id}`)).json();
  expect(grid.items[0]).toMatchObject({ca:75,exam:60});
  // Performance only shows results: the term result with the CA and exam weighted by the school's policy.
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Performance',exact:true}).click();
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);await page.getByRole('combobox',{name:'Term',exact:true}).selectOption(term.id);
  const total=Math.round(75*policy.ca_weight+60*policy.exam_weight)/100;
  const result=page.getByRole('row').filter({has:page.getByRole('link',{name})});await expect(result.getByText(String(total),{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:/New assessment|Add class work/})).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('a teacher adds curriculum topics from the sidebar and retires their own, but not the headteacher\'s',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Curriculum');
  const suffix=randomUUID().slice(0,8),session=await (await page.request.get('/api/v1/auth/session')).json();
  const subject=(await (await page.request.post(`/api/v1/schools/${school}/assessment/subjects`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),name:`Topics ${suffix}`}})).json());
  const headTopic=await page.request.post(`/api/v1/schools/${school}/assessment/indicators`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),subjectId:subject.id,origin:'local',sourceNote:'Head scheme of work',items:[{description:`Head topic ${suffix}`}]}});expect(headTopic.status()).toBe(201);
  const context=await browser.newContext(),teacher=await context.newPage();teacher.on('pageerror',error=>errors.push(error.message));
  await signIn(teacher,'teacher@example.test','Curriculum');
  await teacher.getByRole('combobox',{name:'Subject',exact:true}).selectOption(subject.id);
  await teacher.getByRole('button',{name:'Add indicators',exact:true}).click();
  const add=teacher.getByRole('dialog');await add.getByLabel('Source',{exact:true}).fill('Class 4 scheme of work');await add.getByLabel(/^Indicators, one per line/).fill(`Teacher topic ${suffix}`);
  await add.getByRole('button',{name:/Add 1 indicator/}).click();await expect(teacher.getByText('Added 1 indicator(s).')).toBeVisible();
  const mine=teacher.getByRole('row').filter({hasText:`Teacher topic ${suffix}`}),theirs=teacher.getByRole('row').filter({hasText:`Head topic ${suffix}`});
  await expect(mine.getByRole('button',{name:'Retire',exact:true})).toBeVisible();await expect(theirs.getByRole('button',{name:'Practice',exact:true})).toBeVisible();await expect(theirs.getByRole('button',{name:'Retire',exact:true})).toHaveCount(0);
  await context.close();expect(errors).toEqual([]);
});
test('the headteacher’s morning view lists missing registers, this week’s fees against last term and missing scores, each linking to its page',async({page})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:375,height:812});
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Yaw Morning',schoolName:`Morning School ${suffix}`,email:`morning-${suffix}@example.test`,password:'Morning-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  // The API dates the view by the server's Ghana date, so the data is placed around that day.
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const head=(await owner.query("SELECT id FROM memberships WHERE school_id=$1 AND role='headteacher'",[sid])).rows[0].id;
  const [year,term,last,section,learner,subject,invoice,old]=Array.from({length:8},()=>randomUUID());
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Morning year',$3,$4)",[year,sid,shift(-300),shift(60)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 2',$4,$5),($6,$2,$3,'Term 1',$7,$8)",[term,sid,year,shift(-30),shift(10),last,shift(-150),shift(-60)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 4','Primary',30)",[section,sid,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'MV-1','Kwesi Morning')",[learner,sid]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),sid,learner,section,shift(-200)]);
  await owner.query("INSERT INTO school_days(id,school_id,day,is_open,reason,created_by) VALUES($1,$2,$3,true,'Morning view open day',$4)",[randomUUID(),sid,today,head]);
  await owner.query("INSERT INTO subjects(id,school_id,name) VALUES($1,$2,'Science')",[subject,sid]);
  await owner.query("INSERT INTO assessment_score_entries(id,school_id,term_id,class_id,subject_id,learner_id,kind,score,recorded_by) VALUES($1,$2,$3,$4,$5,$6,'ca',55,$7)",[randomUUID(),sid,term,section,subject,learner,head]);
  await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amount_pesewas":90000}]',90000,$6),($7,$2,$3,$8,$5,'[{"name":"Tuition","amount_pesewas":90000}]',90000,$6)`,[invoice,sid,learner,term,section,head,old,last]);
  await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,12000,'cash',$4,1,$5),($6,$2,$7,45000,'cash',$8,2,$5)",[randomUUID(),sid,invoice,today,head,randomUUID(),old,shift(-120)]);
  await owner.end();
  await page.reload();
  const card=page.locator('.card').filter({has:page.getByRole('heading',{name:'Needs attention',exact:true})});
  const item=(text:string)=>card.getByRole('listitem').filter({hasText:text});
  await expect(item('1 class has no register today')).toContainText('Basic 4');await expect(item('1 class has no register today').getByRole('link',{name:'Open registers'})).toHaveAttribute('href','#/attendance');
  await expect(item('GH₵ 120.00 in fees collected this week')).toContainText('GH₵ 450.00 in the same week of Term 1');await expect(item('in fees collected this week').getByRole('link',{name:'Open accounts'})).toHaveAttribute('href','#/accounts');
  await expect(item('1 class is missing scores')).toContainText('Term 2 ends in 10 days: Basic 4 (Science)');await expect(item('missing scores').getByRole('link',{name:'Open scores'})).toHaveAttribute('href','#/assessment');
  await page.getByRole('tab',{name:'Registers and absences'}).click();await expect(page.getByText('No student has been absent 3 or more days this week.')).toBeVisible();await page.getByRole('tab',{name:'Overview'}).click();
  await item('missing scores').getByRole('link',{name:'Open scores'}).click();await expect(page).toHaveURL(/#\/assessment$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('the headteacher selects several bills and records one discount on each, with its reason',async({page})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Ama Bulk',schoolName:`Bulk School ${suffix}`,email:`bulk-${suffix}@example.test`,password:'Bulk-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const head=(await owner.query("SELECT id FROM memberships WHERE school_id=$1 AND role='headteacher'",[sid])).rows[0].id;
  const [year,term,section]=[randomUUID(),randomUUID(),randomUUID()];
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'2026/27','2026-09-01','2027-08-01')",[year,sid]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1','2026-09-08','2026-12-18')",[term,sid,year]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 5','Primary',30)",[section,sid,year]);
  for(const name of ['Adwoa Staffward','Kojo Staffward','Yaa Fullfee']){const learner=randomUUID();
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,sid,`BK-${learner.slice(0,6)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),sid,learner,section]);
    await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amount_pesewas":60000}]',60000,$6)`,[randomUUID(),sid,learner,term,section,head]);}
  await page.reload();await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Accounts',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Adwoa Staffward'}).check();await page.getByRole('checkbox',{name:'Select Kojo Staffward'}).check();
  await page.getByRole('button',{name:'Adjust 2 selected'}).click();
  const dialog=page.getByRole('dialog',{name:'Adjust 2 bills'});await expect(dialog).toContainText('Adwoa Staffward, Kojo Staffward');
  await dialog.getByLabel('Label on the bill').fill('Staff ward');await dialog.getByLabel('Amount (GH₵)').fill('150');await dialog.getByLabel('Reason').fill('Staff ward policy, board minute 4/2026');
  await expect(dialog).toContainText('GH₵ 300.00 in all');await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Discount of GH₵ 150.00 recorded on 2 bills');
  for(const name of ['Adwoa Staffward','Kojo Staffward'])await expect(page.getByRole('row').filter({hasText:name})).toContainText('−GH₵ 150.00 Staff ward');
  await expect(page.getByRole('row').filter({hasText:'Yaa Fullfee'})).not.toContainText('Staff ward');
  const reasons=(await owner.query("SELECT a.reason FROM invoice_adjustments a WHERE a.school_id=$1",[sid])).rows.map((r:any)=>r.reason);await owner.end();
  expect(reasons).toEqual(['Staff ward policy, board minute 4/2026','Staff ward policy, board minute 4/2026']);
  await expect(page.getByRole('button',{name:/selected$/})).toHaveCount(0);expect(errors).toEqual([]);
});
test('the headteacher previews student corrections from a CSV, applies them with a reason, and the student keeps the old values in history',async({page})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Kofi Update',schoolName:`Update School ${suffix}`,email:`update-${suffix}@example.test`,password:'Update-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const [year,section,learner]=[randomUUID(),randomUUID(),randomUUID()];
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'2026/27','2026-09-01','2027-08-01')",[year,sid]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 6','Primary',30)",[section,sid,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'UPD-1','Abena Mensa')",[learner,sid]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),sid,learner,section]);await owner.end();
  await page.reload();await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Students',exact:true}).click();
  await page.getByRole('button',{name:'Update from CSV',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Correct student records from a CSV'});
  await dialog.getByLabel('Or paste the rows').fill('Admission No.,Full Name,Date of Birth,Sex\nUPD-1,Abena Mensah,14/02/2015,F\n');
  await dialog.getByRole('button',{name:'Preview changes',exact:true}).click();
  await expect(dialog.getByRole('row').filter({hasText:'Date of birth'})).toContainText('2015-02-14');await expect(dialog.getByRole('row').filter({hasText:'Will be'})).toBeVisible();
  await expect(dialog.getByRole('row').filter({hasText:/^Abena Mensa.*Name/})).toContainText('Abena Mensah');
  await dialog.getByLabel('Reason for these corrections').fill('Checked against the birth certificate');
  await dialog.getByRole('button',{name:'Apply 3 correction(s)',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Applied 3 correction(s) to 1 student(s)');
  await dialog.getByRole('button',{name:'Close'}).click();
  await page.getByRole('button',{name:'Abena Mensah',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'Abena Mensah'});
  await expect(drawer).toContainText('Name: Abena Mensa → Abena Mensah');await expect(drawer).toContainText('Date of birth: not recorded → 2015-02-14');await expect(drawer).toContainText('Checked against the birth certificate');
  expect(errors).toEqual([]);
});
test('Kobby AI keeps each conversation in a list on the left, survives leaving the page and a reload, keeps follow-up context per chat, deletes on request and is gone after signing out',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const sent:string[][]=[];
  await page.route('**/assistant/chat',async route=>{
    const messages=(route.request().postDataJSON() as {messages:{text:string}[]}).messages.map(m=>m.text);sent.push(messages);
    if(messages.at(-1)?.includes('slowly'))await new Promise(done=>setTimeout(done,1500));
    await route.fulfill({json:{runId:randomUUID(),reply:`Answer ${sent.length}: Basic 6 is doing well.`,people:{},tools:['school_overview']}});
  });
  const sections=page.getByRole('navigation',{name:'Sections',exact:true}),history=page.getByRole('navigation',{name:'Chat history',exact:true}),question=page.getByLabel('Your question',{exact:true}),savedChats=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ask:')));
  await signIn(page,'head@example.test','Kobby AI');
  await expect(page.getByText('Your chats will appear here.')).toBeVisible();
  await question.fill('How is Basic 6 doing?');await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.getByText('Answer 1: Basic 6 is doing well.')).toBeVisible();
  await expect(history.getByRole('button',{name:'How is Basic 6 doing?',exact:true})).toHaveAttribute('aria-current','true');
  // Leave the page with an unsent draft, then come back.
  await question.fill('a half-written question');
  await sections.getByRole('link',{name:'Home',exact:true}).click();await expect(page.getByRole('heading',{name:'Kobby AI',exact:true})).toHaveCount(0);
  await sections.getByRole('link',{name:'Kobby AI',exact:true}).click();
  await expect(page.getByText('How is Basic 6 doing?',{exact:true}).first()).toBeVisible();await expect(page.getByText('Answer 1: Basic 6 is doing well.')).toBeVisible();await expect(question).toHaveValue('a half-written question');
  // A reload keeps it too, and a follow-up carries the earlier turns.
  await page.reload();await pickSchool(page);
  await expect(page.getByText('Answer 1: Basic 6 is doing well.')).toBeVisible();
  await question.fill('What can we do about it?');await question.press('Enter');
  await expect(page.getByText('Answer 2: Basic 6 is doing well.')).toBeVisible();
  expect(sent[1]).toEqual(['How is Basic 6 doing?','Answer 1: Basic 6 is doing well.','What can we do about it?']);
  // An answer that arrives after the person has gone elsewhere is still saved.
  await question.fill('Answer slowly please');await question.press('Enter');
  await sections.getByRole('link',{name:'Home',exact:true}).click();await page.waitForTimeout(2000);
  await sections.getByRole('link',{name:'Kobby AI',exact:true}).click();
  await expect(page.getByText('Answer 3: Basic 6 is doing well.')).toBeVisible();
  expect(await savedChats()).toHaveLength(1);
  // A new chat starts empty, joins the list, and does not carry the first chat's turns.
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  await expect(page.getByText('Answer 1: Basic 6 is doing well.')).toHaveCount(0);await expect(page.getByRole('button',{name:'How is Basic 6 performing this term?',exact:true})).toBeVisible();
  await question.fill('Who was absent most last week?');await question.press('Enter');await expect(page.getByText('Answer 4: Basic 6 is doing well.')).toBeVisible();
  expect(sent[3]).toEqual(['Who was absent most last week?']);
  await expect(history.getByRole('button')).toHaveCount(4);await expect(history.getByRole('listitem')).toHaveCount(2);
  // Any chat in the list can be opened again, and a follow-up there carries only that chat's turns.
  await history.getByRole('button',{name:'How is Basic 6 doing?',exact:true}).click();
  await expect(page.getByText('Answer 3: Basic 6 is doing well.')).toBeVisible();await expect(page.getByText('Answer 4: Basic 6 is doing well.')).toHaveCount(0);
  await question.fill('And the week before?');await question.press('Enter');await expect(page.getByText('Answer 5: Basic 6 is doing well.')).toBeVisible();
  expect(sent[4]!.slice(-2)).toEqual(['Answer 3: Basic 6 is doing well.','And the week before?']);expect(sent[4]!.join(' ')).not.toContain('absent most');
  // Search narrows the list.
  await page.getByLabel('Search your chats',{exact:true}).fill('absent');await expect(history.getByRole('listitem')).toHaveCount(1);await page.getByLabel('Search your chats',{exact:true}).fill('');
  // Deleting asks first, removes only that chat, and the other stays open.
  await history.getByRole('button',{name:'Delete chat: Who was absent most last week?',exact:true}).click({force:true});
  await history.getByRole('button',{name:'Keep',exact:true}).click();await expect(history.getByRole('listitem')).toHaveCount(2);
  await history.getByRole('button',{name:'Delete chat: Who was absent most last week?',exact:true}).click({force:true});
  await history.getByRole('button',{name:'Delete',exact:true}).click();await expect(history.getByRole('listitem')).toHaveCount(1);await expect(page.getByText('Answer 5: Basic 6 is doing well.')).toBeVisible();
  expect(await savedChats()).toHaveLength(1);
  // Signing out deletes whatever is saved; signing in again starts clean.
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect(await savedChats()).toHaveLength(0);
  await signIn(page,'head@example.test','Kobby AI');
  await expect(page.getByText(/^Answer \d/)).toHaveCount(0);await expect(page.getByRole('button',{name:'How is Basic 6 performing this term?',exact:true})).toBeVisible();await expect(page.getByText('Your chats will appear here.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a parent practises approved questions with their child on a phone, the child moves up a level, and switching home practice off hides it',async({page,browser})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test');
  const suffix=randomUUID().slice(0,8),name=`Practice Student ${suffix}`,topic=`Fractions ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  // The server uses the real date, while the browser clock is fixed for the other tests, so dates here come from the real clock.
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*86400000).toISOString().slice(0,10);
  async function send(method:'POST'|'PUT',route:string,body:Record<string,unknown>,status=201){const response=await page.request.fetch(`/api/v1/schools/${school}${route}`,{method,headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(status);return response.json();}
  const year=await send('POST','/academic-years',{name:`Practice year ${suffix}`,startDate:shift(-60),endDate:shift(120)}),section=await send('POST','/classes',{name:`Practice class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  const kg=await send('POST','/classes',{name:`Practice KG ${suffix}`,level:'KG',capacity:5,academicYearId:year.id});
  const subject=await send('POST','/assessment/subjects',{name:`Maths ${suffix}`}),term=await send('POST','/assessment/terms',{academicYearId:year.id,name:`Term ${suffix}`,startDate:shift(-55),endDate:shift(30)});
  await send('POST','/assessment/indicators',{subjectId:subject.id,origin:'local',sourceNote:'Synthetic scheme of work',items:[{description:topic}]});
  const indicator=(await (await page.request.get(`/api/v1/schools/${school}/assessment/indicators?subjectId=${subject.id}`)).json()).items[0].id;
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`PR-${suffix}`,name]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,section.id,shift(-50)]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,'30000000-0000-4000-8000-000000000004','Abena Sample',true,false,false,true,now(),'30000000-0000-4000-8000-000000000001','Synthetic access')",[randomUUID(),school,learner]);
  await owner.end();
  const quiz=await send('POST',`/assessment/classes/${section.id}/assessments`,{termId:term.id,subjectId:subject.id,kind:'quiz',title:`Quiz ${suffix}`,heldOn:shift(-5),maxMark:10,indicatorIds:[indicator]});
  await send('POST',`/assessment/classes/${section.id}/assessments/${quiz.id}/marks`,{marks:[{learnerId:learner,mark:2}]});
  // Three levels of six questions: the first option is right in a multiple-choice question; a number question's answer is in its wording.
  const choice=(level:number,n:number)=>({level,kind:'choice',prompt:`Level ${level} choice ${n}: what is ${n} + ${level}?`,options:[String(n+level),String(n+level+1),String(n+level+2)],correctOption:0,explanation:`${n} plus ${level} is ${n+level}.`});
  const number=(level:number,n:number)=>({level,kind:'number',prompt:`Level ${level} number ${n}: a pencil costs GH₵${n}. What do ${level+1} pencils cost in cedis?`,answer:n*(level+1),explanation:`${level+1} times ${n}.`});
  await send('POST',`/assessment/indicators/${indicator}/questions`,{questions:[1,2,3].flatMap(level=>[...[1,2,3,4].map(n=>choice(level,n)),...[5,6].map(n=>number(level,n))])});
  const setting=await (await page.request.get(`/api/v1/schools/${school}/practice/settings`)).json();
  expect(setting.enabled).toBe(false);
  await send('PUT','/practice/settings',{enabled:true,...(setting.version?{version:setting.version}:{})},200);

  const family=await browser.newPage();await family.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));const familyErrors:string[]=[];family.on('pageerror',error=>familyErrors.push(error.message));
  await signIn(family,'guardian@example.test','Learn at home');await family.setViewportSize({width:375,height:812});
  const picker=family.getByRole('combobox',{name:'Linked child',exact:true});await chooseChild(family,learner);
  const card=family.getByRole('region',{name:'Practice at home',exact:true});
  await expect(card.getByText(topic)).toBeVisible();await expect(card.getByText('Level 1 of 3')).toBeVisible();
  expect(await family.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(card.getByText(/\d+%/)).toHaveCount(0);
  await card.getByRole('button',{name:'Start practice',exact:true}).click();
  const dialog=family.getByRole('dialog');await expect(dialog.getByText('Question 1 of 5')).toBeVisible();
  for(let i=0;i<5;i++){
    const prompt=await dialog.locator('.practice-prompt').innerText();
    if(await dialog.getByRole('group',{name:'Choose an answer'}).count())await dialog.getByRole('group',{name:'Choose an answer'}).getByRole('button').first().click();
    else await dialog.getByLabel('Type your answer (a number)').fill(String(Number(/GH₵(\d+)/.exec(prompt)![1])*Number(/do (\d+) pencils/.exec(prompt)![1])));
    await dialog.getByRole('button',{name:'Check answer',exact:true}).click();await expect(dialog.getByText('Correct!')).toBeVisible();
    if(i<4)await dialog.getByRole('button',{name:'Next question',exact:true}).click();
  }
  await expect(dialog.getByText('5 of 5 correct')).toBeVisible();await expect(dialog.getByText(/moves up to Level 2/)).toBeVisible();
  expect(await family.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Finish',exact:true}).click();
  await expect(card.getByText('Level 2 of 3')).toBeVisible();await expect(card.getByText(/last practised today/)).toBeVisible();

  // The headteacher sees the same practice as evidence: on the learner page and in the class view.
  await page.goto(`/#/learner/${learner}`);await pickSchool(page);await page.getByRole('tab',{name:'Notes & practice',exact:true}).click();
  const evidence=page.locator('.card').filter({hasText:'Home practice'}).filter({hasText:topic});
  await expect(evidence.getByText('Level 2 of 3')).toBeVisible();await expect(evidence.getByText(/Level 1: 5 of 5 right, moved up to Level 2/)).toBeVisible();
  await page.goto('/#/progress');await pickSchool(page);
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption({label:`Practice class ${suffix} · Practice year ${suffix}`});
  await page.getByRole('tab',{name:'Home practice',exact:true}).click();
  const row=page.getByRole('row').filter({has:page.getByRole('link',{name})});await expect(row.getByText(topic)).toBeVisible();await expect(row.getByText('Level 2 of 3')).toBeVisible();
  await expect(page.getByText('1 of 1').first()).toBeVisible();
  // Nursery and KG children are not offered home practice, and the tab says so instead of listing them as "Not yet".
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption({label:`${kg.name} · Practice year ${suffix}`});
  await page.getByRole('tab',{name:'Home practice',exact:true}).click();
  await expect(page.getByText('Home practice is for Primary and JHS')).toBeVisible();await expect(page.getByText('Practising this week')).toHaveCount(0);

  // Switching the school's setting off takes practice away from families.
  const on=await (await page.request.get(`/api/v1/schools/${school}/practice/settings`)).json();
  await send('PUT','/practice/settings',{enabled:false,version:on.version},200);
  await family.reload();await pickSchool(family);await chooseChild(family,learner);
  await expect(family.getByText('Practice at home is not switched on')).toBeVisible();
  await expect(family.getByRole('region',{name:'Practice at home',exact:true})).toHaveCount(0);
  await family.getByRole('button',{name:'Menu',exact:true}).click();await family.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Notes',exact:true}).click();
  await expect(family.getByText('Notes with the school').first()).toBeVisible();
  // The child chosen on one page stays chosen on the next.
  if(await picker.count())await expect(picker).toHaveValue(learner);
  await family.close();expect(errors).toEqual([]);expect(familyErrors).toEqual([]);
});
test('Early years and Accounts say they are loading, not "No reports yet" or "No terms yet", while the answer is on its way',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const slow=async(route:any)=>{await new Promise(resolve=>setTimeout(resolve,1500));await route.continue();};
  await page.route('**/early-years/reports?**',slow);await page.route('**/finance/terms**',slow);
  await signIn(page,'head@example.test','Early years');await page.getByRole('tab',{name:'Progress reports',exact:true}).click();
  await expect(page.getByText('Loading reports…')).toBeVisible();await expect(page.getByText('No reports yet')).toHaveCount(0);
  await expect(page.getByText('Loading reports…')).toHaveCount(0,{timeout:20000});
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Accounts',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Loading'}).first()).toBeVisible();await expect(page.getByText('No terms yet')).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'Loading'})).toHaveCount(0,{timeout:20000});expect(errors).toEqual([]);
});
test('each page names itself in the browser tab, and a parent reads dates as "8 Sept 2025", not 2025-09-08',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page,'head@example.test','Accounts');
  await expect(page).toHaveTitle('Accounts · Adinkra Synthetic School');
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Students',exact:true}).click();
  await expect(page).toHaveTitle('Students · Adinkra Synthetic School');
  await page.goto('/#/settings/sharing');await expect(page).toHaveTitle('Settings · Family sharing & home practice · Adinkra Synthetic School');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveTitle('Sign in · Veloxa SmartSchool');
  await signIn(page,'guardian@example.test');
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await expect(page).toHaveTitle('Home · Adinkra Synthetic School');
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Report cards',exact:true}).click();
  await expect(page).toHaveTitle('Report cards · Adinkra Synthetic School');
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  const history=page.locator('.history li').first();await expect(history).toBeVisible();
  const text=(await history.innerText());expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);expect(text).not.toContain('exclusive');expect(text).toMatch(/\d{1,2} \w{3,4} \d{4}/);
  expect(errors).toEqual([]);
});

test('long lists are split into pages: teacher accounts with search and a Manage dialog, promotion under Students',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page,'head@example.test','Teachers');
  const suffix=randomUUID().slice(0,8),login=`teacher-${suffix}@example.test`,accounts=page.getByRole('region',{name:'Teacher accounts',exact:true});
  await accounts.getByRole('button',{name:'Add a teacher',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add a teacher',exact:true});await add.getByLabel('Full name',{exact:true}).fill(`Layout Teacher ${suffix}`);await add.getByLabel('Email or mobile number',{exact:true}).fill(login);await add.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Temporary password'})).toBeVisible();
  await accounts.getByLabel('Search accounts',{exact:true}).fill(suffix);await accounts.getByRole('button',{name:'Search',exact:true}).click();
  const row=accounts.getByRole('row').filter({hasText:`Layout Teacher ${suffix}`});await expect(row).toHaveCount(1);
  await row.getByRole('button',{name:/^Manage /}).click();const manage=page.getByRole('dialog',{name:`Manage Layout Teacher ${suffix}`,exact:true});
  await manage.getByRole('button',{name:'Remove access',exact:true}).click();await manage.getByRole('button',{name:'Yes, remove access',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'can no longer sign in to this school'})).toBeVisible();await expect(row).toContainText('Access removed');
  // The year-end promotion is a tab on Learners, and the old address still opens it.
  await page.goto('/#/promotion');await pickSchool(page);await expect(page.getByRole('tab',{name:'Year-end promotion',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Promotion'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('the grading policy is set in points of the final score: a CA of 50 is 15 + 15 + 20, and rescales when the CA weight changes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page);
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  const read=async()=>(await (await page.request.get(`/api/v1/schools/${school}/assessment/policy`)).json()).policy;
  const original=await read();
  await page.goto('/#/settings/grading');
  const ca=page.getByLabel(/^Continuous assessment \(CA\) counts for/),exam=page.getByLabel(/^Exam counts for/);
  const exercises=page.getByLabel(/^Class exercises and quizzes/),homework=page.getByLabel(/^Homework/),tests=page.getByLabel(/^Class tests/),projects=page.getByLabel(/^Projects/);
  // Wait for the saved policy to load into the form before typing over it.
  if(original)await expect(ca).toHaveValue(String(original.ca_weight));
  // A CA of 50 with the parts the teacher described: exercises 15, homework 15, two class tests 10 each.
  await ca.fill('50');await expect(exam).toHaveValue('50');
  await expect(exercises).toHaveValue('15');await expect(homework).toHaveValue('15');await expect(tests).toHaveValue('20');await expect(projects).toHaveValue('0');
  await expect(page.getByText('Total 50 of 50')).toBeVisible();await expect(page.getByText('Two tests count 10 each')).toBeVisible();
  await expect(page.getByText('a CA of 80 and an exam of 70 give 75 out of 100')).toBeVisible();
  // The parts must add up to the CA weight.
  await exercises.fill('20');await expect(page.getByText('Total 55 of 50')).toBeVisible();
  await page.getByLabel(/^Where this policy comes from/).fill('Synthetic grading memo');await page.getByRole('button',{name:'Save policy',exact:true}).click();
  await expect(page.getByText(/add up to 55, but it counts for 50/)).toBeVisible();
  // Changing the CA weight keeps the parts in proportion; the server keeps each part as its share of the CA.
  await exercises.fill('15');await ca.fill('30');await expect(exam).toHaveValue('70');
  await expect(exercises).toHaveValue('9');await expect(homework).toHaveValue('9');await expect(tests).toHaveValue('12');
  await exercises.fill('10');await homework.fill('10');await tests.fill('10');await expect(page.getByText('Total 30 of 30')).toBeVisible();
  await page.getByRole('button',{name:'Save policy',exact:true}).click();await expect(page.getByText('Assessment policy saved.')).toBeVisible();
  const saved=await read();expect(saved.ca_weight).toBe(30);expect(saved.exam_weight).toBe(70);
  const shares=Object.values(saved.ca_parts) as number[];expect(shares.reduce((a,b)=>a+b,0)).toBeCloseTo(100,6);expect(saved.ca_parts.tests).toBeCloseTo(33.3333,3);expect(saved.ca_parts.projects).toBe(0);
  await page.reload();await expect(exercises).toHaveValue('10');await expect(homework).toHaveValue('10');await expect(tests).toHaveValue('10');
  if(original){const response=await page.request.put(`/api/v1/schools/${school}/assessment/policy`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),caWeight:original.ca_weight,examWeight:original.exam_weight,caParts:original.ca_parts,bands:original.bands,sourceNote:original.source_note,version:saved.version}});expect(response.status(),await response.text()).toBe(200);}
  expect(errors).toEqual([]);
});
