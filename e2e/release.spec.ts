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
  await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await pickSchool(page);
  await expect(page.getByRole('heading',{name:'Adinkra Synthetic School',exact:true})).toBeVisible();
  if(tab){await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:tab,exact:true}).click();}
}
test('CSV import requires fresh review, commits selected learners and retains approval on reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Learners');
  const suffix=randomUUID().slice(0,8),className=`CSV class ${suffix}`,fileName=`learners-${suffix}.csv`,reason='Reviewed synthetic source and distinct identities';
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`CSV year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  await page.getByRole('button',{name:'Import existing learners',exact:true}).click();
  await page.getByLabel('Search import classes',{exact:true}).fill(className);await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await page.getByRole('combobox',{name:'Target class',exact:true}).selectOption(section.id);
  await page.getByLabel('Search import classes',{exact:true}).fill('no matching class');await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await expect(page.getByRole('combobox',{name:'Target class',exact:true})).toHaveValue('');
  await page.getByLabel('Search import classes',{exact:true}).fill(className);await page.getByRole('button',{name:'Search classes',exact:true}).first().click();await page.getByRole('combobox',{name:'Target class',exact:true}).selectOption(section.id);
  await page.getByLabel('Enrolment start date',{exact:true}).fill('2026-09-01');
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:fileName,mimeType:'text/csv',buffer:Buffer.from(`admission_number,full_name,date_of_birth\nCSV-A-${suffix},Synthetic Import A ${suffix},2019-01-01\nCSV-B-${suffix},Synthetic Import B ${suffix},\nINVALID!,Invalid learner,`)});
  await page.getByRole('button',{name:'Stage CSV for validation',exact:true}).click();await expect(page.getByRole('heading',{name:`Preview: ${fileName}`,exact:true})).toBeVisible();
  await expect(page.getByLabel(`Row 2: Synthetic Import A ${suffix} · CSV-A-${suffix} · Born 2019-01-01`,{exact:true})).toBeDisabled();
  await page.reload();await pickSchool(page);await page.getByRole('button',{name:'Import existing learners',exact:true}).click();
  await page.getByLabel('Search import batches',{exact:true}).fill(fileName);await page.getByRole('button',{name:'Search batches',exact:true}).click();await page.locator('li').filter({hasText:fileName}).getByRole('button',{name:'Open import preview',exact:true}).click();
  await page.getByRole('button',{name:'Revalidate this preview',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Validation refreshed.'})).toBeVisible();
  const first=page.getByLabel(`Row 2: Synthetic Import A ${suffix} · CSV-A-${suffix} · Born 2019-01-01`,{exact:true}),second=page.getByLabel(`Row 3: Synthetic Import B ${suffix} · CSV-B-${suffix}`,{exact:true}),confirmation=page.getByLabel('I reviewed the validation results and selected learner identities for this import.',{exact:true});
  await first.check();await page.getByLabel('Import approval reason',{exact:true}).fill(reason);await confirmation.check();await expect(page.getByRole('button',{name:'Commit 1 selected rows',exact:true})).toBeEnabled();
  await second.check();await expect(confirmation).not.toBeChecked();await expect(page.getByRole('button',{name:'Commit 2 selected rows',exact:true})).toBeDisabled();await confirmation.check();
  await page.getByLabel('Import approval reason',{exact:true}).fill(reason+' reviewed');await expect(confirmation).not.toBeChecked();await confirmation.check();
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Commit 2 selected rows',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Import committed. 2 learner rows were processed.'})).toBeVisible();
  await page.reload();await pickSchool(page);await page.getByRole('button',{name:'Import existing learners',exact:true}).click();await page.getByLabel('Search import batches',{exact:true}).fill(fileName);await page.getByRole('button',{name:'Search batches',exact:true}).click();await page.locator('li').filter({hasText:fileName}).getByRole('button',{name:'Open import preview',exact:true}).click();
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
  async function choose(target:Page){const panel=target.locator('section').filter({has:target.getByRole('heading',{name:'Learner collection',exact:true})});await panel.getByLabel('Search learners',{exact:true}).fill(number);await panel.getByRole('button',{name:'Search collection roster',exact:true}).click();await panel.getByRole('combobox',{name:'Select learner',exact:true}).selectOption(admission.learner_id);await expect(panel.getByRole('heading',{name,exact:true})).toBeVisible();return panel;}
  try{
    await signIn(frontdesk,'frontdesk@example.test');const deskPanel=await choose(frontdesk);await deskPanel.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true}).selectOption(`guardian:${guardian.id}`);
    const confirmation=deskPanel.getByLabel('I confirmed the collector’s identity in person and am handing the learner into their care now.',{exact:true});await deskPanel.getByLabel('Staff verification reason',{exact:true}).fill('Compared synthetic collector in person against reviewed school record');await confirmation.check();await deskPanel.getByLabel('Staff verification reason',{exact:true}).fill('Rechecked synthetic collector in person against reviewed school record');await expect(confirmation).not.toBeChecked();await confirmation.check();
    await frontdesk.setViewportSize({width:375,height:812});expect(await frontdesk.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await deskPanel.getByRole('button',{name:'Record learner release',exact:true}).click();await expect(deskPanel.getByRole('status').filter({hasText:'Collection release recorded for Abena Sample.'})).toBeVisible();await expect(deskPanel.getByRole('button',{name:'Record learner release',exact:true})).toHaveCount(0);
    const headPanel=await choose(page);await headPanel.getByText('Correct mistaken release record',{exact:true}).click();await headPanel.getByLabel('Correction reason',{exact:true}).fill('Synthetic mistaken recording correction; no physical return claimed');await headPanel.getByRole('button',{name:'Void mistaken release record',exact:true}).click();await expect(headPanel.getByRole('status').filter({hasText:'Release record voided as a correction.'})).toBeVisible();
    await post(`/guardian-links/${guardian.id}/revoke`,{version:2,reason:'Synthetic pickup authority ended'});
    await frontdesk.reload();await pickSchool(frontdesk);const requestPanel=await choose(frontdesk);await expect(requestPanel.getByText('No current pickup authorization or approved exception is available.',{exact:true})).toBeVisible();await requestPanel.getByText('Request an unexpected collector review',{exact:true}).click();await requestPanel.getByLabel('Unexpected collector name',{exact:true}).fill('Synthetic Alternate Collector');await requestPanel.getByLabel('Reason for requesting this exception',{exact:true}).fill('Unexpected collector requires separate headteacher verification');await requestPanel.getByRole('button',{name:'Request headteacher review',exact:true}).click();await expect(requestPanel.getByRole('status').filter({hasText:'Unexpected collector request recorded'})).toBeVisible();await expect(requestPanel.getByRole('button',{name:'Approve one-time exception',exact:true})).toHaveCount(0);
    await headPanel.getByRole('button',{name:'Refresh collection records',exact:true}).click();const reviewer=await choose(page);const pending=reviewer.locator('li').filter({hasText:'Synthetic Alternate Collector · pending'});await pending.getByLabel('Review reason',{exact:true}).fill('Head reviewed separate one-time permission');await pending.getByLabel('In-person identity verification reason (required to approve)',{exact:true}).fill('Synthetic head verified identity through the school procedure');await pending.getByRole('button',{name:'Approve one-time exception',exact:true}).click();await expect(reviewer.getByRole('status').filter({hasText:'Collector request approved.'})).toBeVisible();
    await requestPanel.getByRole('button',{name:'Refresh collection records',exact:true}).click();const releasePanel=await choose(frontdesk);await expect(releasePanel.getByText('Identity verification:',{exact:false})).toHaveCount(0);await releasePanel.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true}).selectOption({label:'Approved one-time exception: Synthetic Alternate Collector'});await releasePanel.getByLabel('Staff verification reason',{exact:true}).fill('Staff confirmed the exceptional collector in person');await releasePanel.getByLabel('I confirmed the collector’s identity in person and am handing the learner into their care now.',{exact:true}).check();await releasePanel.getByRole('button',{name:'Record learner release',exact:true}).click();await expect(releasePanel.getByRole('status').filter({hasText:'Collection release recorded for Synthetic Alternate Collector.'})).toBeVisible();
    await reviewer.getByRole('button',{name:'Refresh collection records',exact:true}).click();const correction=await choose(page);const exceptional=correction.locator('li').filter({hasText:'One-time exception used.'});await exceptional.getByText('Correct mistaken release record',{exact:true}).click();await exceptional.getByLabel('Correction reason',{exact:true}).fill('Correct synthetic entry without restoring consumed authority');await exceptional.getByRole('button',{name:'Void mistaken release record',exact:true}).click();await expect(correction.getByRole('status').filter({hasText:'Release record voided as a correction.'})).toBeVisible();await expect(correction.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();await expect(correction.getByRole('combobox',{name:'Authorized collector / one-time exception',exact:true})).toHaveCount(0);
    await frontdesk.reload();await pickSchool(frontdesk);const persisted=await choose(frontdesk);await expect(persisted.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();await expect(persisted.getByText('No current pickup authorization or approved exception is available.',{exact:true})).toBeVisible();
    await post(`/learners/${admission.learner_id}/withdraw`,{version:1,effectiveDate:today,reason:'Synthetic departed child retains collection history'});await persisted.getByRole('button',{name:'Refresh collection records',exact:true}).click();await persisted.getByLabel('Include learners with collection history',{exact:true}).check();const historical=await choose(frontdesk);await expect(historical.getByRole('status').filter({hasText:'Collection activity is history-only'})).toBeVisible();await expect(historical.getByRole('button',{name:'Record learner release',exact:true})).toHaveCount(0);await expect(historical.getByText('Synthetic Alternate Collector · used',{exact:true})).toBeVisible();expect(errors).toEqual([]);
  }finally{await context.close();}
});
test('admission decisions, enrolment, transfer and reload preserve history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8),yearName=`Browser year ${suffix}`,first=`Primary Blue ${suffix}`,second=`Primary Green ${suffix}`,name=`Synthetic Browser Learner ${suffix}`,admission=`WEB-${suffix}`;
  await signIn(page,'head@example.test','Settings');await openSetting(page,'Academic year & classes');
  await page.getByLabel('Year name',{exact:true}).fill(yearName);await page.getByLabel('Start date',{exact:true}).fill('2026-09-02');await page.getByLabel('End date (exclusive)',{exact:true}).fill('2027-08-01');await page.getByRole('button',{name:'Add academic year',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Academic year added.'})).toBeVisible();
  for(const className of [first,second]) {
    await page.getByLabel('Class name',{exact:true}).fill(className);await page.getByLabel('Capacity',{exact:true}).fill('5');await page.getByRole('combobox',{name:'Academic year',exact:true}).selectOption({label:yearName});
    await page.getByRole('button',{name:'Add class',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Class added.'})).toBeVisible();await expect(page.getByLabel('Class name',{exact:true})).toHaveValue('');
  }
  await page.getByRole('navigation',{name:'Sections',exact:true}).getByRole('link',{name:'Learners',exact:true}).click();
  await page.getByRole('button',{name:'New application',exact:true}).click();await page.getByLabel('Learner full name',{exact:true}).fill(name);await page.getByLabel('Admission number',{exact:true}).fill(admission);await page.getByRole('combobox',{name:'Intended class',exact:true}).selectOption({label:`${first} · Primary · ${yearName}`});await page.getByLabel('Proposed start date',{exact:true}).fill('2026-09-02');await page.getByRole('button',{name:'Record application',exact:true}).click();
  const application=page.locator('tr').filter({hasText:admission});await expect(application).toContainText('Application');
  for(const action of ['Start review','Offer place','Record acceptance','Enrol learner']){await application.getByRole('button',{name:action,exact:true}).click();await expect(application.getByRole('button',{name:action,exact:true})).toHaveCount(0);}
  async function findLearner(){const panel=page.getByRole('region',{name:'Admissions and learners'});await panel.getByRole('tab',{name:/^Learner roll/}).click();await panel.getByLabel('Search learners',{exact:true}).fill(admission);await panel.locator('form').filter({hasText:'Search learners'}).getByRole('button',{name:'Search',exact:true}).click();await panel.getByRole('button',{name,exact:true}).click();}
  await expect(application).toContainText('Enrolled');await findLearner();
  await expect(page.getByRole('heading',{name:'Class history',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'New class',exact:true}).selectOption({label:`${second} · Primary · ${yearName}`});await page.getByLabel('Effective date',{exact:true}).fill('2026-10-01');await page.getByLabel('Transfer reason',{exact:true}).fill('Synthetic browser transfer review');await page.getByRole('button',{name:'Record transfer',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Previous enrolment history is retained.'})).toBeVisible();await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText('2026-10-01');
  await page.reload();await pickSchool(page);await findLearner();
  const history=page.locator('div').filter({has:page.getByRole('heading',{name:'Class history',exact:true})}).last();
  await expect(history).toContainText('Synthetic browser transfer review');await expect(history).toContainText(second);await expect(history).toContainText('Scheduled');
  await page.setViewportSize({width:375,height:812});await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/admissions-mobile.png'});expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Withdraw learner',exact:true}).click();await page.getByLabel('Withdrawal date (first day out of class)',{exact:true}).fill('2026-09-29');await page.getByLabel('Withdrawal reason',{exact:true}).fill('Synthetic reviewed school departure');await page.getByRole('button',{name:'Record withdrawal',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Withdrawal recorded.'})).toBeVisible();await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toHaveCount(0);
  await page.reload();await pickSchool(page);await findLearner();
  await expect(page.locator('li').filter({hasText:'Synthetic reviewed school departure'}).filter({hasText:'2026-09-29'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:second}).filter({hasText:'Superseded'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText(first);
  await expect(page.getByText('No open enrolment. Previous learner and class records are retained.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Withdraw learner',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test('authorized audit export is generated and downloaded with tenant-scoped records',async({page})=>{
  await signIn(page,'head@example.test','Settings');await openSetting(page,'Activity log');await page.getByRole('button',{name:'Export audit history',exact:true}).click();await page.getByRole('button',{name:'Prepare export',exact:true}).click();await expect(page.getByRole('button',{name:'Check export progress',exact:true})).toBeVisible();
  const worker=new JobWorker();try{await worker.runOnce();}finally{await worker.close();}
  await page.getByRole('button',{name:'Check export progress',exact:true}).click();await expect(page.getByRole('button',{name:'Download audit JSON',exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download audit JSON',exact:true}).click();const download=await downloadEvent;await download.saveAs('.local/browser-audit-export.json');
  const result=JSON.parse(await readFile('.local/browser-audit-export.json','utf8'));expect(result.schoolId).toBe(school);expect(result.rows.length).toBeGreaterThan(0);expect(result.rows.length).toBeLessThanOrEqual(500);
});
test('teacher browser exposes no admissions controls and server rejects direct administration',async({page})=>{
  await signIn(page,'teacher@example.test');await expect(page.getByRole('heading',{name:'Admissions and learners',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export audit history',exact:true})).toHaveCount(0);
  const denied=await page.request.get(`/api/v1/schools/${school}/admissions`);expect(denied.status()).toBe(403);
});
test('guardian verification, distinct rights and revocation persist across two browser sessions',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Guardians');
  const suffix=randomUUID().slice(0,8),name=`Synthetic Guardian Child ${suffix}`,admission=`FAM-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Family year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Family class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:name,dateOfBirth:'2018-05-03',admissionNumber:admission,classId:section.id,startDate:'2026-09-01'});
  for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const family=page.locator('section').filter({has:page.getByRole('heading',{name:'Guardian rights',exact:true})});
  await family.getByLabel('Search learners',{exact:true}).fill(name);await family.getByRole('button',{name:'Search learners',exact:true}).click();await family.getByRole('combobox',{name:'Learner',exact:true}).selectOption({label:`${name} · ${admission}`});
  async function create(right:string){await family.getByRole('combobox',{name:'Existing active guardian',exact:true}).selectOption('30000000-0000-4000-8000-000000000004');await family.getByRole('checkbox',{name:right,exact:true}).check();await family.getByRole('button',{name:'Create pending guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'pending verification'})).toBeVisible();}
  await create('Billing information');let pending=family.locator('li').filter({hasText:name}).filter({hasText:'Pending verification'});await expect(pending).toBeVisible();
  const context=await browser.newContext();const portal=await context.newPage();portal.on('pageerror',error=>errors.push(error.message));await portal.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));
  try{
    await signIn(portal,'guardian@example.test');await expect(portal.getByRole('heading',{name:'Guardian portal',exact:true})).toBeVisible();await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);
    await pending.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed billing authority');await pending.getByRole('button',{name:'Verify guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link verified.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(1);await portal.getByRole('combobox',{name:'Linked child',exact:true}).selectOption({label:`${name} · ${admission}`});await expect(portal.getByRole('heading',{name:'Your verified access',exact:true})).toBeVisible();await expect(portal.getByRole('heading',{name:'Academic information',exact:true})).toHaveCount(0);
    const billing=await (await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).json();expect(billing.billing).toBe(true);expect(billing).not.toHaveProperty('date_of_birth');expect(billing).not.toHaveProperty('enrolments');
    const verified=family.locator('li').filter({hasText:name}).filter({hasText:'Synthetic reviewed billing authority'});await verified.getByLabel('Revocation reason',{exact:true}).fill('Synthetic sponsor authority ended');await verified.getByRole('button',{name:'Revoke guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link revoked.'})).toBeVisible();
    expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).status()).toBe(404);await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);
    await create('Academic records');pending=family.locator('li').filter({hasText:name}).filter({hasText:'Pending verification'});await pending.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed academic authority');await pending.getByRole('button',{name:'Verify guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link verified.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();const linkedChildren=portal.getByRole('combobox',{name:'Linked child',exact:true});await expect(linkedChildren.locator('option').filter({hasText:admission})).toHaveCount(1);await linkedChildren.selectOption({label:`${name} · ${admission}`});await expect(portal.getByText('Date of birth: 2018-05-03',{exact:true})).toBeVisible();await expect(portal.locator('li').filter({hasText:`Family class ${suffix}`})).toContainText('Active today');
    await portal.setViewportSize({width:375,height:812});expect(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await portal.getByRole('heading',{name:'Guardian portal',exact:true}).scrollIntoViewIfNeeded();await portal.screenshot({path:'.local/guardian-mobile.png'});
    expect((await portal.request.get(`/api/v1/schools/${school}/learners/${application.learner_id}`)).status()).toBe(403);expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${randomUUID()}`)).status()).toBe(404);
    const academic=family.locator('li').filter({hasText:name}).filter({hasText:'Synthetic reviewed academic authority'});await academic.getByLabel('Revocation reason',{exact:true}).fill('Synthetic academic authority ended');await academic.getByRole('button',{name:'Revoke guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link revoked.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await expect(portal.getByText('Date of birth: 2018-05-03',{exact:true})).toHaveCount(0);await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});
test('dated teacher grant, fresh roster and revocation work across two browser sessions',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Settings');await openSetting(page,'Teacher assignments');
  const suffix=randomUUID().slice(0,8),className=`Roster class ${suffix}`,name=`Synthetic Roster Learner ${suffix}`,lateName=`Synthetic Late Learner ${suffix}`;
  const today=new Date().toISOString().slice(0,10),day=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Roster year ${suffix}`,startDate:day(-30),endDate:day(100)}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  for(const [fullName,startDate,admissionNumber] of [[name,today,`REG-${suffix}`],[lateName,day(1),`LATE-${suffix}`]]){
    let application=await post('/admissions',{fullName,startDate,admissionNumber,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  }
  const teaching=page.locator('section').filter({has:page.getByRole('heading',{name:'Teacher assignments',exact:true})});await teaching.getByRole('button',{name:'Refresh assignments',exact:true}).click();await teaching.getByLabel('Search classes',{exact:true}).fill(className);await teaching.getByRole('button',{name:'Search classes',exact:true}).click();await teaching.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);
  const context=await browser.newContext(),teacherPage=await context.newPage();teacherPage.on('pageerror',error=>errors.push(error.message));await teacherPage.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
  try{
    await signIn(teacherPage,'teacher@example.test');expect((await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).status()).toBe(404);
    await teaching.getByRole('combobox',{name:'Teacher',exact:true}).selectOption('30000000-0000-4000-8000-000000000003');await teaching.getByLabel('Assignment start date (inclusive)',{exact:true}).fill(today);await teaching.getByLabel('Assignment end date (exclusive)',{exact:true}).fill(day(100));await teaching.getByLabel('Reason authorizing whole-class roster access',{exact:true}).fill('Synthetic headteacher reviewed class responsibility');await teaching.getByRole('button',{name:'Create teacher assignment',exact:true}).click();await expect(teaching.getByRole('status').filter({hasText:'Teaching assignment created.'})).toBeVisible();
    await teacherPage.getByRole('button',{name:'Refresh class access',exact:true}).click();await teacherPage.getByLabel('Search my classes',{exact:true}).fill(className);await teacherPage.getByRole('button',{name:'Search classes',exact:true}).click();await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);
    const teacherAttendance=teacherPage.locator('section').filter({has:teacherPage.getByRole('heading',{name:'Attendance',exact:true})});await teacherAttendance.getByLabel('Date',{exact:true}).fill(today);await teacherAttendance.getByRole('combobox',{name:'Class',exact:true}).selectOption(section.id);
    const teacherRoster=teacherPage.locator('section').filter({has:teacherPage.getByRole('heading',{name:'My classes',exact:true})});await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(1);await expect(teacherRoster.locator('li').filter({hasText:lateName})).toHaveCount(0);
    const roster=await (await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).json();expect(roster.total).toBe(1);expect(Object.keys(roster.items[0]).sort()).toEqual(['admission_number','enrolment_id','full_name','id']);
    await teacherPage.getByLabel('Class date',{exact:true}).fill(day(1));await teacherPage.getByRole('button',{name:'Show classes for date',exact:true}).click();await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);await expect(teacherRoster.locator('li').filter({hasText:lateName})).toHaveCount(1);
    await teacherPage.reload();await pickSchool(teacherPage);await teacherPage.getByRole('combobox',{name:'Select an assigned class',exact:true}).selectOption(section.id);await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(1);
    await teacherPage.setViewportSize({width:375,height:812});expect(await teacherPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await teacherPage.getByRole('heading',{name:'My classes',exact:true}).scrollIntoViewIfNeeded();await teacherPage.screenshot({path:'.local/teacher-mobile.png'});
    const row=teaching.locator('li').filter({hasText:className});await row.getByLabel('Revocation reason',{exact:true}).fill('Synthetic reviewed teaching responsibility ended');await row.getByRole('button',{name:'Revoke assignment',exact:true}).click();await expect(teaching.getByRole('status').filter({hasText:'Assignment revoked for Kofi Sample.'})).toBeVisible();
    expect((await teacherPage.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).status()).toBe(404);
    await teacherPage.getByLabel('Search this roster',{exact:true}).fill(name);await teacherPage.getByRole('button',{name:'Search roster',exact:true}).click();await expect(teacherPage.getByRole('alert').filter({hasText:'Class access could not be refreshed'})).toBeVisible();await expect(teacherRoster.locator('li').filter({hasText:name})).toHaveCount(0);
    await teacherPage.getByRole('button',{name:'Refresh class access',exact:true}).click();await expect(teacherAttendance.getByRole('combobox',{name:'Class',exact:true})).toHaveValue('');await expect(teacherAttendance.getByRole('combobox',{name:'Class',exact:true}).locator('option').filter({hasText:className})).toHaveCount(0);
    await page.reload();await pickSchool(page);await expect(page.locator('li').filter({hasText:className}).filter({hasText:'Synthetic reviewed teaching responsibility ended'})).toContainText(className);expect(errors).toEqual([]);
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
  const suffix=randomUUID().slice(0,8),today='2026-09-28',name=`Synthetic Attendance Learner ${suffix}`,admission=`ATT-${suffix}`;
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

test('Nursery report draft passes review, publishes and appears in the guardian portal',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Early years');
  const suffix=randomUUID().slice(0,8),today='2026-09-28',learnerName=`Synthetic KG Report Learner ${suffix}`,admission=`REP-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Report year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Report Nursery ${suffix}`,level:'Nursery',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:learnerName,startDate:today,admissionNumber:admission,classId:section.id});for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const candidates=await (await page.request.get(`/api/v1/schools/${school}/guardian-candidates`)).json(),guardianCandidate=candidates.find((item:any)=>item.display_name==='Abena Sample');expect(guardianCandidate).toBeTruthy();
  const link=await post('/guardian-links',{learnerId:application.learner_id,guardianMembershipId:guardianCandidate.id,academic:true,billing:false,pickup:false,contact:false});await post(`/guardian-links/${link.id}/verify`,{version:link.version,reason:'Synthetic academic reporting permission verified'});
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Nursery and KG progress reports'});await expect(panel.getByRole('heading',{name:'Nursery and KG progress reports'})).toBeVisible();
  await panel.getByRole('combobox',{name:'Level'}).selectOption('Nursery');await panel.getByRole('button',{name:'Refresh classes',exact:true}).click();await panel.getByRole('combobox',{name:'Class'}).selectOption(section.id);await expect(panel.getByRole('option',{name:new RegExp(learnerName)})).toHaveCount(1);const roster=await (await page.request.get(`/api/v1/schools/${school}/teaching/classes/${section.id}/roster?date=${today}`)).json(),reportLearner=roster.items.find((item:any)=>item.full_name===learnerName);expect(reportLearner).toBeTruthy();await panel.getByRole('combobox',{name:'Learner'}).selectOption(reportLearner.id);
  await panel.getByLabel('Strengths and progress').fill('Joined a shared activity and took turns with peers.');await panel.getByLabel('Next steps').fill('Continue offering a chance to lead a short group activity.');await panel.getByLabel('Teacher note (optional)').fill('Synthetic note for guardian preview.');await panel.getByRole('button',{name:'Save report draft'}).click();
  const report=panel.locator('li').filter({hasText:learnerName});await expect(report).toContainText('draft');await report.getByRole('button',{name:'Submit for review'}).click();await expect(report).toContainText('submitted');await report.getByRole('button',{name:'Approve'}).click();await expect(report).toContainText('approved');await report.getByRole('button',{name:'Publish to guardians'}).click();await expect(report).toContainText('published');
  const context=await browser.newContext(),guardianPage=await context.newPage();guardianPage.on('pageerror',error=>errors.push(error.message));await guardianPage.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
  try{await signIn(guardianPage,'guardian@example.test');const guardianPanel=guardianPage.getByRole('region',{name:'Nursery and KG progress reports'});await guardianPanel.getByRole('combobox',{name:'Child'}).selectOption(reportLearner.id);const guardianReport=guardianPanel.locator('li').filter({hasText:learnerName});await expect(guardianReport).toContainText('Joined a shared activity and took turns with peers.');await expect(guardianReport).toContainText('Continue offering a chance to lead a short group activity.');expect(errors).toEqual([]);}
  finally{await context.close();}
});
test('connection and proxy failures show a plain-language retry message, not a parser error',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page,'head@example.test','Learners');
  await page.route('**/api/v1/schools/*/academic-years*',route=>route.fulfill({status:502,contentType:'text/html',body:'<html><body>Bad gateway</body></html>'}));
  await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Admissions and learners'});
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
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(adminEmail);await page.getByLabel('Password',{exact:true}).fill('Platform-admin-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    const panel=page.getByRole('region',{name:'Platform administration'});await expect(panel).toBeVisible();
    await panel.getByLabel('School name',{exact:true}).fill(schoolName);await panel.getByLabel('Headteacher name',{exact:true}).fill('Efua Mensah');await panel.getByLabel('Headteacher email',{exact:true}).fill(headEmail);
    await panel.getByRole('button',{name:'Create school',exact:true}).click();
    const credentials=panel.getByRole('status');await expect(credentials).toContainText(headEmail);
    const temporary=(await credentials.locator('code').textContent())!.trim();expect(temporary.length).toBeGreaterThanOrEqual(16);
    await expect(panel.locator('li').filter({hasText:schoolName})).toContainText('1 headteacher');
    const context=await browser.newContext(),headPage=await context.newPage();
    try {
      await headPage.goto('/');await headPage.getByLabel('Email',{exact:true}).fill(headEmail);await headPage.getByLabel('Password',{exact:true}).fill(temporary);await headPage.getByRole('button',{name:'Sign in',exact:true}).click();
      await expect(headPage.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
      await headPage.getByLabel('Temporary password',{exact:true}).fill(temporary);await headPage.getByLabel('New password',{exact:true}).fill('Brand-new-passphrase-77');await headPage.getByRole('button',{name:'Save new password'}).click();
      await expect(headPage.getByRole('heading',{name:schoolName,exact:true})).toBeVisible();await expect(headPage.getByRole('region',{name:'Platform administration'})).toHaveCount(0);
    } finally {await context.close();}
  } finally {await owner.end();}
});
test('headteacher drafts and approves a notice; the linked guardian reads it',async({page,browser})=>{
  const {Pool}=require('pg');const path=require('node:path');
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Notices');
  const suffix=randomUUID().slice(0,8),className=`Notice class ${suffix}`,title=`Trip notice ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Notice year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  const learner=randomUUID();
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Notice Learner')",[learner,school,`NT-${suffix}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),school,learner,section.id]);
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,'30000000-0000-4000-8000-000000000004','Abena Sample',true,false,false,true,now(),'30000000-0000-4000-8000-000000000001','Checked in person')",[randomUUID(),school,learner]);
  await owner.end();await page.reload();await pickSchool(page);
  const panel=page.getByRole('region',{name:'Notices to guardians',exact:true});
  await panel.getByLabel('Title',{exact:true}).fill(title);await panel.getByLabel('Message',{exact:true}).fill('Bring a packed lunch on Friday.');
  const selects=panel.locator('form select');await selects.nth(0).selectOption('class');await selects.nth(1).selectOption(section.id);
  await panel.getByRole('button',{name:'Save draft',exact:true}).click();await expect(panel.getByText('Saved as a draft. Nothing is sent until you approve it.')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await panel.locator('li').filter({hasText:title}).getByRole('button',{name:'Approve and send',exact:true}).click();
  await expect(panel.getByText('Approved for 1 guardian; 0 will also get an SMS.')).toBeVisible();
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const guardianPage=await browser.newPage();await guardianPage.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));await signIn(guardianPage,'guardian@example.test','Notices');
  const mine=guardianPage.getByRole('region',{name:'Notices from the school',exact:true});await expect(mine.getByText(title)).toBeVisible();await expect(mine.getByText('Bring a packed lunch on Friday.')).toBeVisible();
  await guardianPage.close();expect(errors).toEqual([]);
});
test('an Excel-style class list with "Admission No." headers and DD/MM/YYYY dates stages once the date order is chosen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,'head@example.test','Learners');
  const suffix=randomUUID().slice(0,8),className=`Excel class ${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Excel year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'});await post('/classes',{name:className,level:'Primary',capacity:5,academicYearId:year.id});
  await page.getByRole('button',{name:'Import existing learners',exact:true}).click();
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
  await signIn(page);expect(await links(page)).toEqual(['Home','Attendance','Learners','Guardians','Pickup','Assessment','Early years','Fees','Notices','Promotion','Settings']);
  await expect(page.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('region',{name:'Notices to guardians'})).toHaveCount(0);
  await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('link',{name:'Notices',exact:true}).click();await expect(page.getByRole('region',{name:'Notices to guardians'})).toBeVisible();
  await page.reload();await pickSchool(page);await expect(page.getByRole('region',{name:'Notices to guardians'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const [email,expected] of [['teacher@example.test',['Today','Assessment','Early years']],['frontdesk@example.test',['Pickup','Learners']],['guardian@example.test',['My children','Fees','Notices']]] as const){
    const other=await browser.newPage();await other.setViewportSize({width:375,height:812});await other.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));await signIn(other,email);expect(await links(other)).toEqual(expected);
    expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await other.close();
  }
  expect(errors).toEqual([]);
});
test('a new sign-up sees a setup guide instead of empty daily screens, and daily work appears once a class exists',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:375,height:812});
  const suffix=randomUUID().slice(0,8),schoolName=`Signup School ${suffix}`;
  await page.goto('/');await page.getByRole('button',{name:'Create an account',exact:true}).click();
  await page.getByLabel('Your full name',{exact:true}).fill('Esi Owusu');await page.getByLabel('School name',{exact:true}).fill(schoolName);await page.getByLabel('Email',{exact:true}).fill(`signup-${suffix}@example.test`);await page.getByLabel('Password (at least 12 characters)',{exact:true}).fill('Signup-passphrase-2026');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  const guide=page.getByRole('region',{name:`Let's get ${schoolName} ready`});await expect(guide).toBeVisible();await expect(guide).toContainText('0 of 5 done');
  await expect(page.getByRole('combobox',{name:'School',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Attendance follow-up'})).toHaveCount(0);
  await guide.getByLabel('Year name',{exact:true}).fill('2026/2027');await guide.getByLabel('First day of the year',{exact:true}).fill('2026-09-01');await guide.getByLabel('Day after the last day',{exact:true}).fill('2027-08-01');
  await guide.getByRole('button',{name:'Save academic year',exact:true}).click();await expect(guide).toContainText('1 of 5 done');
  await guide.getByLabel('Class name',{exact:true}).fill('Primary 1');await guide.getByRole('button',{name:'Add class',exact:true}).click();
  await expect(guide.getByRole('status')).toContainText('Added: Primary 1');await expect(guide).toContainText('2 of 5 done');
  await expect(guide.getByRole('link',{name:'Add staff'})).toBeVisible();await expect(page.getByRole('heading',{name:'Attendance follow-up'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
