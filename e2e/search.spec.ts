import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');

test('the top bar shows the term running today; Ctrl K finds a student, a parent and a receipt and opens each one where it lives',async({page})=>{
  const owner=new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8);await page.goto('/#/signin');
  expect((await page.request.post('/api/v1/auth/register',{data:{name:'Kojo Finder',schoolName:`Finder School ${suffix}`,email:`finder-${suffix}@example.test`,password:'Finder-passphrase-2026'}})).status()).toBe(201);
  const sid=(await (await page.request.get('/api/v1/auth/session')).json()).schools[0].id;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),shift=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
  const head=(await owner.query("SELECT id FROM memberships WHERE school_id=$1 AND role='headteacher'",[sid])).rows[0].id;
  const [year,term,basic,learner,invoice,payment]=Array.from({length:6},()=>randomUUID());
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Finder year',$3,$4)",[year,sid,shift(-100),shift(200)]);
  await owner.query("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,'Term 1',$4,$5)",[term,sid,year,shift(-8),shift(60)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Basic 2','Primary',30)",[basic,sid,year]);
  await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,'FD-001','Efua Findme')",[learner,sid]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),sid,learner,basic,shift(-50)]);
  const guardian=(await owner.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.synthetic_login='guardian@example.test' LIMIT 1")).rows[0];
  if(guardian){const link=randomUUID();await owner.query("INSERT INTO memberships(id,school_id,user_id,role) SELECT $1,$2,user_id,'guardian' FROM memberships WHERE id=$3",[link,sid,guardian.id]);
    await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,'Kwabena Findme',true,true,false,true,now(),$5,'Synthetic access')",[randomUUID(),sid,learner,link,head]);}
  await owner.query(`INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,'[{"name":"Tuition","amountPesewas":90000}]',90000,$6)`,[invoice,sid,learner,term,basic,head]);
  await owner.query("INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,30000,'cash',$4,7,$5)",[payment,sid,invoice,today,head]);
  await owner.end();
  await page.reload();
  await expect(page.locator('.term-chip')).toContainText('Finder year');await expect(page.locator('.term-chip')).toContainText('Term 1 · Week 2');
  // A student opens their own page.
  await page.keyboard.press('Control+k');const box=page.getByRole('combobox',{name:'Search',exact:true});await box.fill('findme');
  await expect(page.getByRole('option').first()).toContainText('Efua Findme');await expect(page.getByRole('option').first()).toContainText('FD-001 · Basic 2');
  await box.press('Enter');await expect(page).toHaveURL(new RegExp(`#/learner/${learner}$`));
  // A parent opens the Parents page with the search filled in.
  if(guardian){await page.getByRole('button',{name:'Search the school',exact:true}).click();await box.fill('kwabena');
    await page.getByRole('option').filter({hasText:'Parent of Efua Findme'}).click();await expect(page).toHaveURL(/#\/parents$/);
    await expect(page.getByRole('cell',{name:'Kwabena Findme',exact:true})).toBeVisible();}
  // A receipt number opens that receipt in Accounts.
  await page.getByRole('button',{name:'Search the school',exact:true}).click();await box.fill('No. 7');
  await expect(page.getByRole('option').first()).toContainText('Receipt no. 7');await box.press('Enter');
  await expect(page).toHaveURL(/#\/accounts$/);await expect(page.locator('.receipt')).toContainText('The parent of Efua Findme');await expect(page.locator('.receipt')).toContainText('Three hundred Ghana cedis only');
  expect(errors).toEqual([]);
});
