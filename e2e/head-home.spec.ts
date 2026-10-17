import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');

test('the headteacher’s home narrows every figure by level, class and period, and a class row on a panel picks that class',async({page})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Kojo Overview',schoolName:`Overview School ${suffix}`,email:`overview-${suffix}@example.test`,password:'Overview-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const head=(await owner.query("SELECT id FROM memberships WHERE school_id=$1 AND role='headteacher'",[sid])).rows[0].id;
  const [year,term,basic,jhs]=Array.from({length:4},()=>randomUUID());
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Overview year',$3,$4)",[year,sid,shift(-300),shift(60)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 2',$4,$5)",[term,sid,year,shift(-30),shift(10)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 4','Primary',2),($4,$2,$3,'JHS 1','JHS',30)",[basic,sid,year,jhs]);
  const learners:string[]=[];
  for(const [name,classId,sex] of [['Ama One',basic,'female'],['Kwesi Two',basic,'male'],['Yaw Three',jhs,'male']] as const){
    const learner=randomUUID();learners.push(learner);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,sex) VALUES($1,$2,$3,$4,$5)",[learner,sid,`OV-${learner.slice(0,6)}`,name,sex]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),sid,learner,classId,shift(-200)]);
  }
  const invoice=randomUUID();
  await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amount_pesewas":90000}]',90000,$6)`,[invoice,sid,learners[0],term,basic,head]);
  await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,12000,'cash',$4,1,$5)",[randomUUID(),sid,invoice,today,head]);
  await owner.query("INSERT INTO admissions(id,school_id,full_name,class_id,start_date,admission_number,status) VALUES($1,$2,'Applicant Overview',$3,$4,$5,'application')",[randomUUID(),sid,basic,shift(30),`AO-${suffix}`]);
  await owner.end();
  await page.reload();
  const tile=(label:string)=>page.locator('.head-stats .stat').filter({hasText:label});
  const filters=page.locator('.filters');
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Showing Term 2'})).toHaveText('Showing Term 2 · All levels · This week');
  await expect(tile('Students')).toContainText('3');await expect(tile('Students')).toContainText('1 girl · 2 boys');
  await expect(tile('Fees collected')).toContainText('GH₵ 120');await expect(tile('Fees owed')).toContainText('GH₵ 780');
  await expect(page.getByRole('heading',{name:'Needs attention',exact:true})).toBeVisible();
  // Level narrows the roll, the class list and the money; the class select then offers only that level's classes.
  await filters.locator('select').nth(1).selectOption('JHS');
  await expect(page.getByRole('status').filter({hasText:'Showing Term 2'})).toHaveText('Showing Term 2 · JHS · This week');
  await expect(tile('Students')).toContainText('1');await expect(tile('Fees owed')).toContainText('GH₵ 0');
  await expect(filters.locator('select').nth(2).locator('option')).toHaveText(['All classes','JHS 1']);
  await filters.getByRole('button',{name:'Reset filters',exact:true}).click();await expect(filters.getByRole('button',{name:'Reset filters',exact:true})).toHaveCount(0);
  await expect(tile('Students')).toContainText('3');
  // A row on a panel picks that class everywhere; places show Basic 4 full.
  const places=page.getByRole('list',{name:'Places by class',exact:true});
  await expect(places.getByRole('button',{name:/^Basic 4: 2 of 2/})).toContainText('Full');
  await places.getByRole('button',{name:/^Basic 4:/}).click();
  await expect(page.getByRole('status').filter({hasText:'Showing Term 2'})).toHaveText('Showing Term 2 · Basic 4 · This week');
  await expect(filters.locator('select').nth(2)).toHaveValue(basic);await expect(tile('Students')).toContainText('2');
  await expect(page.locator('.pipeline')).toContainText('New1');
  // Period: this term and today are buttons that stay pressed; a finished term only offers the whole term.
  await filters.getByRole('button',{name:'Today',exact:true}).click();await expect(filters.getByRole('button',{name:'Today',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(tile('Fees collected')).toContainText('GH₵ 120');
  await filters.getByRole('button',{name:'This term',exact:true}).click();await expect(tile('Fees collected')).toContainText('13.3%');
  await page.getByRole('tab',{name:'Registers and absences',exact:true}).click();await expect(page.getByRole('heading',{name:'Attendance follow-up',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await page.setViewportSize({width:375,height:812});await expect(tile('Students')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
