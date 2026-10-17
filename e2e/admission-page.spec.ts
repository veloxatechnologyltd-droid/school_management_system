import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');

test('an application has its own page: family details, decisions with who made them, staff notes, and a blank form to print',async({page})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Ama Admissions',schoolName:`Intake School ${suffix}`,email:`intake-${suffix}@example.test`,password:'Intake-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const year=randomUUID();
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Intake year',$3,$4)",[year,sid,shift(-100),shift(200)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 3','Primary',30)",[randomUUID(),sid,year]);
  await owner.end();
  await page.goto('/#/students/applications');await page.reload();

  // The front office records the application with the family's details.
  await page.getByRole('button',{name:'New application',exact:true}).click();
  await page.getByLabel('Student full name',{exact:true}).fill('Akua Intake');await page.getByLabel('Admission number',{exact:true}).fill(`IN-${suffix}`);
  await page.getByRole('combobox',{name:'Intended class',exact:true}).selectOption({label:'Basic 3 · Primary · Intake year'});await page.getByLabel('Proposed start date',{exact:true}).fill(shift(7));
  await page.getByLabel('Name',{exact:true}).fill('Kofi Intake');await page.getByRole('combobox',{name:'Relationship',exact:true}).selectOption('Father');await page.getByLabel('Mobile number',{exact:true}).fill('024 555 1234');
  await page.getByRole('button',{name:'Record application',exact:true}).click();

  // The list shows the next step; the name opens the application's page.
  const row=page.locator('tr').filter({hasText:`IN-${suffix}`});await expect(row).toContainText('Start the review.');
  await row.getByRole('link',{name:'Akua Intake',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Akua Intake',exact:true})).toBeVisible();
  await expect(page.locator('.admission-next')).toContainText('Start the review.');
  await expect(page.getByRole('link',{name:'024 555 1234',exact:true})).toHaveAttribute('href','tel:+233245551234');

  // Decisions are made on the page; a waitlist needs a reason.
  await page.getByRole('button',{name:'Start review',exact:true}).click();await expect(page.locator('.admission-next')).toContainText('Decide');
  await page.getByRole('button',{name:'Waitlist',exact:true}).click();await expect(page.getByRole('alert')).toContainText('reason');
  await page.getByLabel('Reason (needed to waitlist or decline)').fill('Basic 3 is full until the end of the month');
  await page.getByRole('button',{name:'Waitlist',exact:true}).click();await expect(page.locator('.admission-next')).toContainText('Offer a place when one opens');
  for(const action of ['Offer place','Record acceptance','Enrol student']){await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('button',{name:action,exact:true})).toHaveCount(0);}
  await expect(page.locator('.admission-next')).toContainText('The student is on the roll');

  const steps=page.locator('.timeline li');await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toContainText('Application received');await expect(steps.nth(0)).toContainText('Ama Admissions');
  await expect(steps.nth(2)).toContainText('Reason: Basic 3 is full until the end of the month');await expect(steps.nth(5)).toContainText('Enrolled');

  // A staff note is kept with who wrote it, and survives a reload.
  await page.getByLabel('New note',{exact:true}).fill('Birth certificate seen at the front desk.');await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Note added.');
  await page.reload();await expect(page.locator('.history').filter({hasText:'Birth certificate seen'})).toContainText('Ama Admissions');
  await expect(page.getByRole('link',{name:'Open the student page',exact:true})).toBeVisible();

  // Phone width: nothing sideways.
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:900});

  // The list opens on applications still being decided; the enrolled one is under Enrolled.
  await page.goto('/#/students/applications');await expect(page.getByText('No applications waiting for a decision')).toBeVisible();
  await page.getByRole('combobox',{name:'Stage',exact:true}).selectOption('enrolled');await expect(page.locator('tr').filter({hasText:`IN-${suffix}`})).toContainText('Enrolled');

  // A blank form to print carries the school's name.
  await page.getByRole('button',{name:'Print blank form',exact:true}).click();
  await expect(page.locator('.admission-form')).toContainText(`Intake School ${suffix}`);await expect(page.locator('.admission-form')).toContainText('Relationship to the child');
  expect(errors).toEqual([]);
});
