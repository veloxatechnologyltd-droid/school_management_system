import { test,expect,Page,Browser } from '@playwright/test';
import { randomUUID,randomBytes,scryptSync } from 'node:crypto';
const {Pool}=require('pg');const path=require('node:path');
const password='Content-team-2026!';
const owner=()=>new Pool({host:path.resolve(__dirname,'../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
async function account(db:any,name:string,email:string,roles:string[],admin?:string) {
  const id=randomUUID(),salt=randomBytes(16).toString('hex');
  await db.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[id,name,email,`${salt}:${scryptSync(password,salt,64).toString('hex')}`]);
  for(const role of roles)await db.query('INSERT INTO content_staff(id,user_id,role,granted_by) VALUES($1,$2,$3,$4)',[randomUUID(),id,role,admin??id]);
  return id;
}
async function signIn(page:Page,email:string) {
  await page.goto('/#/signin');await page.getByLabel('Email or phone number',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Content library',exact:true})).toBeVisible();
}
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
async function person(browser:Browser,email:string) { const context=await browser.newContext(),page=await context.newPage();await signIn(page,email);return {context,page}; }

test('a lead adds a catalogue entry, an author fixes a wrong answer the checks caught, and a reviewer publishes it',async({browser})=>{
  const db=owner(),suffix=randomUUID().slice(0,8),code=`E2E-${suffix}`,question='What is 8 + 3?';
  const errors:string[]=[];
  try {
    await account(db,'Lena Lead',`lead-${suffix}@example.test`,['lead']);await account(db,'Ama Author',`author-${suffix}@example.test`,['author']);await account(db,'Efua Reviewer',`reviewer-${suffix}@example.test`,['reviewer']);
    const lead=await person(browser,`lead-${suffix}@example.test`),author=await person(browser,`author-${suffix}@example.test`),reviewer=await person(browser,`reviewer-${suffix}@example.test`);
    for(const p of [lead,author,reviewer])p.page.on('pageerror',error=>errors.push(error.message));
    try {
      // The lead adds the indicator children will practise.
      await lead.page.getByRole('tab',{name:'Catalogue',exact:true}).click();await lead.page.getByRole('button',{name:'Add catalogue entry',exact:true}).click();
      const form=lead.page.getByRole('dialog',{name:'Add a catalogue entry'});
      await form.getByLabel('Subject',{exact:true}).fill('Mathematics');await form.getByRole('combobox',{name:'Class level',exact:true}).selectOption('Basic 2');await form.getByLabel('Code (optional)',{exact:true}).fill(code);
      await form.getByLabel('Indicator: what the child can do',{exact:true}).fill(`Adds two small numbers ${suffix}`);await form.getByLabel('Source note (name the document, or say who wrote it)',{exact:true}).fill('Written by the platform team');
      await form.getByRole('button',{name:'Add to catalogue',exact:true}).click();await expect(lead.page.getByRole('status').filter({hasText:'Added to the catalogue.'})).toBeVisible();

      // The author writes a question with the wrong answer marked: the computer refuses it, saying why.
      await expect(author.page.getByRole('tab',{name:/^Review/})).toHaveCount(0);
      await author.page.getByRole('tab',{name:'Catalogue',exact:true}).click();await author.page.getByLabel('Search the catalogue',{exact:true}).fill(code);
      const entry=author.page.locator('li').filter({hasText:code});await entry.getByRole('button',{name:'Open',exact:true}).click();await author.page.getByRole('button',{name:'New question',exact:true}).click();
      const editor=author.page.getByRole('dialog',{name:/New question/});
      await editor.getByLabel('Question',{exact:true}).fill(question);await editor.getByLabel('Option 1',{exact:true}).fill('9');await editor.getByLabel('Option 2',{exact:true}).fill('11');await editor.getByLabel('Option 3',{exact:true}).fill('7');
      await editor.getByRole('button',{name:'Save and submit for review',exact:true}).click();
      await expect(editor.getByRole('alert')).toContainText('The draft is saved');await expect(editor).toContainText('The question works out to 11, not 9');
      // Choosing the right option and submitting again goes through.
      await editor.getByLabel('Option 2 is correct',{exact:true}).check();await editor.getByRole('button',{name:'Save and submit for review',exact:true}).click();
      await expect(author.page.getByRole('status').filter({hasText:'Submitted for review.'})).toBeVisible();
      await author.page.getByRole('tab',{name:'Library',exact:true}).click();await expect(author.page.locator('li').filter({hasText:question}).getByText('In review',{exact:true})).toBeVisible();
      // The author cannot approve their own item: the reviewer queue is not theirs, and the server refuses a direct call.
      const session=await (await author.page.request.get('/api/v1/auth/session')).json();
      const mine=await (await author.page.request.get('/api/v1/content/items?mine=true&status=in_review',{headers:{'x-csrf-token':session.csrfToken}})).json();
      const own=mine.items.find((i:any)=>i.lead===question);expect(own).toBeTruthy();
      const refused=await author.page.request.post(`/api/v1/content/versions/${own.versionId}/approve`,{headers:{'x-csrf-token':session.csrfToken},data:{}});expect(refused.status()).toBe(403);
      // At phone width nothing runs off the screen.
      await author.page.setViewportSize({width:375,height:812});expect(await noOverflow(author.page)).toBe(true);await author.page.getByRole('tab',{name:'Catalogue',exact:true}).click();expect(await noOverflow(author.page)).toBe(true);

      // The reviewer opens on the queue, reads the question as a child sees it, and publishes it.
      await reviewer.page.reload();await expect(reviewer.page.getByRole('tab',{name:'Review (1)',exact:true})).toBeVisible();
      const card=reviewer.page.locator('.card').filter({hasText:question});await expect(card).toContainText('written by Ama Author');
      await card.getByRole('button',{name:/Approve and publish/}).click();
      const approve=reviewer.page.getByRole('dialog',{name:'Approve and publish'});await approve.getByLabel(/Note/).fill('Worked it through');await approve.getByRole('button',{name:'Approve and publish',exact:true}).click();
      await expect(reviewer.page.getByRole('status').filter({hasText:'Published.'})).toBeVisible();await expect(reviewer.page.getByText('Nothing is waiting for review',{exact:false})).toBeVisible();
      await reviewer.page.getByRole('tab',{name:'Library',exact:true}).click();await reviewer.page.locator('li').filter({hasText:question}).getByRole('button',{name:question,exact:true}).click();
      await expect(reviewer.page.getByRole('dialog')).toContainText('Approved by Efua Reviewer');await expect(reviewer.page.getByRole('dialog')).toContainText('Answer worked out by the computer: it matches');

      // The catalogue now counts it as live content.
      await lead.page.reload();await lead.page.getByRole('tab',{name:'Catalogue',exact:true}).click();
      await expect(lead.page.locator('li').filter({hasText:code})).toContainText('1 question · 0 guides');
    } finally {await lead.context.close();await author.context.close();await reviewer.context.close();}
    expect(errors).toEqual([]);
  } finally {await db.end();}
});

test('the platform administrator gives and removes a content role, and a school role is not one',async({browser})=>{
  const db=owner(),suffix=randomUUID().slice(0,8),adminEmail=`platform-${suffix}@example.test`,staffEmail=`staff-${suffix}@example.test`;
  try {
    const adminId=await account(db,'Platform Admin',adminEmail,[]);await db.query('INSERT INTO platform_admins(user_id) VALUES($1)',[adminId]);
    await account(db,`New Reviewer ${suffix}`,staffEmail,[]);
    const context=await browser.newContext(),page=await context.newPage();
    try {
      await page.goto('/#/signin');await page.getByLabel('Email or phone number',{exact:true}).fill(adminEmail);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
      const panel=page.getByRole('region',{name:'Platform administration'});await expect(panel).toBeVisible();
      // Being the administrator is not a content role: the library is not offered.
      await expect(page.getByRole('link',{name:'Content library'})).toHaveCount(0);
      await panel.getByRole('combobox',{name:'Role',exact:true}).selectOption('reviewer');await panel.getByLabel('Email',{exact:true}).fill(staffEmail);await panel.getByRole('button',{name:'Add',exact:true}).click();
      const row=panel.locator('li').filter({hasText:staffEmail});await expect(row).toContainText('Reviewer');
      await panel.getByRole('combobox',{name:'Role',exact:true}).selectOption('reviewer');await panel.getByLabel('Email',{exact:true}).fill(staffEmail);await panel.getByRole('button',{name:'Add',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('already hold that role');
      const staff=await browser.newContext(),staffPage=await staff.newPage();
      try {
        await signIn(staffPage,staffEmail);await expect(staffPage.getByText('You are a content reviewer.',{exact:true})).toBeVisible();
        await row.getByRole('button',{name:'Remove this role',exact:true}).click();await expect(row).toHaveCount(0);
        await staffPage.reload();await expect(staffPage.getByRole('heading',{name:'Content library',exact:true})).toHaveCount(0);
      } finally {await staff.close();}
    } finally {await context.close();}
  } finally {await db.end();}
});
