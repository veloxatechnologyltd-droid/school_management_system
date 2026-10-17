import { test,expect,Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

test('a student and a staff member each have a full page: who they are, a summary, quick actions and tabs, with the head and a teacher seeing what suits them',async({page,browser})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8),schoolName=`Profile School ${suffix}`;await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Ama Profiles',schoolName,email:`profiles-${suffix}@example.test`,password:'Profiles-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const head=(await owner.query("SELECT id FROM memberships WHERE school_id=$1 AND role='headteacher'",[sid])).rows[0].id;
  const [year,term,basic,learner,teacherM]=Array.from({length:5},()=>randomUUID());
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Profile year',$3,$4)",[year,sid,shift(-100),shift(200)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[term,sid,year,shift(-30),shift(60)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 3','Primary',30)",[basic,sid,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth,sex) VALUES($1,$2,$3,'Efua Profile','2016-04-05','female')",[learner,sid,`PF-${suffix}`]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),sid,learner,basic,shift(-50)]);
  // The synthetic teacher joins this school and teaches Basic 3.
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) SELECT $1,$2,id,'teacher' FROM users WHERE synthetic_login='teacher@example.test'",[teacherM,sid]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Class teacher for Basic 3',$7)",[randomUUID(),sid,basic,teacherM,shift(-30),shift(150),head]);
  await owner.query("INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[]',50000,$6)",[randomUUID(),sid,learner,term,basic,head]);
  await owner.end();
  // An accountant whose sign-in the head will manage from the page.
  const csrf=(await (await page.request.get('/api/v1/auth/session')).json()).csrfToken;
  expect((await page.request.post(`/api/v1/schools/${sid}/accounts`,{headers:{'x-csrf-token':csrf},data:{name:'Joyce Accounts',email:`joyce-${suffix}@example.test`,role:'accountant'}})).status()).toBe(201);
  await page.reload();

  // ---- The student's page: a card, a summary and quick actions, and tabs.
  await page.goto(`/#/learner/${learner}`);
  await expect(page.getByRole('heading',{name:'Student details',exact:true})).toBeVisible();
  const card=page.locator('.person-card');await expect(card).toContainText('Efua Profile');await expect(card).toContainText('Girl');await expect(card).toContainText(`PF-${suffix}`);await expect(card).toContainText('Basic 3');
  await expect(card).toContainText('Kofi Sample');await expect(card).toContainText('Owes GH₵ 500.00');
  const rail=page.getByRole('complementary',{name:'Summary and quick actions',exact:true});
  await expect(rail).toContainText('Admission no.');await expect(rail).toContainText('Fees owing');await expect(rail.getByRole('link',{name:'Parents',exact:true})).toBeVisible();
  await expect(rail.getByRole('button',{name:'Print student record',exact:true})).toBeVisible();
  await expect(page.locator('.student-record')).toBeHidden();
  const tab=(name:string)=>page.getByRole('tab',{name,exact:true});
  await tab('Attendance').click();await expect(page.getByText('No registers recorded for this term yet')).toBeVisible();
  await tab('Fees').click();await expect(page.getByRole('button',{name:'Open in Accounts',exact:true})).toBeVisible();await expect(page.locator('.stat').filter({hasText:'Owing'})).toContainText('GH₵ 500.00');
  await tab('History').click();await expect(page.locator('.timeline li').first()).toContainText('Basic 3');await expect(page.getByText('Not admitted through an application here')).toBeVisible();
  // The wide tabs go without the side rail; "Add a note" opens the notes tab.
  await tab('Overview').click();await rail.getByRole('button',{name:'Add a note',exact:true}).click();
  await expect(tab('Notes & practice')).toHaveAttribute('aria-selected','true');await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();await expect(rail).toHaveCount(0);
  await tab('Academics').click();await expect(rail).toHaveCount(0);
  for(const name of ['Overview','Academics','Attendance','Notes & practice','Fees','History']){await page.setViewportSize({width:390,height:844});await tab(name).click();expect(await noOverflow(page),`student ${name} at phone width`).toBe(true);}
  await page.setViewportSize({width:1280,height:900});

  // ---- A teacher's page from the Teachers list.
  await page.goto('/#/teachers');await page.getByRole('link',{name:'Kofi Sample',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Teacher details',exact:true})).toBeVisible();
  await expect(page.locator('.person-card')).toContainText('Kofi Sample');await expect(page.locator('.person-card')).toContainText('Basic 3');
  await tab('Classes').click();const row=page.locator('tr').filter({hasText:'Basic 3'});await expect(row).toContainText('Teaching now');await expect(row).toContainText('1');await expect(row).toContainText('Class teacher for Basic 3');
  await tab('Activity').click();await expect(page.getByText('Nothing recorded yet')).toBeVisible();
  await page.goBack();

  // ---- A staff member's page, and the head's account actions on it.
  await page.goto('/#/staff');await page.getByRole('link',{name:'Joyce Accounts',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Staff details',exact:true})).toBeVisible();await expect(page.getByText('Payments recorded',{exact:true})).toBeVisible();
  await expect(tab('Classes')).toHaveCount(0);await expect(page.getByRole('link',{name:'Class assignments',exact:true})).toHaveCount(0);
  const staffRail=page.getByRole('complementary',{name:'Summary and account actions',exact:true});
  await staffRail.getByRole('button',{name:'Reset password',exact:true}).click();
  await expect(page.locator('.credentials')).toContainText(`joyce-${suffix}@example.test`);await expect(page.locator('.credentials code')).not.toBeEmpty();await page.getByRole('button',{name:'I have copied it',exact:true}).click();
  await staffRail.getByRole('button',{name:'Add a phone number',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Phone number for Joyce Accounts',exact:true});await dialog.getByLabel(/Mobile number/).fill('024 555 9876');await dialog.getByRole('button',{name:'Save phone number',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Phone number saved for Joyce Accounts.'})).toBeVisible();
  await expect(page.locator('.person-card').getByRole('link',{name:'024 555 9876',exact:true})).toHaveAttribute('href','tel:+233245559876');
  await tab('Activity').click();const history=page.locator('.card').filter({has:page.getByRole('heading',{name:'History of this sign-in',exact:true})});
  await expect(history.locator('li')).toHaveCount(3);await expect(history.locator('li').first()).toContainText('Phone number changed');await expect(history.locator('li').first()).toContainText('· Ama Profiles');await expect(history.locator('li').last()).toContainText('Sign-in created');await expect(history.locator('li').last()).toContainText('· Ama Profiles');
  expect(await noOverflow(page)).toBe(true);
  await staffRail.getByRole('button',{name:'Remove access',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Yes, remove access',exact:true}).click();
  await expect(page.locator('.person-card').getByText('Access removed',{exact:true})).toBeVisible();await expect(staffRail.getByRole('button',{name:'Remove access',exact:true})).toHaveCount(0);

  // ---- A page for someone who is not in this school, or not staff, is unavailable.
  await page.goto(`/#/teacher/${randomUUID()}`);await expect(page.getByRole('heading',{name:'Staff member unavailable',exact:true})).toBeVisible();

  // ---- The teacher sees the student without fees, the application or phone numbers.
  const teacher=await browser.newPage();const teacherErrors:string[]=[];teacher.on('pageerror',error=>teacherErrors.push(error.message));
  await teacher.goto('/#/signin');await teacher.getByLabel('Email or phone number',{exact:true}).fill('teacher@example.test');await teacher.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await teacher.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(teacher.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();const picker=teacher.getByRole('combobox',{name:'School',exact:true});if(await picker.count())await picker.selectOption(sid);
  await expect(teacher.getByRole('heading',{name:schoolName,exact:true})).toBeVisible();
  await teacher.goto(`/#/learner/${learner}`);await expect(teacher.getByRole('heading',{name:'Student details',exact:true})).toBeVisible();
  await expect(teacher.locator('.person-card')).toContainText('Efua Profile');await expect(teacher.locator('.person-card')).not.toContainText('Owes');
  await expect(teacher.getByRole('tab',{name:'Fees',exact:true})).toHaveCount(0);await expect(teacher.getByRole('link',{name:'Open the application',exact:true})).toHaveCount(0);
  await expect(teacher.getByRole('link',{name:'Parents',exact:true})).toHaveCount(0);await expect(teacher.getByText('Fees owing')).toHaveCount(0);
  await teacher.goto(`/#/teacher/${teacherM}`);await expect(teacher.getByRole('heading',{name:'Teacher details',exact:true})).toHaveCount(0);
  await teacher.close();
  expect(errors).toEqual([]);expect(teacherErrors).toEqual([]);
});
