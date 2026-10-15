import { test,expect,Page } from '@playwright/test';
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
async function signIn(page:Page,email:string,landing:string) {
  await page.goto('/');await page.getByLabel('Email or phone number',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:landing,exact:true})).toBeVisible();
}
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

// The model is a stand-in (e2e/claude-standin.mjs, started by playwright.config.ts): every layer of ours runs for real, the provider does not.
test('Claude drafts a batch for an author once the platform has a budget; a reviewer who did not ask for it publishes one',async({browser})=>{
  const db=owner(),suffix=randomUUID().slice(0,8),code=`E2E-D-${suffix}`,errors:string[]=[];
  const contexts:any[]=[];
  const open=async(email:string,landing:string,size?:{width:number;height:number})=>{const context=await browser.newContext(size?{viewport:size}:undefined),page=await context.newPage();contexts.push(context);page.on('pageerror',e=>errors.push(e.message));await signIn(page,email,landing);return page;};
  try {
    await db.query('UPDATE content_ai_budget SET monthly_token_cap=0,version=version+1');
    const adminId=await account(db,'Platform Admin',`platform-${suffix}@example.test`,[]);await db.query('INSERT INTO platform_admins(user_id) VALUES($1)',[adminId]);
    const leadId=await account(db,'Lena Lead',`lead-${suffix}@example.test`,['lead']);await account(db,'Ama Author',`author-${suffix}@example.test`,['author']);const reviewerId=await account(db,'Efua Reviewer',`reviewer-${suffix}@example.test`,['reviewer']);

    // The lead adds the indicator.
    const lead=await open(`lead-${suffix}@example.test`,'Content library');
    await lead.getByRole('tab',{name:'Catalogue',exact:true}).click();await lead.getByRole('button',{name:'Add catalogue entry',exact:true}).click();
    const form=lead.getByRole('dialog',{name:'Add a catalogue entry'});
    await form.getByLabel('Subject',{exact:true}).fill('Mathematics');await form.getByRole('combobox',{name:'Class level',exact:true}).selectOption('Basic 3');await form.getByLabel('Code (optional)',{exact:true}).fill(code);
    await form.getByLabel('Indicator: what the child can do',{exact:true}).fill(`Adds two numbers ${suffix}`);await form.getByLabel('Source note (name the document, or say who wrote it)',{exact:true}).fill('Written by the platform team');
    await form.getByRole('button',{name:'Add to catalogue',exact:true}).click();await expect(lead.getByRole('status').filter({hasText:'Added to the catalogue.'})).toBeVisible();

    // With no budget the author is told so and cannot start a batch.
    const author=await open(`author-${suffix}@example.test`,'Content library');
    const startDialog=async()=>{
      await author.getByRole('tab',{name:'Catalogue',exact:true}).click();await author.getByLabel('Search the catalogue',{exact:true}).fill(code);
      await author.locator('li').filter({hasText:code}).getByRole('button',{name:'Open',exact:true}).click();await author.getByRole('button',{name:'Draft with Claude'}).click();
      return author.getByRole('dialog',{name:/Draft with Claude/});
    };
    let dialog=await startDialog();
    await expect(dialog.getByRole('status')).toContainText('No drafting budget is set');await expect(dialog.getByRole('button',{name:'Draft questions',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close',exact:true}).last().click();

    // The platform administrator sets a budget, and it is the only person who can.
    const admin=await open(`platform-${suffix}@example.test`,'Platform administration');
    await admin.getByLabel('Monthly budget in tokens',{exact:true}).fill('300000');await admin.getByRole('button',{name:'Save budget',exact:true}).click();
    await expect(admin.getByText(/tokens used this month of 300,000/)).toBeVisible();
    await expect(lead.getByLabel('Monthly budget in tokens',{exact:true})).toHaveCount(0);

    // The author asks for six questions. One sum is wrong, so it is left out and the rest become drafts.
    await author.reload();dialog=await startDialog();
    await expect(dialog).toContainText('300,000 tokens left this month');
    await dialog.getByLabel('How many questions',{exact:true}).fill('6');await dialog.getByRole('button',{name:'Draft questions',exact:true}).click();
    await expect(dialog.getByText('5 of 6 questions drafted',{exact:true})).toBeVisible({timeout:20_000});
    await expect(dialog).toContainText('1 left out: 1 with a wrong answer to a sum');
    expect(await noOverflow(author)).toBe(true);
    await dialog.getByRole('button',{name:'Send all 5 to review',exact:true}).click();await expect(dialog.getByText('Sent 5 to review.',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Close',exact:true}).last().click();

    // The budget and the log show what it cost; nothing is waiting to be sent.
    await author.getByRole('tab',{name:'Drafting',exact:true}).click();
    await expect(author.getByText(/tokens used \(\d+%\)/)).toBeVisible();await expect(author.locator('li').filter({hasText:code})).toContainText('5 of 6 kept');await expect(author.getByRole('button',{name:/^Send \d+ drafts? to review$/})).toHaveCount(0);
    expect(await noOverflow(author)).toBe(true);

    // A reviewer reads a Claude draft, with the person who asked named, and publishes it.
    const reviewer=await open(`reviewer-${suffix}@example.test`,'Content library',{width:390,height:844});
    await reviewer.getByRole('tab',{name:/^Review/}).click();
    const card=reviewer.locator('.card').filter({hasText:'drafted with Claude for Ama Author'}).filter({hasText:code}).first();await expect(card).toBeVisible();
    expect(await noOverflow(reviewer)).toBe(true);
    await card.getByRole('button',{name:/Approve and publish/}).click();
    const approve=reviewer.getByRole('dialog',{name:'Approve and publish'});await approve.getByLabel(/Note/).fill('Worked it through');await approve.getByRole('button',{name:'Approve and publish',exact:true}).click();
    await expect(reviewer.getByRole('status').filter({hasText:'Published.'})).toBeVisible();

    // At the database: one Claude draft is live with this reviewer's name, four still wait, and the run log holds counts and tokens only.
    const live=(await db.query("SELECT v.author_kind,v.reviewer_id,v.author_id,r.status,r.drafted,r.dropped,r.input_tokens,r.output_tokens FROM content_versions v JOIN content_ai_runs r ON r.id=v.ai_run_id JOIN content_items i ON i.id=v.item_id JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE c.code=$1 AND v.status='published'",[code])).rows;
    expect(live).toHaveLength(1);expect(live[0].author_kind).toBe('ai');expect(live[0].reviewer_id).toBe(reviewerId);expect(live[0].author_id).not.toBe(reviewerId);expect(live[0].author_id).not.toBe(leadId);
    expect(live[0]).toMatchObject({status:'ok',drafted:5,dropped:1,input_tokens:1500,output_tokens:1000});
    expect((await db.query("SELECT count(*)::int AS n FROM content_versions v JOIN content_items i ON i.id=v.item_id JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE c.code=$1 AND v.status='in_review'",[code])).rows[0].n).toBe(4);

    // The review queue is shared with the other specs, which count it: leave it as found by rejecting what this test left waiting.
    const session=await (await reviewer.request.get('/api/v1/auth/session')).json();
    const waiting=(await db.query("SELECT v.id FROM content_versions v JOIN content_items i ON i.id=v.item_id JOIN catalogue_indicators c ON c.id=i.indicator_id WHERE c.code=$1 AND v.status='in_review'",[code])).rows;
    for(const row of waiting)expect((await reviewer.request.post(`/api/v1/content/versions/${row.id}/reject`,{headers:{'x-csrf-token':session.csrfToken},data:{note:'Test clean-up'}})).status()).toBe(201);
    expect(errors).toEqual([]);
  } finally {for(const context of contexts)await context.close();await db.end();}
});
