import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');

test('the head builds a week as a draft, a double-booked teacher is refused, publishing shows it to the teacher, and it prints',async({page})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Yaw Timetable',schoolName:`Bell School ${suffix}`,email:`bell-${suffix}@example.test`,password:'Bell-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(d:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+d*864e5).toISOString().slice(0,10);
  const dow=new Date(`${today}T00:00:00Z`).getUTCDay(),weekday=dow>=1&&dow<=5?['','Monday','Tuesday','Wednesday','Thursday','Friday'][dow]!:'';
  const year=randomUUID();
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Bell year',$3,$4)",[year,sid,shift(-100),shift(250)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[randomUUID(),sid,year,shift(-20),shift(50)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'JHS 1','JHS',40),($4,$2,$3,'JHS 2','JHS',40)",[randomUUID(),sid,year,randomUUID()]);
  await owner.query("INSERT INTO subjects(id,school_id,name) VALUES($1,$2,'Mathematics'),($3,$2,'English Language')",[randomUUID(),sid,randomUUID()]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,'20000000-0000-4000-8000-000000000002','teacher')",[randomUUID(),sid]);
  await owner.end();
  await page.goto('/#/timetable');await page.reload();

  // Start a draft; the bell is filled in with a common school day, which the head saves, and a lab is added.
  await page.getByRole('button',{name:'Start a timetable',exact:true}).click();await expect(page.getByText('Teachers do not see this version')).toBeVisible();
  await page.getByRole('tab',{name:'Bell and rooms',exact:true}).click();await page.getByRole('button',{name:'Save bell schedule',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Bell schedule saved.'})).toBeVisible();
  await page.getByLabel('New room',{exact:true}).fill('Science lab');await page.getByRole('button',{name:'Add room',exact:true}).click();await expect(page.getByText('Science lab',{exact:true})).toBeVisible();

  // JHS 1, Monday 08:00: Mathematics with Kofi in the lab.
  await page.getByRole('tab',{name:'Classes',exact:true}).click();await page.getByRole('combobox',{name:'Class',exact:true}).selectOption({label:'JHS 1'});
  const fill=async(cell:string,subject:string,teacher:string,room='')=>{await page.locator('.tt-wide').getByRole('button',{name:cell}).click();const d=page.getByRole('dialog');
    await d.getByRole('combobox',{name:'Subject',exact:true}).selectOption({label:subject});await d.getByRole('combobox',{name:'Teacher',exact:true}).selectOption({label:teacher});
    if(room)await d.getByRole('combobox',{name:'Room',exact:true}).selectOption({label:room});await d.getByRole('button',{name:'Save lesson',exact:true}).click();return d;};
  await fill('Monday 08:00: empty','Mathematics','Kofi Sample','Science lab');await expect(page.getByRole('dialog')).toHaveCount(0);
  if(weekday&&weekday!=='Monday'){await fill(`${weekday} 08:40: empty`,'English Language','Kofi Sample');await expect(page.getByRole('dialog')).toHaveCount(0);}
  await expect(page.locator('.tt-wide .tt-cell').first()).toContainText('Mathematics');

  // JHS 2 at the same time with the same teacher is refused, naming the lesson already there.
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption({label:'JHS 2'});
  const dialog=await fill('Monday 08:00: empty','English Language','Kofi Sample');
  await expect(dialog.getByRole('alert')).toContainText('Kofi Sample already teaches JHS 1 Mathematics on Monday, 08:00–08:40');
  await dialog.getByRole('combobox',{name:'Teacher',exact:true}).selectOption({label:'Yaw Timetable'});await dialog.getByRole('button',{name:'Save lesson',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);

  // Publish; the version is now in use. The class prints with the school's heading.
  await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.locator('.scope-line')).toContainText('In use');
  await page.evaluate(()=>{window.print=()=>{};});await page.getByRole('button',{name:'Print',exact:true}).click();
  await expect(page.locator('.tt-print')).toContainText('JHS 2 timetable');await expect(page.locator('.tt-print')).toContainText('Version 1');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});

  // The teacher sees their own week and, on a school day, today's lessons on Today.
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.goto('/#/signin');await page.getByLabel('Email or phone number',{exact:true}).fill('teacher@example.test');await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();const picker=page.getByRole('combobox',{name:'School',exact:true});if(await picker.count())await picker.selectOption(sid);
  if(weekday){await expect(page.getByText("Today's lessons")).toBeVisible();await expect(page.locator('.today-lessons')).toContainText(weekday==='Monday'?'JHS 1 Mathematics':'JHS 1 English Language');}
  await page.goto('/#/timetable');await expect(page.getByRole('tab',{name:'My week',exact:true})).toBeVisible();
  await expect(page.locator('.tt-wide .tt-cell').filter({hasText:'Mathematics'})).toContainText('JHS 1');await expect(page.locator('.tt-wide .tt-cell').filter({hasText:'Mathematics'})).toContainText('Science lab');
  await expect(page.getByRole('button',{name:'Publish',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
