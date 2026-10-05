import { Pool } from 'pg';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { localConfig } from '../src/core/database';

// Loads a realistic Ghanaian basic school into the local demo database (LOCAL_DB_NAME=school_demo) for client
// demonstrations. Accounts and the school row are inserted directly; everything else goes through the running API
// as the headteacher, teachers, accountant and front desk would, so records carry the normal rules, versions and audit.
// Dates are relative to the day it runs, so the current term, recent attendance and today's registers look live.

const API = process.env.DEMO_API ?? 'http://127.0.0.1:3018/api/v1';
const PASSWORD = 'Demo-school-2026!';
const SCHOOL = '50000000-0000-4000-8000-000000000001';
const SCHOOL_NAME = 'Sunrise International School';
const DOMAIN = 'sunrise.demo';

// ---------------------------------------------------------------- deterministic randomness
let seed = 20260904;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const chance = (p: number) => rand() < p;
const normal = (mean: number, sd: number) => { const u = Math.max(rand(), 1e-9), v = rand(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------- dates (Africa/Accra is UTC)
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
const weekday = (s: string) => { const w = day(s).getUTCDay(); return w > 0 && w < 6; };
const firstMondayFrom = (s: string) => { let d = s; while (day(d).getUTCDay() !== 1) d = addDays(d, 1); return d; };
const TODAY = iso(new Date());
const thisYear = Number(TODAY.slice(0, 4));
const Y = TODAY >= `${thisYear}-09-01` ? thisYear : thisYear - 1;
const yearStart = firstMondayFrom(`${Y}-09-07`);
const yearEnd = `${Y + 1}-08-01`;
const termPlan = [
  { name: 'Term 1', start: yearStart, end: `${Y}-12-18` },
  { name: 'Term 2', start: firstMondayFrom(`${Y + 1}-01-06`), end: `${Y + 1}-04-02` },
  { name: 'Term 3', start: firstMondayFrom(`${Y + 1}-04-20`), end: `${Y + 1}-07-23` },
];
const holidays: Record<string, string> = { [`${Y}-09-21`]: 'Kwame Nkrumah Memorial Day', [`${Y}-12-25`]: 'Christmas Day', [`${Y + 1}-01-01`]: 'New Year’s Day', [`${Y + 1}-01-07`]: 'Constitution Day', [`${Y + 1}-03-06`]: 'Independence Day', [`${Y + 1}-05-01`]: 'May Day', [`${Y + 1}-07-01`]: 'Republic Day' };

// ---------------------------------------------------------------- people
const boys = ['Kwame', 'Kofi', 'Kwabena', 'Kwaku', 'Yaw', 'Kwasi', 'Kojo', 'Nana Kwame', 'Emmanuel', 'Samuel', 'Daniel', 'Joseph', 'Isaac', 'Prince', 'Richard', 'Michael', 'Elikem', 'Selorm', 'Nii Armah', 'Fiifi', 'Ebo', 'Yaw Boakye', 'Kekeli', 'Jeffrey', 'Bernard', 'Desmond'];
const girls = ['Ama', 'Akosua', 'Abena', 'Akua', 'Yaa', 'Afua', 'Adwoa', 'Esi', 'Efua', 'Araba', 'Nana Ama', 'Grace', 'Priscilla', 'Mercy', 'Comfort', 'Gifty', 'Abigail', 'Elorm', 'Dzifa', 'Naa Adjeley', 'Maame', 'Benedicta', 'Josephine', 'Vida', 'Ewurabena', 'Edinam'];
const surnames = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyeman', 'Appiah', 'Darko', 'Addo', 'Ofori', 'Amoah', 'Acheampong', 'Tetteh', 'Quaye', 'Lartey', 'Annan', 'Sarpong', 'Danso', 'Nyarko', 'Gyamfi', 'Frimpong', 'Adjei', 'Bonsu', 'Kusi', 'Amponsah', 'Antwi', 'Agbeko', 'Kpodo', 'Dogbe', 'Fosu', 'Ansah', 'Wiredu', 'Yeboah', 'Opoku', 'Badu', 'Asamoah'];
const classPlan = [
  { name: 'Nursery 1', level: 'Nursery', age: 3, size: 11 }, { name: 'Nursery 2', level: 'Nursery', age: 4, size: 12 },
  { name: 'KG 1', level: 'KG', age: 5, size: 13 }, { name: 'KG 2', level: 'KG', age: 6, size: 14 },
  { name: 'Basic 1', level: 'Primary', age: 7, size: 15 }, { name: 'Basic 2', level: 'Primary', age: 8, size: 14 }, { name: 'Basic 3', level: 'Primary', age: 9, size: 16 },
  { name: 'Basic 4', level: 'Primary', age: 10, size: 15 }, { name: 'Basic 5', level: 'Primary', age: 11, size: 14 }, { name: 'Basic 6', level: 'Primary', age: 12, size: 15 },
  { name: 'JHS 1', level: 'JHS', age: 13, size: 16 }, { name: 'JHS 2', level: 'JHS', age: 14, size: 15 }, { name: 'JHS 3', level: 'JHS', age: 15, size: 14 },
] as const;
const teacherNames = ['Gladys Ampofo', 'Patience Owusu', 'Rebecca Ansah', 'Felicia Tetteh', 'Augustina Badu', 'Esther Asamoah', 'Francis Yeboah', 'Doris Opoku', 'Ebenezer Kusi', 'Bright Amponsah', 'Kwesi Wiredu', 'Hannah Fosu', 'Priscilla Mensah'];
const staff = [
  { key: 'head', name: 'Samuel Owusu-Ansah', role: 'headteacher', email: `headteacher@${DOMAIN}` },
  { key: 'accountant', name: 'Joseph Kwarteng', role: 'accountant', email: `accounts@${DOMAIN}` },
  { key: 'frontdesk', name: 'Michael Tetteh', role: 'frontdesk', email: `frontdesk@${DOMAIN}` },
  ...teacherNames.map((name, i) => ({ key: `teacher${i}`, name, role: 'teacher', email: i === 12 ? `teacher@${DOMAIN}` : `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DOMAIN}` })),
];
const subjects = ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Ghanaian Language (Twi)', 'Creative Arts', 'Computing'];
const fees = [
  { name: 'Tuition', level: 'Nursery', amount: 90000 }, { name: 'Tuition', level: 'KG', amount: 95000 },
  { name: 'Tuition', level: 'Primary', amount: 115000 }, { name: 'Tuition', level: 'JHS', amount: 135000 },
  { name: 'PTA dues', amount: 5000 }, { name: 'ICT levy', level: 'Primary', amount: 8000 }, { name: 'ICT levy', level: 'JHS', amount: 8000 },
  { name: 'Examination fee', level: 'JHS', amount: 12000 }, { name: 'Learning materials', level: 'Nursery', amount: 15000 }, { name: 'Learning materials', level: 'KG', amount: 15000 },
];

// ---------------------------------------------------------------- HTTP as a signed-in person
class Person {
  cookie = ''; csrf = '';
  constructor(readonly email: string) {}
  async login() {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: PASSWORD }) });
    if (!r.ok) throw new Error(`Sign-in failed for ${this.email}: ${r.status} ${await r.text()}`);
    this.cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); this.csrf = (await r.json()).csrfToken;
    return this;
  }
  async call<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${API}/schools/${SCHOOL}${path}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, 'x-csrf-token': this.csrf }, body: method === 'GET' ? undefined : JSON.stringify({ operationId: randomUUID(), ...body }) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, body: Record<string, unknown> = {}) => this.call<T>('POST', path, body);
}
async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}
const step = (text: string) => console.log(`· ${text}`);

// ---------------------------------------------------------------- main
type Learner = { id: string; name: string; classIndex: number; enrolmentId?: string; guardian?: Guardian; ability: number; chronic: boolean };
type Guardian = { membershipId: string; userId: string; name: string; email: string };

async function main() {
  if (process.env.LOCAL_DB_NAME !== 'school_demo') throw new Error('Run with LOCAL_DB_NAME=school_demo (npm run demo:seed). The demo seed only writes to the demo database.');
  const owner = new Pool(localConfig(true));
  try {
    if ((await owner.query('SELECT 1 FROM schools WHERE id=$1', [SCHOOL])).rowCount) { console.log(`${SCHOOL_NAME} is already loaded. Use npm run demo:reset for a fresh copy.`); return; }
    for (let i = 0; i < 180; i++) { try { if ((await fetch(`${API}/auth/session`)).status < 500) break; } catch { /* API still starting */ } await new Promise(r => setTimeout(r, 1000)); }

    // Families: most learners have their own guardian, some share one (siblings). The parent persona has two children.
    const learnerPlan: { name: string; classIndex: number; dob: string; family: number }[] = [];
    const families: { name: string; surname: string }[] = [];
    const parentFamily = 0; families.push({ name: 'Grace Asante', surname: 'Asante' });
    classPlan.forEach((c, classIndex) => {
      for (let n = 0; n < c.size; n++) {
        const girl = chance(0.5);
        let family: number, surname: string;
        if (classIndex === 12 && n === 0 || classIndex === 7 && n === 0) { family = parentFamily; surname = 'Asante'; }
        else if (families.length > 3 && chance(0.12)) { family = 1 + Math.floor(rand() * (families.length - 1)); surname = families[family]!.surname; }
        else { surname = pick(surnames); family = families.length; families.push({ name: `${pick(girl ? girls : ['Ama', 'Akosua', 'Abena', 'Efua', 'Gifty', 'Mercy', 'Comfort', 'Joyce', 'Vida', 'Lydia'])} ${surname}`, surname }); }
        const first = classIndex === 12 && n === 0 ? 'Kwame' : classIndex === 7 && n === 0 ? 'Akosua' : pick(girl ? girls : boys);
        const dob = iso(new Date(Date.UTC(Y - c.age, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))));
        learnerPlan.push({ name: `${first} ${surname}`, classIndex, dob, family });
      }
    });

    step('Creating the school and its accounts');
    const salt = randomBytes(16).toString('hex'), hash = `${salt}:${scryptSync(PASSWORD, salt, 64).toString('hex')}`;
    const membership: Record<string, string> = {};
    const guardians: Guardian[] = [];
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO schools(id,name) VALUES($1,$2)', [SCHOOL, SCHOOL_NAME]);
      const addUser = async (name: string, email: string, role: string, phone: string | null) => {
        const userId = randomUUID(), membershipId = randomUUID();
        await client.query('INSERT INTO users(id,display_name,synthetic_login,password_hash,phone) VALUES($1,$2,$3,$4,$5)', [userId, name, email, hash, phone]);
        await client.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)', [membershipId, SCHOOL, userId, role]);
        return { userId, membershipId };
      };
      const phone = () => `+2332${pick(['4', '0', '6', '7'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`;
      for (const s of staff) membership[s.key] = (await addUser(s.name, s.email, s.role, phone())).membershipId;
      for (const [i, f] of families.entries()) {
        const email = i === parentFamily ? `parent@${DOMAIN}` : `guardian${i}@${DOMAIN}`;
        const ids = await addUser(f.name, email, 'guardian', phone());
        guardians.push({ ...ids, name: f.name, email });
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }

    const head = await new Person(`headteacher@${DOMAIN}`).login();
    const accountant = await new Person(`accounts@${DOMAIN}`).login();
    const frontdesk = await new Person(`frontdesk@${DOMAIN}`).login();

    step(`Academic year ${Y}/${Y + 1}, terms and classes`);
    const year = await head.post('/academic-years', { name: `${Y}/${Y + 1}`, startDate: yearStart, endDate: yearEnd });
    const terms = [] as { id: string; name: string; start: string; end: string }[];
    for (const t of termPlan) terms.push({ ...t, id: (await head.post('/assessment/terms', { academicYearId: year.id, name: t.name, startDate: t.start, endDate: t.end })).id });
    const current = terms.find(t => t.start <= TODAY && TODAY <= t.end) ?? [...terms].reverse().find(t => t.start <= TODAY) ?? terms[0]!;
    const completed = terms.filter(t => t.end < TODAY);
    const classes: { id: string; name: string; level: string }[] = [];
    for (const c of classPlan) classes.push({ id: (await head.post('/classes', { name: c.name, level: c.level, capacity: c.size + 6, academicYearId: year.id })).id, name: c.name, level: c.level });

    step(`Admitting and enrolling ${learnerPlan.length} learners`);
    const learners: Learner[] = [];
    let admissionNo = 0;
    await inBatches(learnerPlan.map(p => ({ p, number: `SIS/${Y}/${String(++admissionNo).padStart(4, '0')}` })), 8, async ({ p, number }) => {
      let a = await head.post('/admissions', { fullName: p.name, dateOfBirth: p.dob, classId: classes[p.classIndex]!.id, startDate: yearStart, admissionNumber: number });
      for (const action of ['review', 'offer', 'accept', 'enrol']) a = await head.post(`/admissions/${a.id}/transition`, { version: a.version, action });
      const detail = await head.get(`/learners/${a.learner_id}`);
      learners.push({ id: a.learner_id, name: p.name, classIndex: p.classIndex, enrolmentId: detail.enrolments[0]?.id, guardian: guardians[p.family], ability: clamp(normal(63, 13), 30, 96), chronic: chance(0.035) });
    });
    learners.sort((a, b) => a.classIndex - b.classIndex || a.name.localeCompare(b.name));
    const parentChildren = learners.filter(l => l.guardian?.email === `parent@${DOMAIN}`);
    if (parentChildren[0]) parentChildren[0].chronic = false;
    // A few new applications still waiting for a decision, so the Applications tab has work in it.
    for (const [i, name] of ['Nana Yaa Ofori', 'Kekeli Agbeko', 'Selorm Dogbe', 'Afua Badu'].entries()) {
      const a = await head.post('/admissions', { fullName: name, classId: classes[[2, 4, 10, 5][i]!]!.id, startDate: addDays(TODAY, 14), admissionNumber: `SIS/${Y}/A${String(i + 1).padStart(3, '0')}` });
      if (i < 2) await head.post(`/admissions/${a.id}/transition`, { version: a.version, action: 'review' });
    }

    step('Assigning class teachers');
    for (const [i, c] of classes.entries()) await head.post('/teaching/assignments', { classId: c.id, teacherMembershipId: membership[`teacher${i}`], startDate: yearStart, endDate: yearEnd, reason: `Class teacher for ${c.name}, approved at the staff meeting` });

    step('Verifying guardians (academic, billing, pickup and contact rights)');
    const pickupLinks = new Map<string, { id: string; version: number }>();
    await inBatches(learners.filter(l => l.guardian), 8, async l => {
      const link = await head.post('/guardian-links', { learnerId: l.id, guardianMembershipId: l.guardian!.membershipId, academic: true, billing: true, pickup: true, contact: true });
      const verified = await head.post(`/guardian-links/${link.id}/verify`, { version: link.version, reason: 'Birth certificate and guardian Ghana Card checked at admission' });
      pickupLinks.set(l.id, { id: link.id, version: verified.version ?? link.version + 1 });
    });

    step('Opening school days and taking registers');
    const attendanceStart = [current.start, addDays(TODAY, -42)].sort().pop()!;
    const days: string[] = [];
    for (let d = attendanceStart; d <= TODAY && d <= current.end; d = addDays(d, 1)) if (weekday(d)) days.push(d);
    for (const d of days) await head.post('/attendance/school-days', { day: d, isOpen: !holidays[d], reason: holidays[d] ? `Public holiday: ${holidays[d]}` : 'Normal school day' });
    const markFor = (l: Learner, d: string) => {
      const recent = d >= addDays(TODAY, -13);
      const absent = l.chronic ? (recent ? 0.45 : 0.25) : 0.035;
      const r = rand();
      return r < absent ? (chance(0.2) ? 'excused' : 'absent') : r < absent + 0.05 ? 'late' : 'present';
    };
    const registerDays = days.filter(d => !holidays[d]);
    const jobs: { c: number; d: string }[] = [];
    for (const d of registerDays) classes.forEach((_, c) => { if (d !== TODAY || c % 3 === 0 && c !== 12) jobs.push({ c, d }); });
    await inBatches(jobs, 6, async ({ c, d }) => {
      const cls = classes[c]!;
      const register = await head.get(`/attendance/classes/${cls.id}/register?day=${d}`);
      const marks = register.items.map((row: { id: string }) => ({ learnerId: row.id, mark: markFor(learners.find(l => l.id === row.id)!, d) }));
      const draft = await head.post(`/attendance/classes/${cls.id}/register`, { day: d, version: register.version, action: 'save', marks });
      const submitted = await head.post(`/attendance/classes/${cls.id}/register`, { day: d, version: draft.version, action: 'submit', marks });
      if (d < addDays(TODAY, -6)) await head.post(`/attendance/classes/${cls.id}/register`, { day: d, version: submitted.version, action: 'lock', marks });
    });

    step('Subjects, grading policy and scores');
    const subjectIds: string[] = [];
    for (const s of subjects) subjectIds.push((await head.post('/assessment/subjects', { name: s })).id);
    await head.call('PUT', '/assessment/policy', { caWeight: 30, examWeight: 70, sourceNote: 'Grading scheme approved by the Sunrise academic board for basic school terminal reports', bands: [{ min: 80, grade: 'A', remark: 'Excellent' }, { min: 70, grade: 'B', remark: 'Very good' }, { min: 60, grade: 'C', remark: 'Good' }, { min: 50, grade: 'D', remark: 'Credit' }, { min: 40, grade: 'E', remark: 'Pass' }, { min: 0, grade: 'F', remark: 'Needs support' }] });
    const graded = classes.map((c, i) => ({ ...c, i })).filter(c => c.level === 'Primary' || c.level === 'JHS');
    const score = (l: Learner, subject: number, kind: string) => Math.round(clamp(normal(l.ability + (subject % 3 - 1) * 4 + (kind === 'ca' ? 6 : 0), 9), 12, 99));
    const scoreTerm = async (term: typeof terms[number], kinds: string[], cls: typeof graded) => {
      await inBatches(cls.flatMap(c => subjectIds.map((subjectId, s) => ({ c, subjectId, s }))), 6, ({ c, subjectId, s }) => head.post(`/assessment/classes/${c.id}/scores`, { termId: term.id, subjectId, scores: learners.filter(l => l.classIndex === c.i).flatMap(l => kinds.map(kind => ({ learnerId: l.id, kind, score: score(l, s, kind) }))) }));
    };
    for (const t of completed) { await scoreTerm(t, ['ca', 'exam'], graded); for (const c of graded) await head.post(`/assessment/classes/${c.id}/publish`, { termId: t.id }); }
    if (completed.length) await scoreTerm(current, ['ca'], graded);
    else {
      // Early in the year nothing is finished yet, so a few classes have full results published to show report cards.
      const showcase = graded.filter(c => ['Basic 4', 'Basic 6', 'JHS 3'].includes(c.name));
      await scoreTerm(current, ['ca', 'exam'], showcase);
      for (const c of showcase) await head.post(`/assessment/classes/${c.id}/publish`, { termId: current.id });
      await scoreTerm(current, ['ca'], graded.filter(c => !showcase.includes(c)));
    }

    step('Fees, invoices and payments');
    for (const t of [...completed, current]) {
      for (const f of fees) await head.post('/finance/fee-items', { termId: t.id, name: f.name, amountPesewas: f.amount, ...(f.level ? { level: f.level } : {}) });
      for (const c of classes) await head.post('/finance/invoices/generate', { termId: t.id, classId: c.id });
      const invoices: { id: string; total_pesewas: number }[] = [];
      for (let offset = 0; ; offset += 100) { const page = await accountant.get(`/finance/invoices?termId=${t.id}&limit=100&offset=${offset}`); invoices.push(...page.items); if (page.items.length < 100) break; }
      const done = t !== current, last = [t.end, addDays(TODAY, -1)].sort()[0]!;
      await inBatches(invoices, 6, async inv => {
        const r = rand(), share = done ? (r < 0.86 ? 1 : r < 0.95 ? 0.5 : 0) : (r < 0.42 ? 1 : r < 0.72 ? 0.4 + rand() * 0.3 : 0);
        let left = Math.round(inv.total_pesewas * share / 100) * 100;
        const parts = left === inv.total_pesewas && chance(0.35) ? 2 : 1;
        for (let p = 0; p < parts && left > 0; p++) {
          const amount = p === parts - 1 ? left : Math.round(left / 2 / 100) * 100;
          // Most families pay in the first weeks of term; a second instalment follows a few weeks later.
          const span = Math.max(0, Math.round((day(last).getTime() - day(t.start).getTime()) / 864e5));
          const receivedOn = addDays(t.start, Math.min(span, Math.floor(rand() * Math.min(span + 1, 30)) + p * 21));
          const method = pick(['mobile_money', 'mobile_money', 'mobile_money', 'cash', 'cash', 'bank']);
          const reference = method === 'mobile_money' ? `MoMo ${Math.floor(1e9 + rand() * 9e9)}` : method === 'bank' ? `GCB slip ${Math.floor(10000 + rand() * 89999)}` : undefined;
          await accountant.post('/finance/payments', { invoiceId: inv.id, amountPesewas: amount, method, receivedOn, ...(reference ? { reference } : {}) });
          left -= amount;
        }
      });
    }

    step('Notices to guardians');
    const notice = async (title: string, body: string, classId?: string, approve = true) => {
      const n = await head.post('/notices', { title, body, audience: classId ? 'class' : 'school', ...(classId ? { classId } : {}) });
      if (approve) await head.post(`/notices/${n.id}/approve`, { version: n.version });
    };
    await notice('PTA general meeting', `Dear parents, the PTA general meeting is on Saturday at 9:00 am in the school hall. We will discuss the ${current.name} budget and the new school bus.`);
    await notice('Mid-term break', `School closes for mid-term break on Friday at 12:00 noon and reopens on Tuesday. Please pick your children up on time.`);
    await notice('JHS 3 mock examinations', 'JHS 3 mock examinations start next Monday. Learners must bring their exam card, a mathematical set and two pens.', classes[12]!.id);
    await notice('Inter-house sports day', 'Our inter-house sports day is coming up. Each learner should come in their house T-shirt and bring a water bottle.', undefined, false);

    step('Early years observation guides and observations');
    const indicators = [
      ['LL-01', 'Listens to and retells a short story', 'Language and literacy', 'Oral language', 'Listening and speaking', ['Listens to a story to the end', 'Retells the story with prompts', 'Retells the story in order']],
      ['NUM-01', 'Counts objects up to 10', 'Numeracy', 'Number', 'Counting', ['Counts objects with help', 'Counts up to 10 objects correctly', 'Counts beyond 10 confidently']],
      ['PD-01', 'Uses scissors and crayons with control', 'Physical development', 'Fine motor skills', 'Hand control', ['Holds crayons and scissors', 'Cuts along a straight line', 'Colours within lines']],
      ['SE-01', 'Shares and takes turns with peers', 'Social and emotional', 'Relationships', 'Cooperation', ['Plays beside peers', 'Takes turns with reminders', 'Shares without reminders']],
      ['CA-01', 'Expresses ideas through drawing and song', 'Creative arts', 'Expression', 'Drawing and music', ['Draws simple shapes', 'Sings familiar songs', 'Explains own drawing']],
    ] as const;
    const policies: Record<string, { id: string; indicators: { id: string; descriptors: { id: string }[] }[] }> = {};
    for (const level of ['Nursery', 'KG']) {
      const created = await head.post('/early-years/policies', {
        level, title: `${level} observation guide`, sourceKind: 'school_local', sourceIssuer: 'Sunrise early years team', sourceReference: `Sunrise ${level} learning goals, reviewed ${Y}`, sourceVersion: `${Y}-1`, effectiveStart: addDays(yearStart, -7),
        ...(level === 'Nursery' ? { specialistName: 'Mrs. Adwoa Frimpong', specialistQualification: 'Early childhood development specialist, University of Education, Winneba', specialistReviewReference: 'Academic board minute 4', specialistReviewedOn: addDays(yearStart, -14) } : {}),
        indicators: indicators.map(([code, title, learningArea, strand, subStrand, descriptors]) => ({ code, title, learningArea, strand, subStrand, descriptors: descriptors.map(text => ({ id: randomUUID(), text })) })),
      });
      await head.post(`/early-years/policies/${created.id}/approve`, { version: created.version });
      const listed = (await head.get(`/early-years/policies?level=${level}`));
      const full = (listed.items ?? listed).find((p: { id: string }) => p.id === created.id) ?? created;
      policies[level] = full;
    }
    const observationDays = registerDays.filter(d => d < TODAY).slice(-15);
    for (const [i, c] of classes.entries()) {
      if (c.level !== 'Nursery' && c.level !== 'KG') continue;
      const teacher = await new Person(staff[3 + i]!.email).login();
      const policy = policies[c.level]!;
      await inBatches(learners.filter(l => l.classIndex === i && l.enrolmentId), 4, async l => {
        for (const observedOn of [pick(observationDays.slice(0, 7)), pick(observationDays.slice(7))].filter(Boolean)) {
          const entries = policy.indicators.filter(() => chance(0.6)).map(ind => { const seen = chance(0.85); return { indicatorId: ind.id, status: seen ? 'observed' : 'not_observed', ...(seen ? { descriptorId: pick(ind.descriptors).id, evidence: pick(['Seen during morning circle time', 'Noted during group play', 'Observed in the craft corner', 'Seen during story time']) } : {}) }; });
          if (entries.length) await teacher.post(`/early-years/classes/${c.id}/observations`, { learnerId: l.id, enrolmentId: l.enrolmentId, observedOn, policyId: policy.id, entries });
        }
      });
    }

    step('Early years progress reports');
    // A few reports per class at different stages, so the review queue and the families' view both show something.
    // A report period may only cover locked registers, and the loader locks registers older than six days.
    const reportDays = observationDays.filter(d => d < addDays(TODAY, -6));
    const reportStart = reportDays[0], reportEnd = reportDays[reportDays.length - 1];
    const reportTexts = [
      ['Listens closely at story time and retells familiar stories with growing confidence. Counts objects to ten during play.', 'Practise retelling stories in order at home, and count everyday things together, such as cups or steps.'],
      ['Takes turns with friends and joins group games happily. Holds crayons with good control and colours within lines.', 'Encourage cutting along straight lines and naming shapes while drawing.'],
      ['Sings familiar songs and explains own drawings in short sentences. Shares materials with reminders.', 'Give chances to share without reminders and to talk about pictures in longer sentences.'],
    ] as const;
    if (reportStart && reportEnd) for (const [i, c] of classes.entries()) {
      if (c.level !== 'Nursery' && c.level !== 'KG') continue;
      const teacher = await new Person(staff[3 + i]!.email).login();
      for (const [n, l] of learners.filter(l => l.classIndex === i && l.enrolmentId).slice(0, 3).entries()) {
        const [strengths, nextSteps] = reportTexts[n]!;
        const report = await teacher.post('/early-years/reports', { learnerId: l.id, enrolmentId: l.enrolmentId, periodStart: reportStart, periodEnd: reportEnd, strengths, nextSteps });
        if (n === 2) continue; // stays a draft
        const base = `/early-years/report-revisions/${report.revisionId}`;
        let version = (await teacher.post(`${base}/submit`, { version: report.version })).version;
        if (n === 1) continue; // waits for the headteacher's review
        version = (await head.post(`${base}/approve`, { version })).version;
        await head.post(`${base}/publish`, { version });
      }
    }

    step('Pickup records at the gate');
    if (weekday(TODAY) && !holidays[TODAY]) {
      for (const l of learners.filter(l => l.classIndex <= 4).slice(0, 40).filter(() => chance(0.3)).slice(0, 8)) {
        const link = pickupLinks.get(l.id); if (!link) continue;
        const detail = await frontdesk.get(`/learners/${l.id}`).catch(() => head.get(`/learners/${l.id}`));
        await frontdesk.post(`/collection/learners/${l.id}/release`, { learnerVersion: detail.version ?? 1, guardianLinkId: link.id, guardianLinkVersion: link.version, verificationReason: 'Guardian recognised and Ghana Card checked at the gate' });
      }
    }

    console.log(`\n${SCHOOL_NAME} is ready: ${learners.length} learners in ${classes.length} classes, ${current.name} of ${Y}/${Y + 1}.`);
    console.log(`Sign in with any of these (password ${PASSWORD}):`);
    for (const [who, email] of [['Headteacher', `headteacher@${DOMAIN}`], ['Class teacher (JHS 3)', `teacher@${DOMAIN}`], ['Accountant', `accounts@${DOMAIN}`], ['Front desk', `frontdesk@${DOMAIN}`], ['Parent (two children)', `parent@${DOMAIN}`]]) console.log(`  ${who.padEnd(24)} ${email}`);
  } finally { await owner.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
