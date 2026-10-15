import { Pool } from 'pg';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { localConfig } from '../src/core/database';

// Loads the Home Learning Pass content library into the local demo database (LOCAL_DB_NAME=school_demo): a small content team,
// a catalogue with a few indicators per stage, and questions and parent guides in every state (published, replaced, in review,
// a draft, a draft the checks will refuse, a rejection). Accounts are inserted directly; everything else goes through the running
// API as the lead, author and reviewer would, so the rules, versions and checks apply. All wording here is original.
// Safe to run again: the library is loaded once; the drafting step (a monthly budget, then one Claude batch if a provider is set up)
// is added to an already-loaded demo without wiping it.

const API = process.env.DEMO_API ?? 'http://127.0.0.1:3018/api/v1';
const PASSWORD = 'Demo-school-2026!';
const DOMAIN = 'veloxa.demo';
const team = [
  { key: 'lead', name: 'Abena Lartey', email: `contentlead@${DOMAIN}`, role: 'lead' },
  { key: 'author', name: 'Kwesi Boateng', email: `author@${DOMAIN}`, role: 'author' },
  { key: 'reviewer', name: 'Efua Mensah', email: `reviewer@${DOMAIN}`, role: 'reviewer' },
] as const;

class Member {
  cookie = ''; csrf = '';
  constructor(readonly email: string) {}
  async login() {
    // The API allows 30 sign-ins a minute from one address; right after the school loads, wait out the window rather than fail.
    let r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: PASSWORD }) });
    for (let wait = 0; r.status === 429 && wait < 6; wait++) { await new Promise(done => setTimeout(done, 15_000)); r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: PASSWORD }) }); }
    if (!r.ok) throw new Error(`Sign-in failed for ${this.email}: ${r.status} ${await r.text()}`);
    this.cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); this.csrf = (await r.json()).csrfToken;
    return this;
  }
  async call<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>, area = '/content'): Promise<T> {
    const r = await fetch(`${API}${area}${path}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, 'x-csrf-token': this.csrf }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

// Multiple choice with the right option at a chosen position, or a number answer (wrong = null).
const q = (prompt: string, right: string | number, wrong: string[] | null, why: string, at = 0) => {
  if (!wrong) return { kind: 'number', prompt, answer: right as number, explanation: why };
  const options = [...wrong]; options.splice(at, 0, right as string);
  return { kind: 'choice', prompt, options, correctOption: at, explanation: why };
};
const catalogue = [
  { key: 'letters', level: 'Basic 1', subject: 'English Language', code: 'B1.1.1', strand: 'Reading', description: 'Says the sound each letter makes', terms: [1] },
  { key: 'addition', level: 'Basic 2', subject: 'Mathematics', code: 'B2.1.1', strand: 'Number', description: 'Adds two numbers with totals up to 20', terms: [1, 2] },
  { key: 'tables', level: 'Basic 4', subject: 'Mathematics', code: 'B4.1.1', strand: 'Number', description: 'Recalls the 2, 5 and 10 times tables', terms: [1] },
  { key: 'fractions', level: 'Basic 5', subject: 'Mathematics', code: 'B5.1.1', strand: 'Number', subStrand: 'Fractions', description: 'Adds and subtracts fractions with the same denominator', terms: [1] },
  { key: 'tenses', level: 'Basic 6', subject: 'English Language', code: 'B6.2.1', strand: 'Grammar', description: 'Uses past and present tenses correctly in sentences', terms: [1, 2] },
  { key: 'energy', level: 'JHS 1', subject: 'Integrated Science', code: 'J1.3.1', strand: 'Energy', description: 'Names the forms of energy and gives an example of each', terms: [2] },
  { key: 'equations', level: 'JHS 3', subject: 'Mathematics', code: 'J3.2.1', strand: 'Algebra', description: 'Solves simple linear equations in one unknown', terms: [1] },
] as const;

// Drafting with Claude: the platform administrator gives the demo a monthly budget; then, when AI is switched on and a provider is set up,
// the author asks for one batch (Basic 4 times tables, level 2) and sends it to review so the reviewer has Claude drafts to read.
async function drafting(author: Member) {
  const admin = await new Member(`platform@${DOMAIN}`).login();
  const budget = await admin.call<{ monthlyTokenCap: number; version: number }>('GET', '/content-drafting', undefined, '/platform');
  if (budget.monthlyTokenCap === 0) {
    await admin.call('PUT', '/content-drafting/budget', { monthlyTokenCap: 300000, version: budget.version }, '/platform');
    console.log('· Drafting budget set to 300,000 tokens a month');
  }
  const status = await author.call<{ enabled: boolean; providerConfigured: boolean; runs: unknown[] }>('GET', '/drafting');
  if (status.runs.length) return console.log('· Claude drafting has already been used on this demo');
  if (!status.enabled || !status.providerConfigured) return console.log('· Claude drafting is off here: start the API with AI_ENABLED=true and a provider key to try it (the budget is ready)');
  const entry = (await author.call<{ items: { id: string; code: string }[] }>('GET', '/catalogue?level=Basic%204&limit=20')).items.find(i => i.code === 'B4.1.1');
  if (!entry) return console.log('· The Basic 4 times tables entry is not in this demo library; no batch drafted');
  const batch = await author.call<{ runId: string; drafted: number; requested: number; dropped: number }>('POST', '/drafting/batches', { indicatorId: entry.id, level: 2, count: 10 });
  console.log(`· Claude drafted ${batch.drafted} of ${batch.requested} questions (${batch.dropped} left out by the checks)`);
  if (batch.drafted) { const sent = await author.call<{ submitted: number }>('POST', `/drafting/runs/${batch.runId}/submit`); console.log(`· ${sent.submitted} sent to the review queue`); }
}

type Finish = 'published' | 'review' | 'draft' | 'rejected';
async function main() {
  if (process.env.LOCAL_DB_NAME !== 'school_demo') throw new Error('Run with LOCAL_DB_NAME=school_demo (npm run demo:content). The demo content only goes into the demo database.');
  const owner = new Pool(localConfig(true));
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`${API}/auth/session`)).status < 500) break; } catch { /* API still starting */ } await new Promise(r => setTimeout(r, 1000)); }
    if ((await owner.query('SELECT 1 FROM users WHERE synthetic_login=$1', [team[0].email])).rowCount) {
      console.log('The demo content library is already loaded.');
      return await drafting(await new Member(team[1].email).login());
    }
    const salt = randomBytes(16).toString('hex'), hash = `${salt}:${scryptSync(PASSWORD, salt, 64).toString('hex')}`;
    const admin = randomUUID();
    await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)', [admin, 'Platform Administrator', `platform@${DOMAIN}`, hash]);
    await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)', [admin]);
    for (const p of team) {
      const id = randomUUID();
      await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)', [id, p.name, p.email, hash]);
      await owner.query('INSERT INTO content_staff(id,user_id,role,granted_by) VALUES($1,$2,$3,$4)', [randomUUID(), id, p.role, admin]);
    }
    const [lead, author, reviewer] = await Promise.all(team.map(p => new Member(p.email).login()));
    console.log('· Content team created');

    const id: Record<string, string> = {};
    for (const c of catalogue) {
      const { key, terms, ...rest } = c as typeof c & { subStrand?: string };
      id[key] = (await lead!.call<{ id: string }>('POST', '/catalogue', { ...rest, termGuidance: terms, origin: 'platform', sourceNote: 'Written by the Veloxa content team for the demo' })).id;
    }
    console.log(`· ${catalogue.length} catalogue entries`);

    // Writes one item and takes it as far as asked: published (a reviewer approves), in review, left as a draft, or rejected with a note.
    let count = 0;
    const make = async (writer: Member, key: string, kind: 'question' | 'guide', level: number | null, body: object, finish: Finish, note?: string) => {
      const made = await writer.call<{ itemId: string; versionId: string }>('POST', '/items', { kind, indicatorId: id[key], ...(level ? { level } : {}), body });
      count++;
      if (finish !== 'draft') await writer.call('POST', `/versions/${made.versionId}/submit`);
      if (finish === 'published') await reviewer!.call('POST', `/versions/${made.versionId}/approve`, note ? { note } : {});
      if (finish === 'rejected') await reviewer!.call('POST', `/versions/${made.versionId}/reject`, { note: note! });
      return made;
    };
    const guide = (learning: string, example: string, mistakes: string[], activity: string) => ({ learning, example, mistakes, activity });

    // Basic 2 addition: the full range of states on one indicator.
    await make(author!, 'addition', 'question', 1, q('What is 12 + 7?', '19', ['18', '20'], '12 plus 7 is 19.', 1), 'published');
    await make(author!, 'addition', 'question', 1, q('What is 9 + 8?', 17, null, '9 plus 8 is 17.'), 'published');
    await make(author!, 'addition', 'question', 1, q('What is 6 + 5?', '11', ['10', '12', '9'], '6 plus 5 is 11.', 2), 'published');
    const oranges = await make(author!, 'addition', 'question', 2, q('Ama has 14 oranges. Kofi gives her 5 more. How many oranges does she have now?', '19', ['18', '9', '20'], '14 and 5 more makes 19.', 2), 'published');
    const reworded = await author!.call<{ versionId: string }>('POST', `/items/${oranges.itemId}/versions`, { body: q('Ama has 14 oranges. Kofi gives her 5 more. How many oranges does Ama have now?', '19', ['18', '9', '20'], '14 add 5 is 19.', 1) });
    await author!.call('POST', `/versions/${reworded.versionId}/submit`); await reviewer!.call('POST', `/versions/${reworded.versionId}/approve`, { note: 'Clearer wording; same answer.' });
    await make(author!, 'addition', 'question', 2, q('Kofi has 15 mangoes and eats 6. How many mangoes are left?', '9', ['8', '10', '21'], '15 take away 6 leaves 9.', 1), 'review');
    await make(author!, 'addition', 'question', 3, q('A bag holds 8 oranges. Ama has 2 bags and 3 more oranges. How many oranges?', '19', ['16', '13', '18']), 'draft');
    await make(author!, 'addition', 'question', 1, q('Which of these is an even number?', '12', ['14', '7', '9'], '12 can be shared into two equal groups.'), 'rejected', 'Two options are even (12 and 14). Change one so there is a single right answer.');
    await make(lead!, 'addition', 'guide', null, guide('Your child is learning to add two small numbers and get the total, up to 20.', 'To add 8 and 5, start at 8 and count on 5 more: 9, 10, 11, 12, 13. The total is 13.', ['Counting the starting number again, so 8 + 5 becomes 14', 'Losing count when counting on'], 'Put 20 small stones or beans in a bowl. Ask your child to take 8 in one hand and 5 in the other, then count them all together.'), 'published', 'Read it through with a Basic 2 parent in mind.');

    // Basic 5 fractions: a well-covered indicator.
    for (const [lvl, prompt, right, wrong, why, at] of [
      [1, 'What is 1/4 + 2/4?', '3/4', ['3/8', '2/4', '1/4'], 'Add the tops: 1 + 2 = 3. The bottom stays 4.', 0],
      [1, 'In the fraction 3/5, what is the denominator?', '5', ['3', '8', '15'], 'The denominator is the bottom number.', 1],
      [2, 'What is 3/8 + 4/8?', '7/8', ['7/16', '1/8', '12/8'], '3 + 4 = 7 eighths.', 2],
      [2, 'Esi ate 2/9 of a loaf and Kojo ate 4/9. How many ninths did they eat in all?', 6, null, '2 + 4 = 6 ninths.', 0],
      [3, 'What is 7/8 - 3/8?', '4/8', ['10/8', '4/16', '3/8'], '7 - 3 = 4 eighths.', 1],
      [3, 'Yaw reads 2/5 of a 100-page book on Monday and 1/5 on Tuesday. How many pages are left?', 40, null, '3/5 of 100 is 60 pages read, so 40 are left.', 0],
    ] as [number, string, string | number, string[] | null, string, number][]) await make(author!, 'fractions', 'question', lvl, q(prompt, right, wrong, why, at), 'published');
    await make(lead!, 'fractions', 'guide', null, guide('Your child is learning to add and subtract fractions that have the same bottom number, such as quarters or eighths.', 'One quarter plus two quarters is three quarters: 1/4 + 2/4 = 3/4. The bottom number stays the same.', ['Adding the bottom numbers as well, so 1/4 + 2/4 becomes 3/8', 'Forgetting that the bottom number says the size of each part'], 'Cut a loaf of bread into 4 equal slices. Eat 1 slice and ask what fraction is left. Then take 2 more slices and ask again.'), 'published');

    // Basic 4 times tables, Basic 6 tenses, JHS science and algebra.
    for (const [prompt, right, wrong, why, at] of [
      ['What is 5 x 6?', '30', ['25', '35', '56'], '5 times 6 is 30.', 1],
      ['What is 10 x 7?', 70, null, 'Ten sevens make 70.', 0],
      ['What is 2 x 9?', '18', ['11', '16', '29'], '2 times 9 is 18.', 2],
    ] as [string, string | number, string[] | null, string, number][]) await make(author!, 'tables', 'question', 1, q(prompt, right, wrong, why, at), 'published');
    await make(author!, 'tenses', 'question', 1, q('Choose the correct sentence.', 'Yesterday Ama walked to school.', ['Yesterday Ama walks to school.', 'Yesterday Ama walking to school.', 'Yesterday Ama will walk to school.'], 'Yesterday tells us the action is in the past.'), 'published');
    await make(author!, 'tenses', 'question', 2, q('Which word completes the sentence? Every morning, Kofi ___ his bed.', 'makes', ['made', 'making', 'will made'], 'Every morning shows a habit, so use the present tense.', 0), 'published');
    await make(author!, 'tenses', 'guide', null, guide('Your child is learning when to use past and present tenses in sentences.', 'Today I walk to school. Yesterday I walked to school. The word yesterday tells us to use the past.', ['Using the present tense after the word yesterday', 'Forgetting the -ed ending on regular past verbs'], 'At supper, ask your child to tell you three things they did today. Then ask for three things they do every day.'), 'review');
    await make(author!, 'energy', 'question', 1, q('Which form of energy does a burning candle give out as light?', 'Light energy', ['Sound energy', 'Chemical energy only', 'Wind energy'], 'A candle gives out light, and heat too.', 0), 'published');
    await make(author!, 'energy', 'question', 2, q('A stretched rubber band can store energy. What kind is it?', 'Elastic potential energy', ['Kinetic energy', 'Sound energy', 'Nuclear energy'], 'A stretched elastic stores energy to release later.', 1), 'published');
    await make(author!, 'equations', 'question', 2, q('Solve for x: x + 9 = 20', 11, null, 'Take 9 from both sides: x = 20 - 9 = 11.'), 'published');
    await make(author!, 'equations', 'question', 3, q('What is 6 x 7?', '48', ['42', '36', '49'], '6 times 7 is 42.', 0), 'draft');
    console.log(`· ${count} items written; the last draft (6 x 7) has a wrong answer on purpose: the checks stop it going to review.`);
    await drafting(author!);
    console.log(`\nContent library ready. Sign in with any of these (password ${PASSWORD}):`);
    for (const p of team) console.log(`  ${p.role.padEnd(9)} ${p.email}`);
    console.log(`  platform  platform@${DOMAIN} (grants content roles)`);
  } finally { await owner.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
