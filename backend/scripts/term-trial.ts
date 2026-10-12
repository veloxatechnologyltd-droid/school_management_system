import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

// School-term trial: runs a Ghanaian KG–JHS school through one full term against a running API (normally the Supabase
// database in cloud mode), the way its staff would: sign-up, setup, enrolment, daily registers, fees, scores, reports,
// notices and the year-end roll-over. Every write goes through the API, so the normal rules, versions and audit apply.
// Phases run one at a time and keep their state (ids and trial passwords) in .local/term-trial/state.json:
//   npx tsx scripts/term-trial.ts setup|enrol|term|exams|close|status
// The term replayed is Term 3 of 2025/26 (20 April – 24 July 2026), the latest term that has fully ended.

const API = process.env.TRIAL_API ?? 'http://127.0.0.1:3018/api/v1';
const STATE = path.resolve(__dirname, '../../.local/term-trial/state.json');
const DOMAIN = 'nkabom-trial.test';
const SCHOOL_NAME = 'Nkabom Basic School (Trial)';

// ---------------------------------------------------------------- deterministic randomness
let seed = 20260420;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const chance = (p: number) => rand() < p;
const normal = (mean: number, sd: number) => { const u = Math.max(rand(), 1e-9), v = rand(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------- calendar (Africa/Accra is UTC)
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
const weekday = (s: string) => { const w = day(s).getUTCDay(); return w > 0 && w < 6; };
const YEAR = { name: '2025/2026', start: '2025-09-08', end: '2026-08-14' };
const TERMS = [
  { name: 'Term 1', start: '2025-09-08', end: '2025-12-18' },
  { name: 'Term 2', start: '2026-01-13', end: '2026-04-02' },
  { name: 'Term 3', start: '2026-04-20', end: '2026-07-24' },
];
const NEXT_YEAR = { name: '2026/2027', start: '2026-09-07', end: '2027-08-13', term1: { name: 'Term 1', start: '2026-09-08', end: '2026-12-17' } };
const CLOSED: Record<string, string> = {
  '2026-05-01': 'Public holiday: May Day', '2026-05-27': 'Public holiday: Eid al-Adha',
  '2026-06-04': 'Mid-term break', '2026-06-05': 'Mid-term break', '2026-07-01': 'Public holiday: Republic Day',
};
const BECE_LAST_DAY = '2026-06-12';
// Teachers act only on classes they are assigned to today, and assignments end with the academic year. The replayed
// Term 3 is in the past, so its teacher-scoped entries (registers, scores) are made by the headteacher; teachers then
// work under their own live assignments in Term 1 of 2026/27, which runs with real dates up to today.
const HANDOVER = YEAR.end;

// ---------------------------------------------------------------- people and plan
const boys = ['Kwame', 'Kofi', 'Kwabena', 'Kwaku', 'Yaw', 'Kwasi', 'Kojo', 'Emmanuel', 'Samuel', 'Daniel', 'Joseph', 'Isaac', 'Prince', 'Richard', 'Michael', 'Elikem', 'Selorm', 'Nii Armah', 'Fiifi', 'Ebo', 'Kekeli', 'Jeffrey', 'Bernard', 'Desmond', 'Ibrahim', 'Abdul-Rahman', 'Mubarak'];
const girls = ['Ama', 'Akosua', 'Abena', 'Akua', 'Yaa', 'Afua', 'Adwoa', 'Esi', 'Efua', 'Araba', 'Grace', 'Priscilla', 'Mercy', 'Comfort', 'Gifty', 'Abigail', 'Elorm', 'Dzifa', 'Naa Adjeley', 'Maame', 'Benedicta', 'Josephine', 'Vida', 'Ewurabena', 'Edinam', 'Fatima', 'Rahinatu'];
const surnames = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyeman', 'Appiah', 'Darko', 'Addo', 'Ofori', 'Amoah', 'Acheampong', 'Tetteh', 'Quaye', 'Lartey', 'Annan', 'Sarpong', 'Danso', 'Nyarko', 'Gyamfi', 'Frimpong', 'Adjei', 'Bonsu', 'Kusi', 'Amponsah', 'Antwi', 'Agbeko', 'Kpodo', 'Dogbe', 'Fosu', 'Ansah', 'Wiredu', 'Yeboah', 'Opoku', 'Badu', 'Asamoah', 'Mohammed', 'Issah'];
const CLASSES = [
  { name: 'KG 1', level: 'KG', age: 4, size: 18 }, { name: 'KG 2', level: 'KG', age: 5, size: 20 },
  { name: 'Basic 1', level: 'Primary', age: 6, size: 24 }, { name: 'Basic 2', level: 'Primary', age: 7, size: 23 }, { name: 'Basic 3', level: 'Primary', age: 8, size: 25 },
  { name: 'Basic 4', level: 'Primary', age: 9, size: 22 }, { name: 'Basic 5', level: 'Primary', age: 10, size: 24 }, { name: 'Basic 6', level: 'Primary', age: 11, size: 21 },
  { name: 'JHS 1', level: 'JHS', age: 12, size: 26 }, { name: 'JHS 2', level: 'JHS', age: 13, size: 24 }, { name: 'JHS 3', level: 'JHS', age: 14, size: 22 },
] as const;
const CLASS_TEACHERS = ['Patience Owusu', 'Rebecca Ansah', 'Felicia Tetteh', 'Augustina Badu', 'Esther Asamoah', 'Francis Yeboah', 'Doris Opoku', 'Ebenezer Kusi', 'Bright Amponsah', 'Kwesi Wiredu', 'Hannah Fosu'];
const SUBJECT_TEACHERS = [{ name: 'Isaac Boakye', teaches: 'Mathematics and Integrated Science, JHS 1–3' }, { name: 'Akosua Dede Lartey', teaches: 'French and Computing, JHS 1–3' }];
const PRIMARY_SUBJECTS = ['English Language', 'Mathematics', 'Science', 'Our World Our People', 'Religious and Moral Education', 'Ghanaian Language (Fante)', 'Creative Arts', 'Computing', 'History'];
const KG_SUBJECTS = ['Language and Literacy', 'Numeracy', 'Our World Our People', 'Creative Arts'];
const JHS_SUBJECTS = ['English Language', 'Mathematics', 'Integrated Science', 'Social Studies', 'Religious and Moral Education', 'Ghanaian Language (Fante)', 'French', 'Career Technology', 'Creative Arts and Design', 'Computing'];
const FEES = [
  { name: 'Tuition', level: 'KG', amount: 85000 }, { name: 'Tuition', level: 'Primary', amount: 105000 }, { name: 'Tuition', level: 'JHS', amount: 125000 },
  { name: 'PTA dues', amount: 4000 }, { name: 'ICT levy', level: 'Primary', amount: 6000 }, { name: 'ICT levy', level: 'JHS', amount: 6000 },
  { name: 'Sports and culture', amount: 3000 }, { name: 'Learning materials', level: 'KG', amount: 12000 }, { name: 'BECE mock examination', level: 'JHS', amount: 10000 },
];

// ---------------------------------------------------------------- state
type Account = { name: string; email: string; password: string; role: string; userId?: string; membershipId?: string; teaches?: string };
type Learner = { id: string; name: string; classIndex: number; admissionNumber: string; dob: string; enrolmentId?: string; family: number; ability: number; chronic: boolean; left?: string };
type State = {
  schoolId?: string; accounts: Record<string, Account>; yearId?: string; termIds: Record<string, string>;
  classIds: string[]; subjectIds: Record<string, string>; learners: Learner[]; families: { name: string; surname: string; phone: string; email?: string; account?: string }[];
  assignments: { id: string; classIndex: number; teacher: string }[]; done: string[]; findings: string[]; log: string[];
  nextYearId?: string; nextClassIds?: string[]; evidence?: Record<string, unknown>;
};
const load = (): State => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { accounts: {}, termIds: {}, classIds: [], subjectIds: {}, learners: [], families: [], assignments: [], done: [], findings: [], log: [] };
let state = load();
const save = () => { mkdirSync(path.dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };
const step = (text: string) => { console.log(`· ${text}`); state.log.push(`${new Date().toISOString()} ${text}`); };
const finding = (text: string) => { console.log(`! ${text}`); if (!state.findings.includes(text)) state.findings.push(text); };
const strongPassword = () => `Nkb-${randomBytes(9).toString('base64url')}-26`;

// ---------------------------------------------------------------- HTTP as a signed-in person
class Person {
  cookie = ''; csrf = '';
  constructor(readonly account: Account) {}
  private async auth(route: string, body: unknown) {
    const r = await fetch(`${API}/auth/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: this.cookie, ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(`auth/${route} for ${this.account.email} → ${r.status} ${text.slice(0, 300)}`);
    const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]);
    if (cookies.length) this.cookie = cookies.join('; ');
    const json = text ? JSON.parse(text) : {};
    if (json.csrfToken) this.csrf = json.csrfToken;
    return json;
  }
  async login() {
    await this.auth('login', { email: this.account.email, password: this.account.password });
    const session = await this.session();
    if (session.mustChangePassword) {
      const next = strongPassword();
      await this.auth('change-password', { currentPassword: this.account.password, newPassword: next });
      this.account.password = next; save();
      await this.auth('login', { email: this.account.email, password: next });
    }
    return this;
  }
  register(schoolName: string) { return this.auth('register', { name: this.account.name, schoolName, email: this.account.email, password: this.account.password }); }
  async session() { const r = await fetch(`${API}/auth/session`, { headers: { cookie: this.cookie } }); return r.json(); }
  async call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', route: string, body?: Record<string, unknown>, raw = false): Promise<T> {
    // The same operationId on every attempt, so a retried command replays its receipt instead of repeating it.
    const payload = method === 'GET' ? undefined : JSON.stringify(route.startsWith('/accounts') || route === '' ? body ?? {} : { operationId: randomUUID(), ...body });
    for (let attempt = 1; ; attempt++) {
      let r: Response;
      try { r = await fetch(`${API}/schools/${state.schoolId}${route}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, 'x-csrf-token': this.csrf }, body: payload }); }
      catch (error) { if (attempt < 4) { await new Promise(res => setTimeout(res, 3000 * attempt)); continue; } throw error; }
      const text = await r.text();
      if (r.status >= 500 && attempt < 4 && (method === 'GET' || !route.startsWith('/accounts'))) { await new Promise(res => setTimeout(res, 3000 * attempt)); continue; }
      if (!r.ok) throw Object.assign(new Error(`${this.account.role} ${method} ${route} → ${r.status} ${text.slice(0, 300)}`), { status: r.status, body: text });
      return (raw ? text : text ? JSON.parse(text) : null) as T;
    }
  }
  get = <T = any>(route: string) => this.call<T>('GET', route);
  post = <T = any>(route: string, body: Record<string, unknown> = {}) => this.call<T>('POST', route, body);
}
async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}
const sessions = new Map<string, Person>();
async function as(key: string) {
  if (!sessions.has(key)) { const account = state.accounts[key]; if (!account) throw new Error(`No trial account ${key}`); sessions.set(key, await new Person(account).login()); }
  return sessions.get(key)!;
}
async function all<T = any>(person: Person, route: string) {
  const items: T[] = [];
  for (let offset = 0; ; offset += 100) { const page = await person.get(`${route}${route.includes('?') ? '&' : '?'}limit=100&offset=${offset}`); items.push(...page.items); if (page.items.length < 100) break; }
  return items;
}
const phone = () => `0${pick(['24', '54', '55', '20', '50', '27', '57', '26'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`;
const teacherKey = (i: number) => `teacher${i}`;

// ---------------------------------------------------------------- phase: setup
async function setup() {
  if (!state.schoolId) {
    step(`Headteacher signs up ${SCHOOL_NAME}`);
    state.accounts.head = { name: 'Comfort Adjei-Mensah', email: `head@${DOMAIN}`, password: strongPassword(), role: 'headteacher' };
    const head = new Person(state.accounts.head);
    await head.register(SCHOOL_NAME);
    const session = await head.session();
    state.schoolId = session.schools.find((s: { name: string }) => s.name === SCHOOL_NAME)?.id;
    if (!state.schoolId) throw new Error('Sign-up did not return the new school');
    sessions.set('head', head); save();
  }
  const head = await as('head');

  step('Staff accounts: bursar, front desk, class teachers and JHS subject teachers');
  const wanted: [string, Omit<Account, 'password'>][] = [
    ['bursar', { name: 'Joseph Kwarteng', email: `bursar@${DOMAIN}`, role: 'accountant' }],
    ['frontdesk', { name: 'Linda Acquah', email: `frontdesk@${DOMAIN}`, role: 'frontdesk' }],
    ...CLASS_TEACHERS.map((name, i) => [teacherKey(i), { name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DOMAIN}`, role: 'teacher' }] as [string, Omit<Account, 'password'>]),
    ...SUBJECT_TEACHERS.map((t, i) => [`subject${i}`, { name: t.name, email: `${t.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DOMAIN}`, role: 'teacher', teaches: t.teaches }] as [string, Omit<Account, 'password'>]),
  ];
  for (const [key, a] of wanted) {
    if (state.accounts[key]) continue;
    const created = await head.post('/accounts', { name: a.name, email: a.email, role: a.role });
    state.accounts[key] = { ...a, password: created.temporaryPassword, userId: created.userId }; save();
    await head.call('POST', `/accounts/${created.userId}/phone`, { phone: phone() });
  }
  const staffList = (await head.get('/accounts')).items as { user_id: string; membership_id: string; login: string }[];
  for (const a of Object.values(state.accounts)) { const row = staffList.find(s => s.login === a.email); if (row) { a.userId = row.user_id; a.membershipId = row.membership_id; } }
  save();

  if (!state.yearId) {
    step(`Academic year ${YEAR.name} and its three terms`);
    state.yearId = (await head.post('/academic-years', { name: YEAR.name, startDate: YEAR.start, endDate: YEAR.end })).id; save();
  }
  for (const t of TERMS) if (!state.termIds[t.name]) { state.termIds[t.name] = (await head.post('/assessment/terms', { academicYearId: state.yearId, name: t.name, startDate: t.start, endDate: t.end })).id; save(); }

  if (state.classIds.length < CLASSES.length) {
    step('Classes KG 1 – JHS 3');
    for (const [i, c] of CLASSES.entries()) if (!state.classIds[i]) { state.classIds[i] = (await head.post('/classes', { name: c.name, level: c.level, capacity: c.size + 8, academicYearId: state.yearId })).id; save(); }
  }

  step('Subjects and the grading policy (GES 30% class score, 70% examination)');
  for (const s of new Set([...KG_SUBJECTS, ...PRIMARY_SUBJECTS, ...JHS_SUBJECTS])) if (!state.subjectIds[s]) { state.subjectIds[s] = (await head.post('/assessment/subjects', { name: s })).id; save(); }
  const policy = await head.get('/assessment/policy');
  if (!policy?.policy) await head.call('PUT', '/assessment/policy', {
    caWeight: 30, examWeight: 70, sourceNote: 'GES basic school terminal report: class score 30%, end-of-term examination 70%; bands adopted by the staff meeting of 14 April 2026',
    bands: [{ min: 80, grade: '1', remark: 'Highest' }, { min: 70, grade: '2', remark: 'Higher' }, { min: 60, grade: '3', remark: 'High' }, { min: 55, grade: '4', remark: 'High average' }, { min: 50, grade: '5', remark: 'Average' }, { min: 45, grade: '6', remark: 'Low average' }, { min: 40, grade: '7', remark: 'Low' }, { min: 35, grade: '8', remark: 'Lower' }, { min: 0, grade: '9', remark: 'Lowest' }],
  });

  step('Teaching assignments (class teachers, and the JHS subject teachers on JHS 1–3)');
  const existing = (await head.get('/teaching/assignments?limit=100')).items ?? [];
  if (!state.assignments.length || existing.length < CLASSES.length) {
    for (const [i, c] of CLASSES.entries()) {
      const teacher = state.accounts[teacherKey(i)]!;
      const a = await head.post('/teaching/assignments', { classId: state.classIds[i], teacherMembershipId: teacher.membershipId, startDate: TERMS[2]!.start, endDate: HANDOVER, reason: `Class teacher for ${c.name}, Term 3 (staff meeting 14 April 2026)` });
      state.assignments.push({ id: a.id, classIndex: i, teacher: teacherKey(i) });
    }
    for (const [s] of SUBJECT_TEACHERS.entries()) for (const i of [8, 9, 10]) {
      const a = await head.post('/teaching/assignments', { classId: state.classIds[i], teacherMembershipId: state.accounts[`subject${s}`]!.membershipId, startDate: TERMS[2]!.start, endDate: HANDOVER, reason: `Subject teacher (${SUBJECT_TEACHERS[s]!.teaches})` });
      state.assignments.push({ id: a.id, classIndex: i, teacher: `subject${s}` });
    }
    save();
  }

  step('Term 3 fee items');
  const items = (await head.get(`/finance/fee-items?termId=${state.termIds['Term 3']}`)).items ?? [];
  if (!items.length) for (const f of FEES) await head.post('/finance/fee-items', { termId: state.termIds['Term 3'], name: f.name, amountPesewas: f.amount, ...(f.level ? { level: f.level } : {}) });
  state.done.push('setup'); save();
}

// ---------------------------------------------------------------- phase: enrol
async function enrol() {
  const head = await as('head');
  if (!state.learners.length) {
    step('Existing learners (enrolled since Term 1) brought in from the old Excel register, one class per CSV');
    const families: State['families'] = [];
    const plan: Omit<Learner, 'id'>[] = [];
    let n = 0;
    CLASSES.forEach((c, classIndex) => {
      for (let k = 0; k < c.size; k++) {
        const girl = chance(0.5);
        let family: number;
        if (families.length > 5 && chance(0.15)) family = Math.floor(rand() * families.length);
        else { const surname = pick(surnames); family = families.length; families.push({ name: `${pick(['Mr.', 'Mrs.', 'Madam', 'Mr.'])} ${pick(girl ? girls : boys).split(' ')[0]} ${surname}`, surname, phone: phone(), ...(chance(0.55) ? { email: `family${family}@${DOMAIN}` } : {}) }); }
        const dob = iso(new Date(Date.UTC(2026 - c.age - 1, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))));
        plan.push({ name: `${pick(girl ? girls : boys)} ${families[family]!.surname}`, classIndex, dob, admissionNumber: `NBS/${String(2025 - classIndex).slice(-2)}/${String(++n).padStart(4, '0')}`, family, ability: clamp(normal(60, 14), 25, 97), chronic: chance(0.04) });
      }
    });
    state.families = families;
    for (const [classIndex, c] of CLASSES.entries()) {
      const rows = plan.filter(p => p.classIndex === classIndex);
      // The old register is an Excel export: DD/MM/YYYY dates, mixed column order.
      const csv = ['Name of Pupil,Admission No.,Date of Birth', ...rows.map(r => `${r.name},${r.admissionNumber},${r.dob.slice(8, 10)}/${r.dob.slice(5, 7)}/${r.dob.slice(0, 4)}`)].join('\n');
      let batch = await head.post('/learner-imports', { sourceName: `${c.name} register 2025-26.csv`, classId: state.classIds[classIndex], startDate: YEAR.start, dateFormat: 'dmy', csv });
      batch = await head.post(`/learner-imports/${batch.id}/validate`, { version: batch.version });
      const detail = await head.get(`/learner-imports/${batch.id}`);
      const problems = (detail.rows ?? []).filter((r: { validation?: { issues?: string[] } }) => r.validation?.issues?.length);
      if (problems.length) finding(`Import ${c.name}: ${problems.length} row(s) flagged: ${JSON.stringify(problems.slice(0, 2).map((r: { validation: unknown }) => r.validation)).slice(0, 300)}`);
      const selectable = (detail.rows ?? []).filter((r: { validation?: { issues?: string[] } }) => !r.validation?.issues?.length);
      const committed = await head.post(`/learner-imports/${batch.id}/commit`, { version: detail.version, approvalReason: `Checked against the ${c.name} admission register by the headteacher`, selectedRows: selectable.map((r: { row_number: number }) => ({ rowNumber: r.row_number })) });
      step(`  ${c.name}: ${JSON.stringify(committed).slice(0, 160)}`);
    }
    const roll = await all(head, '/learners?');
    for (const p of plan) {
      const found = roll.find((l: { admission_number: string }) => l.admission_number === p.admissionNumber);
      if (!found) { finding(`Imported learner ${p.admissionNumber} not on the roll`); continue; }
      state.learners.push({ id: found.id, ...p });
    }
    save();
  }
  step(`Roll: ${state.learners.length} learners`);
  state.done.push('enrol'); save();
}

// ---------------------------------------------------------------- phase: guardians
async function guardians() {
  const head = await as('head');
  step('Guardian accounts and verified links (birth certificate / Ghana Card checked by the headteacher)');
  // Families with an email sign in with it; the rest (built after the first run found them locked out) use their mobile number.
  const known = new Map(((await head.get('/accounts')).items as { user_id: string; login: string }[]).map(a => [a.login, a.user_id]));
  for (const [i, f] of state.families.entries()) {
    if (f.account) continue;
    const login = f.email ?? `+233${f.phone.slice(1)}`;
    if (known.has(login)) { finding(`Account ${login} already existed (an earlier attempt was interrupted); its password had to be reset`); }
    const created = known.has(login) ? { userId: known.get(login)!, temporaryPassword: (await head.post(`/accounts/${known.get(login)}/reset-password`)).temporaryPassword } : await head.post('/accounts', { name: f.name, email: f.email ?? f.phone, role: 'guardian' });
    if (f.email) await head.call('POST', `/accounts/${created.userId}/phone`, { phone: f.phone });
    state.accounts[`family${i}`] = { name: f.name, email: login, password: created.temporaryPassword, role: 'guardian', userId: created.userId };
    f.account = `family${i}`; save();
  }
  const staffList = (await head.get('/accounts')).items as { user_id: string; membership_id: string; login: string }[];
  for (const a of Object.values(state.accounts)) { const row = staffList.find(s => s.login === a.email); if (row) a.membershipId = row.membership_id; }
  const linked = new Set(((await head.get('/guardian-links?limit=100')).items ?? []).map((l: { learner_id: string }) => l.learner_id));
  await inBatches(state.learners.filter(l => state.families[l.family]?.account && !linked.has(l.id)), 6, async l => {
    const guardian = state.accounts[state.families[l.family]!.account!]!;
    const link = await head.post('/guardian-links', { learnerId: l.id, guardianMembershipId: guardian.membershipId, academic: true, billing: true, pickup: true, contact: true });
    await head.post(`/guardian-links/${link.id}/verify`, { version: link.version, reason: 'Birth certificate and guardian Ghana Card checked against the admission file' });
  });
  save();
}

// ---------------------------------------------------------------- phase: term (every school day of Term 3)
const termDays = () => { const out: string[] = []; for (let d = TERMS[2]!.start; d <= TERMS[2]!.end; d = addDays(d, 1)) if (weekday(d)) out.push(d); return out; };
const activeOn = (l: Learner, d: string) => !l.left || d < l.left;
async function term() {
  const head = await as('head'), bursar = await as('bursar');
  const termId = state.termIds['Term 3']!;
  if (!state.done.includes('term:start')) {
    step('First day: new admissions for Term 3');
    const newcomers = [{ name: 'Nana Yaw Boateng', classIndex: 2, dob: '2019-03-14' }, { name: 'Elorm Kpodo', classIndex: 5, dob: '2016-07-02' }, { name: 'Fatima Issah', classIndex: 8, dob: '2013-11-21' }];
    for (const [k, p] of newcomers.entries()) {
      if (state.learners.some(l => l.name === p.name)) continue;
      let a = await head.post('/admissions', { fullName: p.name, dateOfBirth: p.dob, classId: state.classIds[p.classIndex], startDate: TERMS[2]!.start, admissionNumber: `NBS/26/N${String(k + 1).padStart(3, '0')}` });
      for (const action of ['review', 'offer', 'accept', 'enrol']) a = await head.post(`/admissions/${a.id}/transition`, { version: a.version, action });
      const family = state.families.length; state.families.push({ name: `Mrs. ${pick(girls)} ${p.name.split(' ').pop()}`, surname: p.name.split(' ').pop()!, phone: phone(), email: `family${family}@${DOMAIN}` });
      state.learners.push({ id: a.learner_id, name: p.name, classIndex: p.classIndex, admissionNumber: a.admission_number ?? `NBS/26/N${k + 1}`, dob: p.dob, family, ability: clamp(normal(58, 12), 30, 95), chronic: false });
    }
    save();
    await guardians();
    step('Term 3 bills: invoices for every class');
    for (const id of state.classIds) await head.post('/finance/invoices/generate', { termId, classId: id });
    step('Welcome-back notice to all families');
    const n = await head.post('/notices', { title: 'Welcome back: Term 3', body: 'Dear parents, school reopens on Monday 20 April 2026. Term 3 fees are due by Friday 15 May. Vacation is Friday 24 July. Thank you.', audience: 'school' });
    await head.post(`/notices/${n.id}/approve`, { version: n.version });
    state.done.push('term:start'); save();
  }

  let invoices = await all(bursar, `/finance/invoices?termId=${termId}`);
  // Each family's paying habit for the term: most pay in full early or in two instalments, some late, a few not at all.
  const habit = new Map(invoices.map((inv: { id: string }) => { const r = rand(); return [inv.id, r < 0.45 ? 'early' : r < 0.75 ? 'instalments' : r < 0.9 ? 'late' : 'none']; }));
  let paid = new Map<string, number>();
  const days = termDays();
  for (const [index, d] of days.entries()) {
    if (state.done.includes(`day:${d}`)) continue;
    const reason = CLOSED[d];
    // A day already opened by an interrupted run is left as it is.
    await head.post('/attendance/school-days', { day: d, isOpen: !reason, reason: reason ?? 'Normal school day' }).catch(error => { if ((error as { status?: number }).status !== 409) throw error; });
    if (!reason) {
      const classes = state.classIds.map((id, i) => ({ id, i })).filter(c => !(c.i === 10 && d > BECE_LAST_DAY));
      await inBatches(classes, 6, async c => {
        const register = await head.get(`/attendance/classes/${c.id}/register?day=${d}`);
        if (register.status && register.status !== 'draft') return;
        const marks = register.items.map((row: { id: string }) => {
          const l = state.learners.find(x => x.id === row.id);
          const absent = l?.chronic ? 0.28 : 0.04, r = rand();
          return { learnerId: row.id, mark: r < absent ? (chance(0.25) ? 'excused' : 'absent') : r < absent + 0.06 ? 'late' : 'present' };
        });
        const draft = await head.post(`/attendance/classes/${c.id}/register`, { day: d, version: register.version, action: 'save', marks });
        await head.post(`/attendance/classes/${c.id}/register`, { day: d, version: draft.version, action: 'submit', marks });
      });
    }
    // Fridays (or the last day of the term): the headteacher reviews and locks the week's registers.
    if (day(d).getUTCDay() === 5 || index === days.length - 1) {
      const week = days.slice(Math.max(0, index - 4), index + 1).filter(w => !CLOSED[w]);
      for (const w of week) await inBatches(state.classIds.map((id, i) => ({ id, i })).filter(c => !(c.i === 10 && w > BECE_LAST_DAY)), 6, async c => {
        const register = await head.get(`/attendance/classes/${c.id}/register?day=${w}`);
        if (register.status === 'submitted') await head.post(`/attendance/classes/${c.id}/register`, { day: w, version: register.version, action: 'lock', marks: register.items.map((row: { id: string; mark: string }) => ({ learnerId: row.id, mark: row.mark })) });
      });
    }
    // Fees come in at the bursar's desk, mostly in the first four weeks. Bills are re-read so discounts and charges count.
    invoices = (await all(bursar, `/finance/invoices?termId=${termId}`)).map((inv: { due_pesewas: number }) => ({ ...inv, total_pesewas: inv.due_pesewas }));
    paid = new Map(invoices.map((inv: { id: string; paid_pesewas: number }) => [inv.id, inv.paid_pesewas]));
    const weekNo = Math.floor(index / 5);
    await inBatches(invoices.filter((inv: { id: string }) => {
      const h = habit.get(inv.id), left = inv.total_pesewas - (paid.get(inv.id) ?? 0);
      if (left <= 0 || h === 'none') return false;
      if (h === 'early') return weekNo < 4 && chance(0.12);
      if (h === 'instalments') return (weekNo < 3 || (weekNo >= 6 && weekNo < 10)) && chance(0.07);
      return weekNo >= 8 && chance(0.05);
    }) as { id: string; total_pesewas: number }[], 4, async inv => {
      const left = inv.total_pesewas - (paid.get(inv.id) ?? 0), h = habit.get(inv.id);
      const amount = h === 'instalments' && (paid.get(inv.id) ?? 0) === 0 ? Math.round(inv.total_pesewas / 2 / 100) * 100 : h === 'late' && chance(0.5) ? Math.round(left * 0.6 / 100) * 100 : left;
      const method = pick(['mobile_money', 'mobile_money', 'mobile_money', 'cash', 'cash', 'bank']);
      const reference = method === 'mobile_money' ? `MoMo ${Math.floor(1e9 + rand() * 9e9)}` : method === 'bank' ? `GCB slip ${Math.floor(10000 + rand() * 89999)}` : undefined;
      await bursar.post('/finance/payments', { invoiceId: inv.id, amountPesewas: amount, method, receivedOn: d, ...(reference ? { reference } : {}) });
      paid.set(inv.id, (paid.get(inv.id) ?? 0) + amount);
    });
    await events(d);
    state.done.push(`day:${d}`); save();
    process.stdout.write(`  ${d}${reason ? ` (${reason})` : ''}\n`);
  }
}

// One-off things that happen during a real term.
async function events(d: string) {
  const head = await as('head'), bursar = await as('bursar');
  const termId = state.termIds['Term 3']!;
  if (d === '2026-04-24') {
    step('Bursar posts a payment to the wrong family and the headteacher reverses it');
    const inv = (await all(bursar, `/finance/invoices?termId=${termId}`)).find((i: { paid_pesewas: number; total_pesewas: number }) => i.paid_pesewas < i.total_pesewas)!;
    const p = await bursar.post('/finance/payments', { invoiceId: inv.id, amountPesewas: 50000, method: 'cash', receivedOn: d });
    await head.post(`/finance/payments/${p.id ?? p.paymentId}/reverse`, { reason: 'Posted to the wrong learner; the cash belongs to another family and was re-entered there' });
  }
  if (d === '2026-04-27') {
    step('Headteacher completes the school details and records each learner\'s sex from the admission register');
    const school = await head.get('');
    await head.call('PATCH', '', { name: school.name, version: school.version, address: 'P.O. Box KS 214, Kasoa, Awutu Senya East, Central Region', phone: '030 000 0000', motto: 'Unity, Knowledge and Service' });
    await inBatches(state.learners.filter(l => !l.left), 6, async l => {
      const first = l.name.split(' ').slice(0, -1).join(' ');
      const sex = girls.includes(first) ? 'female' : boys.includes(first) ? 'male' : null;
      if (!sex) { finding(`Could not tell the sex of ${l.name} from the register`); return; }
      const detail = await head.get(`/learners/${l.id}`);
      if (!detail.sex) await head.post(`/learners/${l.id}/sex`, { version: detail.version, sex });
    });
  }
  if (d === '2026-04-28') {
    step('Fees: balances from the old fees book, staff-ward and sibling discounts, and the BECE mock fee wrongly billed to JHS 1–2');
    const invoices = await all(bursar, `/finance/invoices?termId=${termId}`);
    const byLearner = new Map(invoices.map((i: { learner_id: string }) => [i.learner_id, i]));
    // Re-running after an interruption: a bill that already carries this label is left alone.
    const has = (inv: { adjustments?: { label: string }[] } | undefined, label: string) => !inv || inv.adjustments?.some(a => a.label === label);
    for (const l of state.learners.filter(x => !x.left && chance(0.07))) {
      const inv = byLearner.get(l.id) as { id: string } | undefined; if (has(inv, 'Balance brought forward (Term 2)')) continue;
      await bursar.post(`/finance/invoices/${inv.id}/adjustments`, { kind: 'charge', label: 'Balance brought forward (Term 2)', amountPesewas: (5 + Math.floor(rand() * 40)) * 1000, reason: 'Unpaid Term 2 balance copied from the old fees book, checked with the headteacher' });
    }
    for (const l of state.learners.filter(x => !x.left).slice(0, 200).filter(() => chance(0.015)).slice(0, 3)) {
      const inv = byLearner.get(l.id) as { id: string; balance_pesewas: number } | undefined; if (!inv || has(inv, 'Staff ward (50% tuition)')) continue;
      if (inv.balance_pesewas <= 0) { finding(`${l.name}'s bill was already paid in full, so the staff-ward discount cannot be recorded: the platform has no credit or refund for an overpaid bill`); continue; }
      await head.post(`/finance/invoices/${inv.id}/adjustments`, { kind: 'discount', label: 'Staff ward (50% tuition)', amountPesewas: Math.min(inv.balance_pesewas, l.classIndex < 2 ? 42500 : l.classIndex < 8 ? 52500 : 62500), reason: 'Child of a member of staff; 50% of tuition by the board decision of September 2025' });
    }
    const siblings = new Map<number, Learner[]>(); for (const l of state.learners.filter(x => !x.left)) siblings.set(l.family, [...(siblings.get(l.family) ?? []), l]);
    for (const group of [...siblings.values()].filter(g => g.length >= 3)) {
      const youngest = group.sort((a, b) => a.classIndex - b.classIndex)[0]!;
      const inv = byLearner.get(youngest.id) as { id: string; balance_pesewas: number } | undefined; if (!inv || has(inv, 'Third-child discount') || inv.balance_pesewas < 10000) continue;
      await head.post(`/finance/invoices/${inv.id}/adjustments`, { kind: 'discount', label: 'Third-child discount', amountPesewas: 10000, reason: 'Three or more children in the school: GH₵100 off the youngest child\'s bill' });
    }
    for (const inv of invoices.filter((i: { class_name: string }) => i.class_name === 'JHS 1' || i.class_name === 'JHS 2') as { id: string; balance_pesewas: number; paid_pesewas: number; adjustments: { label: string }[] }[]) {
      if (has(inv, 'BECE mock fee not applicable')) continue;
      if (inv.balance_pesewas >= 10000) await head.post(`/finance/invoices/${inv.id}/adjustments`, { kind: 'discount', label: 'BECE mock fee not applicable', amountPesewas: 10000, reason: 'The BECE mock fee was set for all JHS classes by mistake; it applies to JHS 3 only' });
      else finding(`JHS 1/2 invoice ${inv.id} already paid the BECE mock fee in full; the school owes a refund or credit, which the platform cannot record`);
    }
  }
  if (d === '2026-05-08') {
    step('PTA meeting notice, and a correction to a locked register (a learner marked absent was at a sports competition)');
    const n = await head.post('/notices', { title: 'PTA general meeting', body: 'PTA general meeting on Saturday 16 May 2026 at 9:00 am in the school hall. Agenda: Term 3 budget, BECE preparation and the new classroom block.', audience: 'school' });
    await head.post(`/notices/${n.id}/approve`, { version: n.version });
    const register = await head.get(`/attendance/classes/${state.classIds[6]}/register?day=2026-05-06`);
    const target = register.items.find((r: { mark: string }) => r.mark === 'absent') ?? register.items[0];
    await head.post(`/attendance/classes/${state.classIds[6]}/register`, { day: '2026-05-06', version: register.version, action: 'correct', correctionReason: 'Was representing the school at the district athletics; excused by the headteacher', marks: register.items.map((r: { id: string; mark: string }) => ({ learnerId: r.id, mark: r.id === target.id ? 'excused' : r.mark })) });
  }
  if (d === '2026-05-15') {
    step('Fees deadline: headteacher reviews outstanding balances and repeated absence');
    const owing = await all(bursar, `/finance/invoices?termId=${termId}&outstandingOnly=true`);
    const summary = await bursar.get(`/finance/summary?termId=${termId}`);
    step(`  ${owing.length} families still owe; summary ${JSON.stringify(summary).slice(0, 200)}`);
    const absence = await head.get(`/attendance/repeated-absence?to=${d}&days=20&threshold=4`);
    step(`  repeated absence: ${(absence.items ?? absence).length ?? 0} learner(s)`);
    const n = await head.post('/notices', { title: 'Fees reminder', body: 'Term 3 fees were due today. Your ward still has a balance. Please see the bursar this week or call the school to agree a payment plan.', audience: 'owing', termId });
    step(`  reminder sent to ${(await head.post(`/notices/${n.id}/approve`, { version: n.version })).recipients} owing families`);
  }
  if (d === '2026-05-20') {
    step('A Basic 4 learner leaves: family relocating to Kumasi');
    const l = state.learners.find(x => x.classIndex === 5 && !x.left)!;
    const detail = await head.get(`/learners/${l.id}`);
    await head.post(`/learners/${l.id}/withdraw`, { version: detail.version, effectiveDate: '2026-05-22', reason: 'Family relocating to Kumasi; transfer letter issued' });
    l.left = '2026-05-22'; save();
  }
  if (d === '2026-05-25') {
    const jhs3 = state.classIds[10]!;
    const n = await head.post('/notices', { title: 'BECE 2026', body: 'JHS 3 candidates write the BECE from Monday 8 June to Friday 12 June 2026. Index cards are ready at the office. Candidates must report by 7:30 am each day.', audience: 'class', classId: jhs3 });
    await head.post(`/notices/${n.id}/approve`, { version: n.version });
  }
  if (d === BECE_LAST_DAY) {
    step('JHS 3 completes the BECE and leaves the school');
    const jhs3 = state.learners.filter(l => l.classIndex === 10 && !l.left);
    await inBatches(jhs3, 4, async l => {
      const detail = await head.get(`/learners/${l.id}`);
      await head.post(`/learners/${l.id}/withdraw`, { version: detail.version, effectiveDate: addDays(BECE_LAST_DAY, 3), reason: 'Completed basic school: sat the BECE in June 2026' });
      l.left = addDays(BECE_LAST_DAY, 3);
    });
    save();
  }
}

// ---------------------------------------------------------------- phase: exams (last two weeks of Term 3)
const subjectsFor = (classIndex: number) => CLASSES[classIndex]!.level === 'KG' ? KG_SUBJECTS : CLASSES[classIndex]!.level === 'JHS' ? JHS_SUBJECTS : PRIMARY_SUBJECTS;
const average = (l: Learner) => l.ability;
const repeats = (l: Learner) => l.ability < 33;
async function exams() {
  const head = await as('head');
  const termId = state.termIds['Term 3']!;
  if (!state.nextYearId) {
    step(`Next academic year ${NEXT_YEAR.name} and its Term 1 (GES calendar), so report cards show the reopening date`);
    state.nextYearId = (await head.post('/academic-years', { name: NEXT_YEAR.name, startDate: NEXT_YEAR.start, endDate: NEXT_YEAR.end })).id;
    state.termIds['2026/27 Term 1'] = (await head.post('/assessment/terms', { academicYearId: state.nextYearId, name: NEXT_YEAR.term1.name, startDate: NEXT_YEAR.term1.start, endDate: NEXT_YEAR.term1.end })).id;
    save();
  }
  for (const s of KG_SUBJECTS) if (!state.subjectIds[s]) { state.subjectIds[s] = (await head.post('/assessment/subjects', { name: s })).id; save(); }
  const score = (l: Learner, subject: number, kind: string) => Math.round(clamp(normal(l.ability + (subject % 3 - 1) * 5 + (kind === 'ca' ? 7 : 0), 9), 5, 99));
  for (const [classIndex, c] of CLASSES.entries()) {
    if (classIndex === 10 || state.done.includes(`exams:${c.name}`)) continue; // JHS 3 sat the BECE and left
    const classId = state.classIds[classIndex]!, present = state.learners.filter(l => l.classIndex === classIndex && !l.left);
    step(`${c.name}: class scores and end-of-term examination, remarks, then publication`);
    await inBatches(subjectsFor(classIndex).map((name, s) => ({ name, s })), 4, ({ name, s }) => head.post(`/assessment/classes/${classId}/scores`, { termId, subjectId: state.subjectIds[name], scores: present.flatMap(l => ['ca', 'exam'].map(kind => ({ learnerId: l.id, kind, score: score(l, s, kind) }))) }));
    const remark = (l: Learner) => l.chronic ? 'Has potential but must attend school regularly.' : average(l) > 75 ? 'Excellent performance. Keep it up.' : average(l) > 60 ? 'Good work. Can do better with more effort.' : average(l) > 45 ? 'Fair performance. Needs to put in more effort.' : 'Weak performance. Needs extra support at home and in school.';
    await head.post(`/assessment/classes/${classId}/remarks`, { termId, author: 'class_teacher', items: present.map(l => ({ learnerId: l.id, conduct: pick(['Very good', 'Good', 'Good', 'Satisfactory', 'Respectful and well behaved']), attitude: pick(['Hardworking', 'Attentive in class', 'Punctual and neat', 'Needs to be more serious', 'Cooperative']), interest: pick(['Football', 'Reading', 'Drawing', 'Music and dance', 'Athletics', 'Debate', 'Netball', 'Science club']), remark: remark(l) })) });
    const next = CLASSES[classIndex + 1]?.name;
    await head.post(`/assessment/classes/${classId}/remarks`, { termId, author: 'headteacher', items: present.map(l => ({ learnerId: l.id, remark: repeats(l) ? `To repeat ${c.name}. Parents to see the headteacher.` : `Promoted to ${next}.` })) });
    const preview = await head.get(`/assessment/classes/${classId}/results?termId=${termId}`);
    const incomplete = preview.items.filter((r: { complete: boolean }) => !r.complete);
    if (incomplete.length) finding(`${c.name}: ${incomplete.map((r: { fullName: string }) => r.fullName).join(', ')} left during the term but still appear in the results as incomplete, so publishing needs an explicit acknowledgement`);
    const published = await head.post(`/assessment/classes/${classId}/publish`, { termId, acknowledgeIncomplete: incomplete.length > 0 });
    const cards = (await head.get(`/assessment/classes/${classId}/reports?termId=${termId}`)).items;
    step(`  published ${published.published}; ${cards.length} report cards ready to print`);
    if (classIndex === 5) state.evidence = { ...(state.evidence ?? {}), sampleReport: cards.find((r: { snapshot: { learner: { id: string } } }) => present.some(l => l.id === r.snapshot.learner.id))?.snapshot };
    state.done.push(`exams:${c.name}`); save();
  }
}

// ---------------------------------------------------------------- phase: close (vacation and the roll-over to 2026/27)
async function close() {
  const head = await as('head'), bursar = await as('bursar');
  const termId = state.termIds['Term 3']!;
  if (!state.done.includes('close:vacation')) {
    step('Vacation: closing notice, fees position and families who still owe');
    const n = await head.post('/notices', { title: 'Vacation and reopening', body: 'School vacates today, Friday 24 July 2026. Reports have been given out. School reopens for the 2026/2027 year on Tuesday 8 September 2026. Have a safe holiday.', audience: 'school' });
    await head.post(`/notices/${n.id}/approve`, { version: n.version });
    const summary = await bursar.get(`/finance/summary?termId=${termId}`);
    const owing = await all(bursar, `/finance/invoices?termId=${termId}&outstandingOnly=true`);
    state.evidence = { ...(state.evidence ?? {}), term3Fees: summary, term3Owing: owing.length };
    step(`  billed ${summary.billedPesewas / 100} GHS, collected ${summary.collectedPesewas / 100}, outstanding ${summary.outstandingPesewas / 100}; ${owing.length} learners owe`);
    state.done.push('close:vacation'); save();
  }
  if (!state.nextClassIds?.length) {
    step('2026/27 classes');
    state.nextClassIds = [];
    for (const c of CLASSES) state.nextClassIds.push((await head.post('/classes', { name: c.name, level: c.level, capacity: c.size + 8, academicYearId: state.nextYearId })).id);
    save();
  }
  for (const [classIndex, c] of CLASSES.entries()) {
    if (classIndex === 10 || state.done.includes(`promote:${c.name}`)) continue;
    const preview = await head.get(`/promotions/preview?sourceClassId=${state.classIds[classIndex]}&effectiveDate=${NEXT_YEAR.start}`);
    if (!preview.items.length) { state.done.push(`promote:${c.name}`); continue; }
    const decisions = preview.items.map((row: { id: string }) => {
      const l = state.learners.find(x => x.id === row.id)!;
      return { learnerId: row.id, action: 'move', classId: state.nextClassIds![repeats(l) ? classIndex : classIndex + 1] };
    });
    const result = await head.post('/promotions', { sourceClassId: state.classIds[classIndex], effectiveDate: NEXT_YEAR.start, reason: `End of year promotion approved at the staff meeting of 23 July 2026 (${c.name})`, decisions });
    for (const d of decisions) { const l = state.learners.find(x => x.id === d.learnerId)!; if (!repeats(l)) l.classIndex = classIndex + 1; }
    step(`  ${c.name}: ${result.moved} moved on (${decisions.filter((d: { classId: string }) => d.classId === state.nextClassIds![classIndex]).length} repeating)`);
    state.done.push(`promote:${c.name}`); save();
  }
  if (!state.done.includes('close:assignments')) {
    step('2026/27 class teachers (assignments live today)');
    for (const [i, c] of CLASSES.entries()) {
      const a = await head.post('/teaching/assignments', { classId: state.nextClassIds![i], teacherMembershipId: state.accounts[teacherKey(i)]!.membershipId, startDate: NEXT_YEAR.start, endDate: NEXT_YEAR.end, reason: `Class teacher for ${c.name}, 2026/27` });
      state.assignments.push({ id: a.id, classIndex: 100 + i, teacher: teacherKey(i) });
    }
    for (const [s] of SUBJECT_TEACHERS.entries()) for (const i of [8, 9, 10]) await head.post('/teaching/assignments', { classId: state.nextClassIds![i], teacherMembershipId: state.accounts[`subject${s}`]!.membershipId, startDate: NEXT_YEAR.start, endDate: NEXT_YEAR.end, reason: `Subject teacher (${SUBJECT_TEACHERS[s]!.teaches}), 2026/27` });
    state.done.push('close:assignments'); save();
  }
  if (!state.done.includes('close:bills')) {
    step('2026/27 Term 1 fee items and bills; Term 3 balances show as arrears');
    const t1 = state.termIds['2026/27 Term 1']!;
    for (const f of FEES) {
      if (f.name === 'BECE mock examination') await bursar.post('/finance/fee-items', { termId: t1, name: f.name, amountPesewas: f.amount, classId: state.nextClassIds![10] });
      else await bursar.post('/finance/fee-items', { termId: t1, name: f.name, amountPesewas: f.amount + (f.name === 'Tuition' ? 5000 : 0), ...(f.level ? { level: f.level } : {}) });
    }
    for (const id of state.nextClassIds!) await bursar.post('/finance/invoices/generate', { termId: t1, classId: id });
    const bills = await all(bursar, `/finance/invoices?termId=${t1}`);
    const withArrears = bills.filter((b: { arrears_pesewas: number }) => b.arrears_pesewas > 0);
    state.evidence = { ...(state.evidence ?? {}), term1Bills: bills.length, term1BillsWithArrears: withArrears.length, term1ArrearsPesewas: withArrears.reduce((s: number, b: { arrears_pesewas: number }) => s + b.arrears_pesewas, 0) };
    step(`  ${bills.length} bills; ${withArrears.length} carry arrears from Term 3`);
    state.done.push('close:bills'); save();
  }
}

// ---------------------------------------------------------------- phase: current (Term 1 of 2026/27, real dates up to today)
const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
async function current() {
  const head = await as('head'), bursar = await as('bursar');
  const t1 = state.termIds['2026/27 Term 1']!, classIds = state.nextClassIds!;
  if (!state.done.includes('current:intake')) {
    step('New KG 1 intake and two transfers in, with phone-only guardians');
    const intake = [['Afia Mensah', 0, '2022-05-11', 'female'], ['Kwadwo Owusu', 0, '2022-02-03', 'male'], ['Nhyira Addo', 0, '2022-08-19', 'female'], ['Yayra Agbeko', 4, '2017-01-25', 'female'], ['Kobina Annan', 8, '2013-06-30', 'male']] as const;
    for (const [k, [name, classIndex, dob, sex]] of intake.entries()) {
      if (state.learners.some(l => l.name === name)) continue;
      let a = await head.post('/admissions', { fullName: name, dateOfBirth: dob, sex, classId: classIds[classIndex], startDate: NEXT_YEAR.term1.start, admissionNumber: `NBS/26/K${String(k + 1).padStart(3, '0')}` });
      for (const action of ['review', 'offer', 'accept', 'enrol']) a = await head.post(`/admissions/${a.id}/transition`, { version: a.version, action });
      const family = state.families.length; state.families.push({ name: `Madam ${pick(girls)} ${name.split(' ').pop()}`, surname: name.split(' ').pop()!, phone: phone() });
      state.learners.push({ id: a.learner_id, name, classIndex, admissionNumber: `NBS/26/K${k + 1}`, dob, family, ability: clamp(normal(60, 12), 30, 95), chronic: false });
    }
    save(); await guardians();
    for (const id of classIds) await bursar.post('/finance/invoices/generate', { termId: t1, classId: id });
    const n = await head.post('/notices', { title: 'Welcome to 2026/2027', body: 'Welcome back. Term 1 runs from 8 September to 17 December 2026. Term 1 bills include any balance from last term. Please clear arrears before mid-term.', audience: 'school' });
    await head.post(`/notices/${n.id}/approve`, { version: n.version });
    state.done.push('current:intake'); save();
  }
  const holidays: Record<string, string> = { '2026-09-21': 'Public holiday: Kwame Nkrumah Memorial Day' };
  const invoices = await all(bursar, `/finance/invoices?termId=${t1}`);
  for (let d = NEXT_YEAR.term1.start; d <= TODAY; d = addDays(d, 1)) {
    if (!weekday(d) || state.done.includes(`day:${d}`)) continue;
    await head.post('/attendance/school-days', { day: d, isOpen: !holidays[d], reason: holidays[d] ?? 'Normal school day' }).catch(error => { if ((error as { status?: number }).status !== 409) throw error; });
    if (!holidays[d]) {
      // Each class teacher takes their own register, as they would on a phone in the morning.
      await inBatches(classIds.map((id, i) => ({ id, i })), 4, async c => {
        const teacher = await as(teacherKey(c.i));
        const register = await teacher.get(`/attendance/classes/${c.id}/register?day=${d}`);
        if (register.status !== 'draft' || !register.items.length) return;
        const marks = register.items.map((row: { id: string }) => { const l = state.learners.find(x => x.id === row.id); const r = rand(), absent = l?.chronic ? 0.3 : 0.04; return { learnerId: row.id, mark: r < absent ? 'absent' : r < absent + 0.05 ? 'late' : 'present' }; });
        const draft = await teacher.post(`/attendance/classes/${c.id}/register`, { day: d, version: register.version, action: 'save', marks });
        await teacher.post(`/attendance/classes/${c.id}/register`, { day: d, version: draft.version, action: 'submit', marks });
      });
    }
    if (day(d).getUTCDay() === 5) for (const w of [0, 1, 2, 3, 4].map(k => addDays(d, -k)).filter(w => w >= NEXT_YEAR.term1.start && !holidays[w])) await inBatches(classIds, 6, async id => {
      const register = await head.get(`/attendance/classes/${id}/register?day=${w}`);
      if (register.status === 'submitted') await head.post(`/attendance/classes/${id}/register`, { day: w, version: register.version, action: 'lock', marks: register.items.map((row: { id: string; mark: string }) => ({ learnerId: row.id, mark: row.mark })) });
    });
    await inBatches(invoices.filter((inv: { balance_pesewas: number }) => inv.balance_pesewas > 0 && chance(d < '2026-09-25' ? 0.06 : 0.025)) as { id: string; balance_pesewas: number }[], 4, async inv => {
      const amount = chance(0.5) ? inv.balance_pesewas : Math.max(100, Math.round(inv.balance_pesewas / 2 / 100) * 100);
      await bursar.post('/finance/payments', { invoiceId: inv.id, amountPesewas: amount, method: pick(['mobile_money', 'mobile_money', 'cash']), receivedOn: d, reference: `MoMo ${Math.floor(1e9 + rand() * 9e9)}` });
      inv.balance_pesewas -= amount;
    });
    state.done.push(`day:${d}`); save(); console.log(`  ${d}${holidays[d] ? ` (${holidays[d]})` : ''}`);
  }
  if (!state.done.includes('current:midterm')) {
    step('Mid-term class test: the Basic 6 class teacher enters Mathematics class scores herself');
    const teacher = await as(teacherKey(7));
    const grid = await teacher.get(`/assessment/classes/${classIds[7]}/grid?termId=${t1}&subjectId=${state.subjectIds['Mathematics']}`);
    const written = await teacher.post(`/assessment/classes/${classIds[7]}/scores`, { termId: t1, subjectId: state.subjectIds['Mathematics'], scores: grid.items.map((row: { learnerId: string }) => ({ learnerId: row.learnerId, kind: 'ca', score: Math.round(clamp(normal(62, 12), 10, 98)) })) });
    step(`  ${written.written} class scores recorded by the teacher`);
    const other = await teacher.get(`/assessment/classes/${classIds[8]}/grid?termId=${t1}`).then(() => 'allowed', (e: { status?: number }) => `refused (${e.status})`);
    step(`  the same teacher opening JHS 1 scores: ${other}`);
    state.done.push('current:midterm'); save();
  }
  step('A phone-only parent signs in to see last term\'s report card, the new bill with arrears, and notices');
  const phoneFamily = state.families.findIndex(f => !f.email && f.account && state.learners.some(l => l.family === state.families.indexOf(f) && l.classIndex >= 3 && l.classIndex <= 9));
  const parent = await as(state.families[phoneFamily]!.account!);
  const children = await parent.get('/guardian/children');
  const child = children[0];
  const reports = (await parent.get(`/guardian/children/${child.id}/terminal-reports`)).items;
  const statement = (await parent.get(`/guardian/children/${child.id}/statement`)).items;
  const notices = await parent.get('/guardian/notices');
  state.evidence = { ...(state.evidence ?? {}), parentView: { signIn: parent.account.email, children: children.length, reportTerms: reports.map((r: { snapshot: { term: { name: string }; attendance?: unknown; nextTermBegins?: string } }) => ({ term: r.snapshot.term.name, attendance: r.snapshot.attendance, nextTermBegins: r.snapshot.nextTermBegins })), statement: statement.map((s: { term_name: string; total_pesewas: number; paid_pesewas: number; balance_pesewas: number }) => ({ term: s.term_name, due: s.total_pesewas, paid: s.paid_pesewas, balance: s.balance_pesewas })), notices: (notices.items ?? notices).length } };
  step(`  ${JSON.stringify(state.evidence.parentView).slice(0, 400)}`);
  const followUp = await head.get(`/attendance/follow-up?day=${TODAY}`);
  step(`  today's register follow-up: ${JSON.stringify(followUp).slice(0, 200)}`);
  save();
}

// ---------------------------------------------------------------- main
const phases: Record<string, () => Promise<void>> = { setup, enrol, guardians, term, exams, close, current, status: async () => { console.log(JSON.stringify({ school: state.schoolId, learners: state.learners.length, done: state.done, findings: state.findings }, null, 2)); } };
const phase = process.argv[2] ?? 'status';
if (!phases[phase]) { console.error(`Unknown phase ${phase}. Use one of: ${Object.keys(phases).join(', ')}`); process.exit(1); }
phases[phase]!().then(save).catch(error => { save(); console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
