import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { demoQuestionSets } from './demo-practice';

// Shareable demo school on the live system: "Sunrise International School (Demo)" holds a full Ghanaian school year
// (2025/26 complete, 2026/27 Term 1 up to today) so prospects can sign in and see a working school, including Ask.
// Everything is written through the API as the right role, so records carry the normal rules, versions and audit.
// The only things not done through ordinary endpoints are the same two the term trial used: the public sign-up that
// creates the school row and its headteacher, and the temporary-password flow for accounts the headteacher creates.
//
// Phases run one at a time, are idempotent and resume from .local/demo-hosted/state.json (ids and passwords; never committed):
//   npx tsx scripts/demo-hosted.ts setup|roll|t1|t2|t3|promote|current|finish|verify|ask|status
// Re-running `current` on a later day adds the new school days (registers, class work, payments) up to that day.
// Past-year teacher-scoped entries are made by the headteacher (teacher access ends with the academic year, as in the
// Nkabom trial); 2026/27 Term 1 is entered by the class teachers themselves.
// Hosted writes need DEMO_API=<https api url> and DEMO_CONFIRM_HOSTED=write-to-production. The default is a local API.

const API = (process.env.DEMO_API ?? 'http://127.0.0.1:3019/api/v1').replace(/\/$/, '');
const HOSTED = !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API);
const DIR = path.resolve(__dirname, '../../.local/demo-hosted');
const SUFFIX = process.env.DEMO_STATE_SUFFIX ?? (HOSTED ? '' : '-local');
const STATE = path.join(DIR, `state${SUFFIX}.json`);
const LOGINS = path.join(DIR, `logins${SUFFIX}.txt`);
const DOMAIN = 'sunrise-demo.test';
const SCHOOL_NAME = 'Sunrise International School (Demo)';
const RUN = 'v1';
const TODAY = process.env.DEMO_TODAY ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const CONCURRENCY = Number(process.env.DEMO_CONCURRENCY) || (HOSTED ? 4 : 6);
const PACE_MS = Number(process.env.DEMO_PACE_MS ?? (HOSTED ? 100 : 0));
const phase = process.argv[2] ?? 'status';

// ---------------------------------------------------------------- deterministic randomness (order independent)
function hashInt(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return h >>> 0;
}
const u = (...k: (string | number)[]) => hashInt(k.join('|')) / 4294967296;
const gauss = (...k: (string | number)[]) => Math.sqrt(-2 * Math.log(Math.max(u(...k, 'a'), 1e-9))) * Math.cos(2 * Math.PI * u(...k, 'b'));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const uuidFrom = (text: string) => { const h = createHash('sha256').update(text).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- calendar (Africa/Accra is UTC)
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
const dow = (s: string) => day(s).getUTCDay();
const weekday = (s: string) => { const w = dow(s); return w > 0 && w < 6; };
const mondayOf = (s: string) => addDays(s, -((dow(s) + 6) % 7));
type TermKey = 't1' | 't2' | 't3' | 't4';
type TermDef = { key: TermKey; idx: number; name: string; start: string; end: string; year: 0 | 1 };
const YEARS = [{ name: '2025/2026', start: '2025-09-08', end: '2026-08-14' }, { name: '2026/2027', start: '2026-09-07', end: '2027-08-13' }];
const TERMS: TermDef[] = [
  { key: 't1', idx: 0, name: 'Term 1', start: '2025-09-08', end: '2025-12-18', year: 0 },
  { key: 't2', idx: 1, name: 'Term 2', start: '2026-01-13', end: '2026-04-02', year: 0 },
  { key: 't3', idx: 2, name: 'Term 3', start: '2026-04-20', end: '2026-07-24', year: 0 },
  { key: 't4', idx: 3, name: 'Term 1', start: '2026-09-08', end: '2026-12-17', year: 1 },
];
const T = (k: TermKey) => TERMS.find(t => t.key === k)!;
const PROMO = '2026-09-07';
// Ghana public holidays and the school's mid-term breaks (movable Islamic dates as announced).
const CLOSED: Record<string, string> = {
  '2025-09-22': 'Public holiday: Kwame Nkrumah Memorial Day (21 September fell on a Sunday)', '2025-10-23': 'Mid-term break', '2025-10-24': 'Mid-term break', '2025-12-05': 'Public holiday: Farmers’ Day',
  '2026-02-26': 'Mid-term break', '2026-02-27': 'Mid-term break', '2026-03-06': 'Public holiday: Independence Day', '2026-03-20': 'Public holiday: Eid al-Fitr',
  '2026-05-01': 'Public holiday: May Day', '2026-05-27': 'Public holiday: Eid al-Adha', '2026-06-04': 'Mid-term break', '2026-06-05': 'Mid-term break', '2026-07-01': 'Public holiday: Republic Day',
  '2026-09-21': 'Public holiday: Kwame Nkrumah Memorial Day',
};
const termDays = (t: TermDef) => { const out: string[] = []; for (let d = t.start; d <= t.end && d <= TODAY; d = addDays(d, 1)) if (weekday(d)) out.push(d); return out; };
const openDays = (t: TermDef) => termDays(t).filter(d => !CLOSED[d]);
// One dated assessment per week (Thursday, or the next open day), only once that day has arrived. `w` counts weeks from the term's first Monday.
function weeks(t: TermDef) {
  const out: { w: number; date: string }[] = [];
  for (let m = mondayOf(t.start), w = 0; m <= t.end && m <= TODAY; m = addDays(m, 7), w++) {
    const date = [3, 2, 4, 1, 0].map(k => addDays(m, k)).find(d => d >= t.start && d <= t.end && !CLOSED[d]);
    if (date && date <= TODAY) out.push({ w, date });
  }
  return out;
}
const weekDate = (t: TermDef, w: number) => { const m = addDays(mondayOf(t.start), 7 * w); return [3, 2, 4, 1, 0].map(k => addDays(m, k)).find(d => d >= t.start && d <= t.end && !CLOSED[d])!; };

// ---------------------------------------------------------------- school plan
const CLASSES = [
  { name: 'Nursery 1', level: 'Nursery' }, { name: 'Nursery 2', level: 'Nursery' }, { name: 'KG 1', level: 'KG' }, { name: 'KG 2', level: 'KG' },
  { name: 'Basic 1', level: 'Primary' }, { name: 'Basic 2', level: 'Primary' }, { name: 'Basic 3', level: 'Primary' }, { name: 'Basic 4', level: 'Primary' },
  { name: 'Basic 5', level: 'Primary' }, { name: 'Basic 6', level: 'Primary' }, { name: 'JHS 1', level: 'JHS' }, { name: 'JHS 2', level: 'JHS' }, { name: 'JHS 3', level: 'JHS' },
] as const;
const SIZES = [13, 14, 14, 15, 15, 15, 15, 14, 15, 15, 15, 14, 14]; // 2025/26 at the start of the year (188)
const COHORT_MEAN = [64, 62, 63, 61, 63, 60, 60, 59, 60, 59, 60, 63, 66];
const GRADED = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const EARLY = [0, 1, 2, 3];
const SUBJECTS = ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Ghanaian Language (Twi)', 'Creative Arts', 'Computing'];
const CORE = 4;
const TEACHER_NAMES = ['Gladys Ampofo', 'Patience Owusu', 'Rebecca Ansah', 'Felicia Tetteh', 'Augustina Badu', 'Esther Asamoah', 'Francis Yeboah', 'Doris Opoku', 'Ebenezer Kusi', 'Bright Amponsah', 'Kwesi Wiredu', 'Hannah Fosu', 'Priscilla Mensah'];
const BASIC6 = 9; // the class whose teacher is the shared teacher login
const BOYS = ['Kwame', 'Kofi', 'Kwabena', 'Kwaku', 'Yaw', 'Kwasi', 'Kojo', 'Nana Kwame', 'Emmanuel', 'Samuel', 'Daniel', 'Joseph', 'Isaac', 'Prince', 'Richard', 'Michael', 'Elikem', 'Selorm', 'Nii Armah', 'Fiifi', 'Ebo', 'Kekeli', 'Jeffrey', 'Bernard', 'Desmond', 'Ibrahim', 'Mubarak', 'Nhyiraba'];
const GIRLS = ['Ama', 'Akosua', 'Abena', 'Akua', 'Yaa', 'Afua', 'Adwoa', 'Esi', 'Efua', 'Araba', 'Nana Ama', 'Grace', 'Priscilla', 'Mercy', 'Comfort', 'Gifty', 'Abigail', 'Elorm', 'Dzifa', 'Naa Adjeley', 'Maame', 'Benedicta', 'Josephine', 'Vida', 'Ewurabena', 'Edinam', 'Fatima', 'Rahinatu'];
const SURNAMES = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyeman', 'Appiah', 'Darko', 'Addo', 'Ofori', 'Amoah', 'Acheampong', 'Tetteh', 'Quaye', 'Lartey', 'Annan', 'Sarpong', 'Danso', 'Nyarko', 'Gyamfi', 'Frimpong', 'Adjei', 'Bonsu', 'Kusi', 'Amponsah', 'Antwi', 'Agbeko', 'Kpodo', 'Dogbe', 'Fosu', 'Ansah', 'Wiredu', 'Yeboah', 'Opoku', 'Badu', 'Asamoah', 'Mohammed', 'Issah'];
// The school's own topics for the four core subjects (no copied curriculum text): [description, usual difficulty offset].
const TOPICS: [string, number][][] = [
  [['Reading comprehension', 1], ['Spelling and vocabulary', 2], ['Grammar: tenses and agreement', -3], ['Composition writing', -4], ['Listening and speaking', 3]],
  [['Place value and number sense', 2], ['Addition and subtraction', 3], ['Fractions', -4], ['Measurement: length, mass and capacity', -3], ['Reading tables and graphs', 0]],
  [['Living things and their habitats', 3], ['Materials and their properties', 0], ['Energy and its forms', -3], ['Forces and movement', -2]],
  [['Our environment', 2], ['Governance and citizenship', -2], ['Ghanaian culture and festivals', 4], ['Map reading', -3]],
];
// Cohort-level weaknesses (cohort = the 2025/26 class index): subject -> topic -> extra offset. Basic 6 (cohort 8) is weak on Fractions and Map reading.
const DEFICITS: Record<number, Record<number, Record<number, number>>> = {
  8: { 1: { 2: -14 }, 3: { 3: -12 } }, 10: { 0: { 3: -12 } }, 6: { 2: { 2: -10 } }, 11: { 3: { 1: -9 }, 0: { 2: -6 } },
};
// How often the weak topic is taught: weeks where week % mod === rem.
const FOCUS: Record<string, { topic: number; mod: number; rem: number }> = {
  '8:1': { topic: 2, mod: 2, rem: 0 }, '8:3': { topic: 3, mod: 2, rem: 1 }, '10:0': { topic: 3, mod: 3, rem: 0 }, '6:2': { topic: 2, mod: 3, rem: 1 }, '11:3': { topic: 1, mod: 3, rem: 2 },
};
const topicAt = (cohort: number, s: number, w: number) => {
  const n = TOPICS[s]!.length, focus = FOCUS[`${cohort}:${s}`];
  if (focus && w % focus.mod === focus.rem) return focus.topic;
  const others = [...Array(n).keys()].filter(i => !focus || i !== focus.topic);
  return others[(w + cohort + s) % others.length]!;
};
const topicOffset = (cohort: number, s: number, topic: number) => TOPICS[s]![topic]![1] + (DEFICITS[cohort]?.[s]?.[topic] ?? 0);
const KINDS = [['classwork', 'Class exercise', 20], ['homework', 'Homework', 20], ['quiz', 'Quiz', 20], ['class_test', 'Class test', 50]] as const;
const PRACTICE: [number, string, { kind: string; title: string; detail?: string; url?: string; forFamilies?: boolean }[]][] = [
  [1, 'Fractions', [{ kind: 'textbook', title: 'Class maths textbook: fractions chapter', detail: 'Exercises 1 to 4; check answers with a partner' }, { kind: 'activity', title: 'Fraction strips', detail: 'Fold paper strips into halves, quarters and eighths and compare them', forFamilies: true }, { kind: 'worksheet', title: 'Fractions practice sheet 1', url: 'https://example.org/sunrise/maths/fractions-sheet-1' }]],
  [3, 'Map reading', [{ kind: 'activity', title: 'Map of the school compound', detail: 'Draw the compound with a key and a north arrow' }, { kind: 'activity', title: 'Map from home to school', detail: 'Draw the way to school and mark three landmarks', forFamilies: true }]],
  [0, 'Composition writing', [{ kind: 'activity', title: 'Plan, write, check', detail: 'Plan three paragraphs, write, then a partner checks capitals, full stops and paragraphs' }, { kind: 'activity', title: 'Tell the story first', detail: 'Talk through what happened before writing it down', forFamilies: true }]],
  [0, 'Grammar: tenses and agreement', [{ kind: 'textbook', title: 'English textbook: tenses unit', detail: 'Exercises A to C' }]],
  [2, 'Energy and its forms', [{ kind: 'activity', title: 'Energy hunt', detail: 'List ten things at home that use energy and say which form', forFamilies: true }]],
  [3, 'Governance and citizenship', [{ kind: 'worksheet', title: 'Who does what? Local and national government', url: 'https://example.org/sunrise/social/governance-sheet' }]],
];
const GRADE_INDICATORS: [number, string, string[]][] = [[0, 'JHS 3', ['Argumentative essay writing', 'Summary writing', 'Letter writing: formal and informal']], [0, 'Basic 4', ['Reading aloud with expression', 'Using capital letters and full stops']], [1, 'Basic 5', ['Adding and subtracting decimals', 'Finding percentages of quantities']], [1, 'JHS 3', ['Solving linear equations', 'Simple and compound interest']]];
const FEES = [
  { name: 'Tuition', level: 'Nursery', amount: 90000 }, { name: 'Tuition', level: 'KG', amount: 95000 }, { name: 'Tuition', level: 'Primary', amount: 115000 }, { name: 'Tuition', level: 'JHS', amount: 135000 },
  { name: 'PTA dues', amount: 5000 }, { name: 'ICT levy', level: 'Primary', amount: 8000 }, { name: 'ICT levy', level: 'JHS', amount: 8000 },
  { name: 'Examination fee', level: 'JHS', amount: 12000 }, { name: 'Learning materials', level: 'Nursery', amount: 15000 }, { name: 'Learning materials', level: 'KG', amount: 15000 },
];
const feeTotal = (level: string, t: TermDef) => FEES.filter(f => !('level' in f) || f.level === level).reduce((s, f) => s + f.amount + (f.name === 'Tuition' && t.key === 't4' ? 5000 : 0), 0);
const tuitionOf = (level: string, t: TermDef) => FEES.find(f => f.name === 'Tuition' && f.level === level)!.amount + (t.key === 't4' ? 5000 : 0);
const EY_INDICATORS = [
  ['LL-01', 'Listens to and retells a short story', 'Language and literacy', 'Oral language', 'Listening and speaking', ['Listens to a story to the end', 'Retells the story with prompts', 'Retells the story in order']],
  ['NUM-01', 'Counts objects up to 10', 'Numeracy', 'Number', 'Counting', ['Counts objects with help', 'Counts up to 10 objects correctly', 'Counts beyond 10 confidently']],
  ['PD-01', 'Uses scissors and crayons with control', 'Physical development', 'Fine motor skills', 'Hand control', ['Holds crayons and scissors', 'Cuts along a straight line', 'Colours within lines']],
  ['SE-01', 'Shares and takes turns with peers', 'Social and emotional', 'Relationships', 'Cooperation', ['Plays beside peers', 'Takes turns with reminders', 'Shares without reminders']],
  ['CA-01', 'Expresses ideas through drawing and song', 'Creative arts', 'Expression', 'Drawing and music', ['Draws simple shapes', 'Sings familiar songs', 'Explains own drawing']],
] as const;
const EVIDENCE = ['Seen during morning circle time', 'Noted during group play', 'Observed in the craft corner', 'Seen during story time', 'Observed during outdoor play', 'Noted while sharing the number cards'];
const REPORT_TEXTS = [
  ['Listens closely at story time and retells familiar stories with growing confidence. Counts objects to ten during play.', 'Practise retelling stories in order at home, and count everyday things together, such as cups or steps.'],
  ['Takes turns with friends and joins group games happily. Holds crayons with good control and colours within lines.', 'Encourage cutting along straight lines and naming shapes while drawing.'],
  ['Sings familiar songs and explains own drawings in short sentences. Shares materials with reminders.', 'Give chances to share without reminders and to talk about pictures in longer sentences.'],
  ['Settles quickly each morning, follows two-step instructions and enjoys number games with friends.', 'Count up to twenty together on the way to school and name the colours of things you pass.'],
  ['Speaks clearly in class, asks questions and helps tidy the learning corner without being asked.', 'Read a short picture book together each evening and ask what happens next.'],
] as const;
const CONDUCT = ['Very good', 'Good', 'Good', 'Satisfactory', 'Respectful and well behaved'];
const ATTITUDE = ['Hardworking', 'Attentive in class', 'Punctual and neat', 'Needs to be more serious', 'Cooperative'];
const INTEREST = ['Football', 'Reading', 'Drawing', 'Music and dance', 'Athletics', 'Debate', 'Netball', 'Science club'];

// ---------------------------------------------------------------- the school's people, planned once and the same on every run
type Seg = { y: 0 | 1; c: number; from: string; to?: string };
type Absence = { kind: 'normal' | 'chronic' | 'monday' | 'friday' | 'late' | 'spell'; from?: string; rate?: number; forced?: Record<string, 'absent' | 'excused'> };
type L = {
  key: string; name: string; sex: 'female' | 'male'; dob: string; admission: string; family: number; c0: number; joins: string; csv: boolean;
  ability: number; subj: number[]; drift: number[]; absence: Absence; story?: string; segs: Seg[]; skipTo?: number; leaves?: string; repeats?: boolean; slips?: boolean;
};
type Family = { name: string; surname: string; login: string; children: string[]; classes: Set<number> };
type Plan = { key: string; classIdx: number; s: number; learner: string; startW: number; reviews: { w: number; outcome: string; decision: string; next?: number }[]; boostFromW: number };
type Model = { learners: L[]; families: Family[]; byKey: Map<string, L>; plans: Map<string, Plan> };

function buildModel(): Model {
  const rnd = mulberry32(20261014);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const normal = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
  const learners: L[] = [], families: Family[] = [], names = new Set<string>();
  const stories: { story: string; name: string; c0: number; ability: number; sex: 'female' | 'male'; family?: number }[] = [
    { story: 'strong', name: 'Esi Mensah', c0: 8, ability: 93, sex: 'female' },
    { story: 'improver', name: 'Kwame Asante', c0: 8, ability: 47, sex: 'male', family: 0 },
    { story: 'dropper', name: 'Yaw Boakye', c0: 8, ability: 71, sex: 'male' },
    { story: 'absentee', name: 'Kojo Quaye', c0: 6, ability: 61, sex: 'male' },
    { story: 'absentee2', name: 'Ama Kpodo', c0: 5, ability: 58, sex: 'female' },
    { story: 'absentee3', name: 'Efua Tetteh', c0: 7, ability: 64, sex: 'female' },
    { story: 'mock25', name: 'Selorm Dogbe', c0: 12, ability: 47, sex: 'male' },
    { story: 'mock26', name: 'Akua Frimpong', c0: 11, ability: 49, sex: 'female' },
    { story: 'kgparent', name: 'Akosua Asante', c0: 2, ability: 66, sex: 'female', family: 0 },
  ];
  for (const s of stories) names.add(s.name);
  families.push({ name: 'Mrs. Grace Asante', surname: 'Asante', login: `parent@${DOMAIN}`, children: [], classes: new Set() });
  const newFamily = (surname: string) => {
    const idx = families.length, given = pick(rnd() < 0.7 ? GIRLS : BOYS);
    families.push({ name: `${pick(['Mr.', 'Mrs.', 'Madam', 'Mrs.'])} ${given} ${surname}`, surname, login: `family${idx}@${DOMAIN}`, children: [], classes: new Set() });
    return idx;
  };
  let initial = 0, later = 0;
  const add = (o: { c0: number; joins: string; csv: boolean; intake?: boolean; story?: (typeof stories)[number]; sex?: 'female' | 'male' }) => {
    const sex = o.story?.sex ?? o.sex ?? (rnd() < 0.5 ? 'female' : 'male');
    let family = -1, surname = pick(SURNAMES);
    if (o.story?.family !== undefined) { family = o.story.family; surname = families[family]!.surname; }
    else if (o.story) { surname = o.story.name.split(' ').pop()!; family = newFamily(surname); }
    else {
      const r = rnd(), pool = families.map((f, i) => i).filter(i => i > 0 && !families[i]!.classes.has(o.c0) && families[i]!.children.length < 3);
      if (r < 0.12 && pool.length > 8) { family = pick(pool); surname = families[family]!.surname; }
      else { surname = pick(SURNAMES); family = r > 0.92 ? -1 : newFamily(surname); }
    }
    let name = o.story?.name ?? '';
    for (let i = 0; !name && i < 80; i++) { const n = `${pick(sex === 'female' ? GIRLS : BOYS)} ${surname}`; if (!names.has(n)) { names.add(n); name = n; } }
    if (!name) throw new Error('Could not find a free name');
    const key = `L${String(learners.length + 1).padStart(3, '0')}`;
    const age = o.intake ? 3 : 3 + o.c0, born = (o.intake ? 2026 : 2025) - age - (rnd() < 0.5 ? 0 : 1);
    const dob = `${born}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const admission = o.csv ? `SIS/25/${String(++initial).padStart(4, '0')}` : `SIS/26/${String(++later).padStart(4, '0')}`;
    const ability = o.story?.ability ?? clamp(normal(COHORT_MEAN[o.c0]!, 13), 32, 96);
    const d1 = normal(0, 2.5), d2 = normal(0, 2.5), d3 = normal(0, 2.5);
    const r = rnd();
    const absence: Absence = o.story ? { kind: 'normal' } : r < 0.03 ? { kind: 'chronic', rate: 0.18 + rnd() * 0.12, from: '2025-09-08' } : r < 0.05 ? { kind: 'monday' } : r < 0.07 ? { kind: 'friday' } : r < 0.10 ? { kind: 'late' } : r < 0.22 ? { kind: 'spell' } : { kind: 'normal' };
    const l: L = { key, name, sex, dob, admission, family, c0: o.c0, joins: o.joins, csv: o.csv, ability, subj: Array.from({ length: 8 }, () => clamp(normal(0, 5), -9, 9)), drift: [0, d1, d1 + d2, d1 + d2 + d3], absence, story: o.story?.story, segs: [], slips: !o.story && rnd() < 0.07 };
    learners.push(l);
    if (family >= 0) { families[family]!.children.push(key); families[family]!.classes.add(o.c0); }
    return l;
  };
  // 2025/26 starting roll, class by class (named stories first).
  for (let c = 0; c < 13; c++) {
    for (const s of stories.filter(s => s.c0 === c)) add({ c0: c, joins: YEARS[0]!.start, csv: true, story: s });
    while (learners.filter(l => l.c0 === c && l.csv).length < SIZES[c]!) add({ c0: c, joins: YEARS[0]!.start, csv: true });
  }
  // Admitted at the start of Term 2 (through the admission flow).
  for (const c of [5, 8, 10]) add({ c0: c, joins: T('t2').start, csv: false });
  // 2026/27 Nursery 1 intake.
  for (let i = 0; i < 14; i++) add({ c0: 0, joins: T('t4').start, csv: false, intake: true });
  const byKey = new Map(learners.map(l => [l.key, l]));
  // Special paths: a double promotion at Term 2, a transfer out at the end of Term 2, two repeaters.
  const free = (c: number, test: (l: L) => boolean) => learners.find(l => l.c0 === c && l.csv && !l.story && test(l))!;
  free(4, l => l.ability > 66).skipTo = 5;
  free(6, l => l.ability > 45 && l.ability < 62).leaves = '2026-04-03';
  for (const c of [3, 7]) { const w = learners.filter(l => l.c0 === c && l.csv && !l.story).sort((a, b) => a.ability - b.ability)[0]!; w.repeats = true; w.ability = Math.min(w.ability, 33); }
  for (const l of learners) {
    if (l.joins === T('t4').start) { l.segs = [{ y: 1, c: 0, from: l.joins }]; continue; }
    const cEnd = l.skipTo ?? l.c0, end0 = l.leaves ?? PROMO;
    l.segs = l.skipTo !== undefined ? [{ y: 0, c: l.c0, from: l.joins, to: T('t2').start }, { y: 0, c: l.skipTo, from: T('t2').start, to: end0 }] : [{ y: 0, c: l.c0, from: l.joins, to: end0 }];
    if (!l.leaves && cEnd < 12) l.segs.push({ y: 1, c: l.repeats ? cEnd : cEnd + 1, from: PROMO });
  }
  // Attendance stories (fixed dates in the current weeks so "last week" is clear).
  const set = (story: string, a: Absence) => { const l = learners.find(x => x.story === story)!; l.absence = a; };
  set('absentee', { kind: 'chronic', rate: 0.42, from: '2026-09-14', forced: { '2026-10-05': 'absent', '2026-10-06': 'absent', '2026-10-07': 'absent', '2026-10-09': 'absent' } });
  set('absentee2', { kind: 'normal', forced: { '2026-10-07': 'absent', '2026-10-08': 'absent', '2026-10-09': 'absent' } });
  set('absentee3', { kind: 'normal', forced: { '2026-10-05': 'excused', '2026-10-06': 'excused' } });
  // Support plans for 2025/26: the weakest learner of about half the graded classes each term, helped from week 2.
  const plans = new Map<string, Plan>();
  for (const t of TERMS.filter(x => x.year === 0)) for (const c of GRADED) {
    if (u('plan', t.key, c) >= 0.55) continue;
    const roster = learners.filter(l => !l.story && l.segs.some(s => s.y === 0 && s.c === c && s.from <= t.start && (!s.to || s.to > t.end)));
    const l = roster.sort((a, b) => a.ability - b.ability)[0];
    if (!l) continue;
    const s = [0, 1, 2, 3].sort((a, b) => l.subj[a]! - l.subj[b]!)[0]!;
    const reviews = t.key === 't2' ? [{ w: 5, outcome: 'no_change', decision: 'continue', next: 8 }, { w: 8, outcome: 'improved', decision: 'close' }] : [{ w: 6, outcome: 'improved', decision: 'close' }];
    plans.set(`${t.key}|${l.key}`, { key: `${t.key}|${l.key}`, classIdx: c, s, learner: l.key, startW: 2, reviews, boostFromW: t.key === 't2' ? 8 : 4 });
  }
  return { learners, families, byKey, plans };
}
const model = buildModel();
const cohortOf = (y: number, c: number) => c - y;
const onRoll = (l: L, y: number, c: number, d: string) => l.segs.some(s => s.y === y && s.c === c && s.from <= d && (!s.to || d < s.to));
// The API's own term rule: enrolled at any time in the term.
const inTerm = (l: L, y: number, c: number, t: { start: string; end: string }) => l.segs.some(s => s.y === y && s.c === c && s.from < t.end && (!s.to || s.to > t.start));
const rosterOn = (y: number, c: number, d: string) => model.learners.filter(l => onRoll(l, y, c, d));

// What a learner scores. Class work: ability plus the subject, the topic's difficulty, the class's term, a story and noise.
const clsShift = (cohort: number, t: TermDef) => gauss('cls', cohort, t.key) * 2;
function planShift(l: L, t: TermDef, s: number, w: number) { const p = model.plans.get(`${t.key}|${l.key}`); return p && p.s === s && w >= p.boostFromW ? 9 : 0; }
function storyShift(l: L, t: TermDef, s: number, w: number) {
  if (t.key !== 't4') return 0;
  switch (l.story) {
    case 'dropper': return s === 0 ? -6 * w : 0;
    case 'improver': return s === 1 ? [-14, -12, -4, 4, 12][Math.min(w, 4)]! : 0;
    case 'absentee': return w >= 1 ? -13 : 0;
    case 'absentee2': return w >= 2 ? -9 : 0;
    default: return l.slips ? -3 * w : 0;
  }
}
function workPercent(l: L, t: TermDef, c: number, s: number, w: number) {
  const cohort = cohortOf(t.year, c), topic = topicAt(cohort, s, w);
  // Kwame's Maths follows his support plan's small-group fractions help, not the topic of the week.
  const topicTerm = l.story === 'improver' && s === 1 && t.key === 't4' ? 0 : topicOffset(cohort, s, topic);
  const p = l.ability + l.subj[s]! + l.drift[t.idx]! + clsShift(cohort, t) + topicTerm + gauss('work', l.key, t.key, s, w) * 7 + storyShift(l, t, s, w) + planShift(l, t, s, w);
  return clamp(p, 4, 100);
}
const markOf = (percent: number, max: number) => Math.round(percent * max / 50) / 2;
function examPercent(l: L, t: TermDef, c: number, s: number) {
  return Math.round(clamp(l.ability + l.subj[s]! + l.drift[t.idx]! + clsShift(cohortOf(t.year, c), t) + gauss('exam', l.key, t.key, s) * 8, 5, 99));
}
const classWork = (l: L, t: TermDef, c: number, s: number) => weeks(t).map(({ w }) => { const kind = KINDS[(w + s) % 4]!; return markOf(workPercent(l, t, c, s, w), kind[2]) * 100 / kind[2]; });
function caScore(l: L, t: TermDef, c: number, s: number) {
  if (s < CORE) { const marks = classWork(l, t, c, s); return Math.round(clamp(marks.reduce((a, b) => a + b, 0) / marks.length + gauss('ca', l.key, t.key, s) * 1.5, 5, 99)); }
  return Math.round(clamp(l.ability + l.subj[s]! + l.drift[t.idx]! + 5 + gauss('ca', l.key, t.key, s) * 6, 5, 99));
}
function mockPercent(l: L, t: TermDef, round: number, s: number) {
  const boost = l.story === 'mock25' ? [0, 4, 9][round - 1]! : l.story === 'mock26' ? [0, 6][round - 1] ?? 6 : 0;
  return Math.round(clamp(l.ability + l.subj[s]! + l.drift[t.idx]! - 3 + 3.5 * round + boost + gauss('mock', l.key, t.key, round, s) * 8, 3, 99));
}
function attendanceMark(l: L, d: string, t: TermDef): 'present' | 'late' | 'absent' | 'excused' {
  const a = l.absence, forced = a.forced?.[d];
  if (forced) return forced;
  let pAbs = 0.026 * (0.6 + 0.8 * u('dayfactor', d)), pLate = a.kind === 'late' ? 0.35 : 0.035;
  if (a.kind === 'chronic') pAbs = d >= (a.from ?? '') ? a.rate ?? 0.25 : 0.05;
  if (a.kind === 'monday' && dow(d) === 1) pAbs = 0.6;
  if (a.kind === 'friday' && dow(d) === 5) pAbs = 0.55;
  if (a.kind === 'spell') { const days = openDays(t).filter(x => x <= TODAY), n = Math.floor(u('spell', l.key, t.key) * Math.max(1, days.length - 4)), len = 3 + Math.floor(u('spell', l.key, t.key, 'len') * 2); if (days.slice(n, n + len).includes(d)) pAbs = 0.97; }
  if (a.kind === 'chronic' && d < (a.from ?? '')) pAbs = 0.04;
  const r = u('att', l.key, d);
  return r < pAbs ? (u('exc', l.key, d) < 0.25 ? 'excused' : 'absent') : r < pAbs + pLate ? 'late' : 'present';
}

// ---------------------------------------------------------------- state
type Account = { name: string; email: string; password: string; role: string; userId?: string; membershipId?: string };
type State = {
  schoolId?: string; accounts: Record<string, Account>; yearIds: string[]; termIds: Record<string, string>; classIds: string[][]; subjectIds: string[]; indicatorIds: string[][];
  learners: Record<string, string>; enrol: Record<string, string>; links: Record<string, string>; regs: Record<string, { s: string; v: number }>; eyPolicies: Record<string, any>;
  done: Record<string, number | string | boolean>; log: string[]; findings: string[]; calls: number; started?: string;
};
const empty = (): State => ({ accounts: {}, yearIds: [], termIds: {}, classIds: [[], []], subjectIds: [], indicatorIds: [], learners: {}, enrol: {}, links: {}, regs: {}, eyPolicies: {}, done: {}, log: [], findings: [], calls: 0 });
let state: State = existsSync(STATE) ? { ...empty(), ...JSON.parse(readFileSync(STATE, 'utf8')) } : empty();
let dirty = false;
const flush = () => { if (!dirty) return; mkdirSync(DIR, { recursive: true }); writeFileSync(`${STATE}.tmp`, JSON.stringify(state)); renameSync(`${STATE}.tmp`, STATE); dirty = false; };
const save = () => { dirty = true; };
setInterval(flush, 3000).unref();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { flush(); process.exit(130); });
const step = (text: string) => { console.log(`· ${text}`); state.log.push(`${new Date().toISOString()} ${text}`); if (state.log.length > 300) state.log.shift(); save(); };
const finding = (text: string) => { console.log(`! ${text}`); if (!state.findings.includes(text)) state.findings.push(text); save(); };
const strongPassword = () => `Sdm-${randomBytes(9).toString('base64url')}-26`;
const demoPassword = () => `Sunrise-${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}-2026`;

// ---------------------------------------------------------------- HTTP as a signed-in person
let nextSlot = 0;
// The API allows 30 sign-in attempts a minute per address; stay well under it.
const signIns: number[] = [];
async function signInSlot() {
  for (;;) {
    const now = Date.now();
    while (signIns.length && now - signIns[0]! > 60000) signIns.shift();
    if (signIns.length < 18) { signIns.push(now); return; }
    await sleep(60000 - (now - signIns[0]!) + 200);
  }
}
async function pace() { if (!PACE_MS) return; const now = Date.now(), at = Math.max(now, nextSlot); nextSlot = at + PACE_MS; if (at > now) await sleep(at - now); }
class Person {
  cookie = ''; csrf = '';
  constructor(readonly key: string) {}
  get account() { return state.accounts[this.key]!; }
  private async auth(route: string, body: unknown) {
    for (let attempt = 1; ; attempt++) {
      await pace();
      if (route === 'login') await signInSlot();
      let r: Response;
      try { r = await fetch(`${API}/auth/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: this.cookie, ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}) }, body: JSON.stringify(body) }); }
      catch (error) { if (attempt < 6) { await sleep(2000 * attempt); continue; } throw error; }
      const text = await r.text();
      if ([502, 503, 504, 429].includes(r.status) && attempt < 8) { await sleep(Math.min(60000, (r.status === 429 ? 15000 : 4000) * attempt)); continue; }
      if (!r.ok) throw Object.assign(new Error(`auth/${route} for ${this.account.email} → ${r.status} ${text.slice(0, 200)}`), { status: r.status });
      const cookies = r.headers.getSetCookie().map(c => c.split(';')[0]);
      if (cookies.length) this.cookie = cookies.join('; ');
      const json = text ? JSON.parse(text) : {};
      if (json.csrfToken) this.csrf = json.csrfToken;
      return json;
    }
  }
  async login(desired?: string) {
    await this.auth('login', { email: this.account.email, password: this.account.password });
    const session = await this.session();
    if (session.mustChangePassword) {
      const next = desired ?? strongPassword();
      await this.auth('change-password', { currentPassword: this.account.password, newPassword: next });
      this.account.password = next; save(); flush();
      await this.auth('login', { email: this.account.email, password: next });
    }
    return this;
  }
  async rotate(next: string) {
    await this.auth('change-password', { currentPassword: this.account.password, newPassword: next });
    this.account.password = next; save(); flush();
    await this.auth('login', { email: this.account.email, password: next });
  }
  register(schoolName: string) { return this.auth('register', { name: this.account.name, schoolName, email: this.account.email, password: this.account.password }); }
  async session() { await pace(); const r = await fetch(`${API}/auth/session`, { headers: { cookie: this.cookie } }); return r.json(); }
  async call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', route: string, body?: Record<string, unknown>, key?: string): Promise<T> {
    const plain = route.startsWith('/accounts') || route.startsWith('/assistant/') || route === '';
    const id = key ? uuidFrom(`${state.schoolId}|${RUN}|${key}`) : randomUUID();
    const payload = method === 'GET' ? undefined : JSON.stringify(plain ? body ?? {} : { operationId: id, ...body });
    for (let attempt = 1; ; attempt++) {
      await pace();
      let r: Response;
      try { r = await fetch(`${API}/schools/${state.schoolId}${route}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, 'x-csrf-token': this.csrf }, body: payload }); }
      catch (error) { if (attempt < 7) { await sleep(Math.min(30000, 2000 * attempt)); continue; } throw error; }
      const text = await r.text();
      state.calls++;
      if (r.status === 401 && attempt < 3) { await this.auth('login', { email: this.account.email, password: this.account.password }); continue; }
      const transient = [502, 503, 504, 429].includes(r.status) || (r.status === 500 && (method === 'GET' || !plain));
      if (transient && attempt < 9) { await sleep(Math.min(60000, (r.status === 429 ? 15000 : 3000) * attempt)); continue; }
      if (!r.ok) throw Object.assign(new Error(`${this.account.role} ${method} ${route} → ${r.status} ${text.slice(0, 300)}`), { status: r.status, body: text });
      return (text ? JSON.parse(text) : null) as T;
    }
  }
  get = <T = any>(route: string) => this.call<T>('GET', route);
  post = <T = any>(route: string, body: Record<string, unknown> = {}, key?: string) => this.call<T>('POST', route, body, key);
  put = <T = any>(route: string, body: Record<string, unknown> = {}, key?: string) => this.call<T>('PUT', route, body, key);
}
const sessions = new Map<string, Person>();
async function as(key: string) {
  if (!sessions.has(key)) {
    if (!state.accounts[key]) throw new Error(`No demo account ${key}`);
    sessions.set(key, await new Person(key).login());
  }
  return sessions.get(key)!;
}
const teacherKey = (c: number) => `teacher${c}`;
const actorFor = (t: TermDef, c: number) => t.year === 0 ? as('head') : as(teacherKey(c));
async function all<T = any>(person: Person, route: string) {
  const items: T[] = [];
  for (let offset = 0; ; offset += 100) { const page = await person.get(`${route}${route.includes('?') ? '&' : '?'}limit=100&offset=${offset}`); items.push(...page.items); if (page.items.length < 100) break; }
  return items;
}
async function pool<T>(items: T[], work: (item: T) => Promise<void>, label: string, size = CONCURRENCY) {
  if (!items.length) return;
  let next = 0, finished = 0, failed = 0, streak = 0, aborted = false, last = Date.now();
  const errors: string[] = [], started = Date.now();
  const worker = async () => {
    while (!aborted) {
      const i = next++; if (i >= items.length) return;
      try { await work(items[i]!); streak = 0; }
      catch (error) { failed++; streak++; const m = error instanceof Error ? error.message : String(error); errors.push(m); if (errors.length <= 3) console.error(`  ✗ ${label}: ${m}`); if (streak >= 12) aborted = true; }
      finished++;
      if (Date.now() - last > 20000) { last = Date.now(); console.log(`  ${label}: ${finished}/${items.length} (${(finished / ((Date.now() - started) / 1000)).toFixed(1)}/s, ${state.calls} calls so far)`); flush(); }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  flush();
  if (failed) throw new Error(`${label}: ${failed} of ${items.length} failed${aborted ? ' (stopped early)' : ''}. First: ${errors[0]}`);
}
const done = (key: string) => state.done[key] !== undefined;
const mark = (key: string, value: number | string | boolean = true) => { state.done[key] = value; save(); };
const idOf = (l: L) => state.learners[l.key]!;
const classId = (y: number, c: number) => state.classIds[y]![c]!;

// ---------------------------------------------------------------- setup: school, staff, calendar, subjects, curriculum, early-years guides, fee items
const STAFF: { key: string; name: string; role: string; email: string }[] = [
  { key: 'bursar', name: 'Joseph Kwarteng', role: 'accountant', email: `accounts@${DOMAIN}` },
  { key: 'frontdesk', name: 'Michael Tetteh', role: 'frontdesk', email: `frontdesk@${DOMAIN}` },
  ...TEACHER_NAMES.map((name, c) => ({ key: teacherKey(c), name, role: 'teacher', email: c === BASIC6 ? `teacher@${DOMAIN}` : `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DOMAIN}` })),
];
async function ensureAccounts(items: { key: string; name: string; role: string; email: string }[]) {
  const head = await as('head');
  const known = new Map(((await head.get('/accounts')).items as { user_id: string; membership_id: string; login: string }[]).map(a => [a.login, a]));
  for (const a of items) {
    if (state.accounts[a.key]?.userId && state.accounts[a.key]?.membershipId) continue;
    const exist = known.get(a.email);
    if (exist) {
      const reset = await head.post(`/accounts/${exist.user_id}/reset-password`);
      state.accounts[a.key] = { name: a.name, email: a.email, role: a.role, password: reset.temporaryPassword, userId: exist.user_id, membershipId: exist.membership_id };
    } else {
      const created = await head.post('/accounts', { name: a.name, email: a.email, role: a.role });
      state.accounts[a.key] = { name: a.name, email: a.email, role: a.role, password: created.temporaryPassword, userId: created.userId };
    }
    save();
  }
  const list = (await head.get('/accounts')).items as { user_id: string; membership_id: string; login: string }[];
  for (const a of Object.values(state.accounts)) { const row = list.find(x => x.login === a.email); if (row) { a.userId = row.user_id; a.membershipId = row.membership_id; } }
  save(); flush();
}
async function setup() {
  if (!state.schoolId) {
    step(`Headteacher signs up ${SCHOOL_NAME}`);
    state.accounts.head = { name: 'Samuel Owusu-Ansah', email: `headteacher@${DOMAIN}`, password: demoPassword(), role: 'headteacher' };
    const head = new Person('head');
    await head.register(SCHOOL_NAME);
    const session = await head.session();
    state.schoolId = session.schools.find((s: { name: string }) => s.name === SCHOOL_NAME)?.id;
    if (!state.schoolId) throw new Error('Sign-up did not return the new school');
    sessions.set('head', head); state.started = new Date().toISOString(); save(); flush();
  }
  const head = await as('head');
  step('Staff accounts: bursar, front desk and thirteen class teachers');
  await ensureAccounts(STAFF);

  step('Academic year 2025/26, its three terms and thirteen classes');
  if (!state.yearIds[0]) { state.yearIds[0] = (await head.post('/academic-years', { name: YEARS[0]!.name, startDate: YEARS[0]!.start, endDate: YEARS[0]!.end }, 'year0')).id; save(); }
  for (const t of TERMS.filter(x => x.year === 0)) if (!state.termIds[t.key]) { state.termIds[t.key] = (await head.post('/assessment/terms', { academicYearId: state.yearIds[0], name: t.name, startDate: t.start, endDate: t.end }, `term:${t.key}`)).id; save(); }
  for (const [c, def] of CLASSES.entries()) if (!state.classIds[0]![c]) { state.classIds[0]![c] = (await head.post('/classes', { name: def.name, level: def.level, capacity: SIZES[c]! + 6, academicYearId: state.yearIds[0] }, `class:0:${c}`)).id; save(); }

  step('Subjects, the grading policy (30% class score, 70% examination) and the school\'s curriculum topics');
  for (const [s, name] of SUBJECTS.entries()) if (!state.subjectIds[s]) { state.subjectIds[s] = (await head.post('/assessment/subjects', { name }, `subject:${s}`)).id; save(); }
  const policy = await head.get('/assessment/policy');
  if (!policy?.policy) await head.put('/assessment/policy', {
    caWeight: 30, examWeight: 70, caParts: { exercises: 30, homework: 30, tests: 40, projects: 0 }, sourceNote: 'GES basic school terminal report: class score 30%, end-of-term examination 70%; bands adopted by the Sunrise academic board for the 2025/2026 year',
    bands: [{ min: 80, grade: '1', remark: 'Highest' }, { min: 70, grade: '2', remark: 'Higher' }, { min: 60, grade: '3', remark: 'High' }, { min: 55, grade: '4', remark: 'High average' }, { min: 50, grade: '5', remark: 'Average' }, { min: 45, grade: '6', remark: 'Low average' }, { min: 40, grade: '7', remark: 'Low' }, { min: 35, grade: '8', remark: 'Lower' }, { min: 0, grade: '9', remark: 'Lowest' }],
  }, 'policy');
  if (!done('indicators')) {
    for (const [s, list] of TOPICS.entries()) await head.post('/assessment/indicators', { subjectId: state.subjectIds[s], origin: 'local', sourceNote: 'Sunrise International School scheme of work (demo school topics, not curriculum text)', items: list.map(([description]) => ({ description })) }, `indicators:${s}`);
    for (const [s, grade, items] of GRADE_INDICATORS) await head.post('/assessment/indicators', { subjectId: state.subjectIds[s], origin: 'local', grade, sourceNote: 'Sunrise International School scheme of work (demo school topics, not curriculum text)', items: items.map(description => ({ description })) }, `indicators:${s}:${grade}`);
    mark('indicators');
  }
  state.indicatorIds = [];
  for (const [s, list] of TOPICS.entries()) {
    const added = (await head.get(`/assessment/indicators?subjectId=${state.subjectIds[s]}`)).items as { id: string; description: string; grade: string | null }[];
    state.indicatorIds.push(list.map(([description]) => added.find(i => i.description === description && !i.grade)!.id));
  }
  save();
  if (!done('practice')) {
    for (const [s, topic, items] of PRACTICE) {
      const indicatorId = state.indicatorIds[s]![TOPICS[s]!.findIndex(([d]) => d === topic)]!;
      for (const [n, r] of items.entries()) await head.post(`/assessment/indicators/${indicatorId}/resources`, r, `practice:${s}:${topic}:${n}`);
    }
    mark('practice');
  }

  step('Nursery and KG observation guides (school-local, approved by the headteacher)');
  for (const level of ['Nursery', 'KG']) if (!state.eyPolicies[level]) {
    const created = await head.post('/early-years/policies', {
      level, title: `${level} observation guide`, sourceKind: 'school_local', sourceIssuer: 'Sunrise early years team', sourceReference: `Sunrise ${level} learning goals, reviewed for 2025/2026`, sourceVersion: '2025-1', effectiveStart: '2025-08-25',
      ...(level === 'Nursery' ? { specialistName: 'Mrs. Adwoa Frimpong', specialistQualification: 'Early childhood development specialist, University of Education, Winneba', specialistReviewReference: 'Academic board minute 4, August 2025', specialistReviewedOn: '2025-08-20' } : {}),
      indicators: EY_INDICATORS.map(([code, title, learningArea, strand, subStrand, descriptors]) => ({ code, title, learningArea, strand, subStrand, descriptors: descriptors.map((text, n) => ({ id: uuidFrom(`${RUN}|descriptor|${code}|${n}`), text })) })),
    }, `eypolicy:${level}`);
    await head.post(`/early-years/policies/${created.id}/approve`, { version: created.version }, `eypolicy:${level}:approve`);
    const listed = await head.get(`/early-years/policies?level=${level}`);
    state.eyPolicies[level] = (listed.items ?? listed).find((p: { id: string }) => p.id === created.id) ?? created; save();
  }

  step('Term fee items for 2025/26');
  await feeItems(T('t1')); await feeItems(T('t2')); await feeItems(T('t3'));
  mark('setup');
}
async function feeItems(t: TermDef) {
  if (done(`feeitems:${t.key}`)) return;
  const bursar = await as('bursar');
  for (const [n, f] of FEES.entries()) await bursar.post('/finance/fee-items', { termId: state.termIds[t.key], name: f.name, amountPesewas: f.amount + (f.name === 'Tuition' && t.key === 't4' ? 5000 : 0), ...('level' in f ? { level: f.level } : {}) }, `feeitem:${t.key}:${n}`);
  mark(`feeitems:${t.key}`);
}

// ---------------------------------------------------------------- roll: the learners on the books at the start of 2025/26, and their guardians
async function enrolmentId(l: L, y: 0 | 1, c: number) {
  const k = `${l.key}|${y}|${c}`;
  if (!state.enrol[k]) {
    const head = await as('head');
    const detail = await head.get(`/learners/${idOf(l)}`);
    for (const e of detail.enrolments as { id: string; class_id: string; superseded_at: string | null }[]) if (!e.superseded_at) { const yc = state.classIds.findIndex(ids => ids.includes(e.class_id)); const ci = state.classIds[yc]!.indexOf(e.class_id); state.enrol[`${l.key}|${yc}|${ci}`] = e.id; }
    save();
  }
  return state.enrol[k]!;
}
async function ensureGuardians(subset: L[]) {
  const head = await as('head');
  const fams = [...new Set(subset.filter(l => l.family >= 0).map(l => l.family))];
  await ensureAccounts(fams.map(f => ({ key: `family${f}`, name: model.families[f]!.name, role: 'guardian', email: model.families[f]!.login })));
  const todo = subset.filter(l => l.family >= 0 && !state.links[l.key]);
  await pool(todo, async l => {
    const fam = state.accounts[`family${l.family}`]!;
    const link = await head.post('/guardian-links', { learnerId: idOf(l), guardianMembershipId: fam.membershipId, academic: true, billing: true, pickup: true, contact: true }, `link:${l.key}`);
    await head.post(`/guardian-links/${link.id}/verify`, { version: link.version, reason: 'Birth certificate and guardian Ghana Card checked against the admission file' }, `link:${l.key}:verify`);
    state.links[l.key] = link.id; save();
  }, 'guardian links');
}
async function roll() {
  const head = await as('head');
  const missing = model.learners.filter(l => l.csv && !state.learners[l.key]);
  if (missing.length) {
    step(`Existing learners brought in from the admission registers, one CSV per class (${missing.length})`);
    for (const c of Array.from(new Set(missing.map(l => l.c0))).sort((a, b) => a - b)) {
      const rows = missing.filter(l => l.c0 === c);
      const csv = ['Full Name,Admission No.,Date of Birth,Sex', ...rows.map(r => `${r.name},${r.admission},${r.dob},${r.sex}`)].join('\n');
      let batch = await head.post('/learner-imports', { sourceName: `${CLASSES[c]!.name} register 2025-26.csv`, classId: classId(0, c), startDate: YEARS[0]!.start, dateFormat: 'iso', csv }, `import:${c}`);
      batch = await head.post(`/learner-imports/${batch.id}/validate`, { version: batch.version }, `import:${c}:validate`);
      const detail = await head.get(`/learner-imports/${batch.id}`);
      const problems = (detail.rows ?? []).filter((r: { validation?: { issues?: string[] } }) => r.validation?.issues?.length);
      if (problems.length) finding(`Import ${CLASSES[c]!.name}: ${problems.length} row(s) flagged: ${JSON.stringify(problems.slice(0, 2).map((r: { validation: unknown }) => r.validation)).slice(0, 300)}`);
      const selectable = (detail.rows ?? []).filter((r: { validation?: { issues?: string[] } }) => !r.validation?.issues?.length);
      await head.post(`/learner-imports/${batch.id}/commit`, { version: detail.version, approvalReason: `Checked against the ${CLASSES[c]!.name} admission register by the headteacher`, selectedRows: selectable.map((r: { row_number: number }) => ({ rowNumber: r.row_number })) }, `import:${c}:commit`);
    }
    const roll = await all(head, '/learners?');
    for (const l of model.learners) { const found = roll.find((x: { admission_number: string }) => x.admission_number === l.admission); if (found) state.learners[l.key] = found.id; }
    save(); flush();
    const absent = model.learners.filter(l => l.csv && !state.learners[l.key]);
    if (absent.length) throw new Error(`${absent.length} imported learners are not on the roll: ${absent.slice(0, 3).map(l => l.admission).join(', ')}`);
  }
  step('Guardian accounts and verified links for the starting roll');
  await ensureGuardians(model.learners.filter(l => l.csv));
  step('Early-years enrolment ids');
  await pool(model.learners.filter(l => l.csv && l.c0 < 4), async l => { await enrolmentId(l, 0, l.c0); }, 'enrolments');
  mark('roll');
}

// ---------------------------------------------------------------- a term's registers
async function schoolDays(t: TermDef) {
  const head = await as('head');
  await pool(termDays(t).filter(d => !done(`day:${d}`)), async d => {
    await head.post('/attendance/school-days', { day: d, isOpen: !CLOSED[d], reason: CLOSED[d] ?? 'Normal school day' }, `day:${d}`);
    mark(`day:${d}`);
  }, `${t.key} school days`);
}
async function registers(t: TermDef) {
  const head = await as('head');
  const lockBefore = t.key === 't4' ? mondayOf(TODAY) : '9999-12-31';
  const jobs: { d: string; c: number }[] = [];
  for (const d of openDays(t)) for (let c = 0; c < 13; c++) if (rosterOn(t.year, c, d).length) jobs.push({ d, c });
  const target = (d: string, c: number) => d < lockBefore ? 'locked' : d === TODAY && u('today', c) >= 0.62 ? 'none' : 'submitted';
  const todo = jobs.filter(j => { const cur = state.regs[`${j.d}|${t.year}|${j.c}`]?.s ?? 'none'; const want = target(j.d, j.c); return want !== 'none' && cur !== want && cur !== 'locked'; });
  step(`${t.key}: ${todo.length} registers to take or finish (${jobs.length} school-day registers in all)`);
  await pool(todo, async ({ d, c }) => {
    const rk = `${d}|${t.year}|${c}`, want = target(d, c), cid = classId(t.year, c);
    const person = await actorFor(t, c);
    const build = (rows: { id: string }[]) => rows.map(r => ({ learnerId: r.id, mark: attendanceMark(model.learners.find(l => idOf(l) === r.id)!, d, t) }));
    let marks = rosterOn(t.year, c, d).map(l => ({ learnerId: idOf(l), mark: attendanceMark(l, d, t) }));
    let cur = state.regs[rk] ?? { s: 'none', v: 0 };
    if (cur.s === 'none') {
      try { cur = { s: 'draft', v: (await person.post(`/attendance/classes/${cid}/register`, { day: d, version: 0, action: 'save', marks }, `reg:${rk}:save`)).version }; }
      catch (error) {
        if ((error as { status?: number }).status !== 400) throw error;
        const register = await person.get(`/attendance/classes/${cid}/register?day=${d}`);
        marks = build(register.items);
        finding(`Roster mismatch on ${d} for ${CLASSES[c]!.name}: the model had ${rosterOn(t.year, c, d).length}, the API ${register.items.length}`);
        cur = { s: 'draft', v: (await person.post(`/attendance/classes/${cid}/register`, { day: d, version: register.version, action: 'save', marks }, `reg:${rk}:save2`)).version };
      }
      state.regs[rk] = cur; save();
    }
    if (cur.s === 'draft') { cur = { s: 'submitted', v: (await person.post(`/attendance/classes/${cid}/register`, { day: d, version: cur.v, action: 'submit', marks }, `reg:${rk}:submit`)).version }; state.regs[rk] = cur; save(); }
    if (cur.s === 'submitted' && want === 'locked') { cur = { s: 'locked', v: (await head.post(`/attendance/classes/${cid}/register`, { day: d, version: cur.v, action: 'lock', marks }, `reg:${rk}:lock`)).version }; state.regs[rk] = cur; save(); }
  }, `${t.key} registers`);
}

// ---------------------------------------------------------------- a term's class work: one dated assessment a week per core subject
async function classWorkFor(t: TermDef) {
  const jobs: { c: number; s: number; w: number; date: string }[] = [];
  for (const { w, date } of weeks(t)) for (const c of GRADED) for (let s = 0; s < CORE; s++) if (!done(`work:${t.key}:${c}:${s}:${w}`)) jobs.push({ c, s, w, date });
  step(`${t.key}: ${jobs.length} class assessments to record`);
  await pool(jobs, async ({ c, s, w, date }) => {
    const person = await actorFor(t, c), cid = classId(t.year, c), cohort = cohortOf(t.year, c);
    const [kind, label, max] = KINDS[(w + s) % 4]!, topic = topicAt(cohort, s, w);
    const k = `work:${t.key}:${c}:${s}:${w}`;
    let aid = state.done[`${k}:id`] as string | undefined;
    if (!aid) { aid = (await person.post(`/assessment/classes/${cid}/assessments`, { termId: state.termIds[t.key], subjectId: state.subjectIds[s], kind, title: `${label} ${w + 1}: ${TOPICS[s]![topic]![0]}`, heldOn: date, maxMark: max, indicatorIds: [state.indicatorIds[s]![topic]] }, k)).id as string; mark(`${k}:id`, aid); }
    const marks = rosterOn(t.year, c, date).map(l => ({ learnerId: idOf(l), mark: markOf(workPercent(l, t, c, s, w), max) }));
    await person.post(`/assessment/classes/${cid}/assessments/${aid}/marks`, { marks }, `${k}:marks`);
    mark(k);
  }, `${t.key} class work`);
}

// ---------------------------------------------------------------- mock exams
const MOCKS: { t: TermKey; c: number; title: string; date: string }[] = [
  { t: 't1', c: 12, title: 'Mock 1', date: '2025-11-20' }, { t: 't2', c: 12, title: 'Mock 2', date: '2026-03-12' }, { t: 't3', c: 12, title: 'Mock 3', date: '2026-05-14' },
  { t: 't3', c: 11, title: 'Mock 1', date: '2026-06-18' }, { t: 't4', c: 12, title: 'Mock 1', date: '2026-09-23' }, { t: 't4', c: 12, title: 'Mock 2', date: '2026-10-08' },
];
async function mocks(t: TermDef) {
  for (const m of MOCKS.filter(x => x.t === t.key && x.date <= TODAY)) {
    const k = `mock:${m.t}:${m.c}:${m.title}`;
    if (done(k)) continue;
    const person = await actorFor(t, m.c), cid = classId(t.year, m.c);
    step(`${t.key}: ${CLASSES[m.c]!.name} ${m.title}`);
    await person.post(`/assessment/classes/${cid}/mocks`, { termId: state.termIds[t.key], title: m.title, heldOn: m.date, maxMark: 100, subjectIds: state.subjectIds }, k);
    const rounds = (await person.get(`/assessment/classes/${cid}/mocks`)).rounds as { title: string; subjects: { assessmentId: string; subjectId: string }[] }[];
    const round = Number(m.title.split(' ')[1]);
    for (const sub of rounds.find(r => r.title === m.title)!.subjects) {
      const s = state.subjectIds.indexOf(sub.subjectId);
      await person.post(`/assessment/classes/${cid}/assessments/${sub.assessmentId}/marks`, { marks: rosterOn(t.year, m.c, m.date).map(l => ({ learnerId: idOf(l), mark: mockPercent(l, t, round, s) })) }, `${k}:marks:${s}`);
    }
    mark(k);
  }
}

// ---------------------------------------------------------------- early years: weekly observations and narrative reports
async function observations(t: TermDef) {
  const jobs: { l: L; c: number; w: number; date: string }[] = [];
  for (const { w } of weeks(t)) {
    const m = addDays(mondayOf(t.start), 7 * w);
    for (const c of EARLY) for (const l of model.learners) {
      const cands = [2, 1, 3].map(k => addDays(m, k)).filter(d => d >= t.start && d <= t.end && d <= TODAY && !CLOSED[d]);
      const date = cands[Math.floor(u('obsday', l.key, w) * cands.length)];
      if (date && onRoll(l, t.year, c, date) && !done(`obs:${t.key}:${l.key}:${w}`)) jobs.push({ l, c, w, date });
    }
  }
  step(`${t.key}: ${jobs.length} early-years observations`);
  await pool(jobs, async ({ l, c, w, date }) => {
    const person = await actorFor(t, c), policy = state.eyPolicies[CLASSES[c]!.level];
    const entries = (policy.indicators as { id: string; descriptors: { id: string }[] }[]).filter((_, n) => u('obsind', l.key, w, n) < 0.62).map((ind, n) => {
      const seen = u('obsseen', l.key, w, n) < 0.85;
      return seen ? { indicatorId: ind.id, status: 'observed', descriptorId: ind.descriptors[Math.floor(u('obsdesc', l.key, w, n) * ind.descriptors.length)]!.id, evidence: EVIDENCE[Math.floor(u('obsev', l.key, w, n) * EVIDENCE.length)] } : { indicatorId: ind.id, status: 'not_observed' };
    });
    if (entries.length) await person.post(`/early-years/classes/${classId(t.year, c)}/observations`, { learnerId: idOf(l), enrolmentId: await enrolmentId(l, t.year, c), observedOn: date, policyId: policy.id, entries }, `obs:${t.key}:${l.key}:${w}`);
    mark(`obs:${t.key}:${l.key}:${w}`);
  }, `${t.key} observations`);
}
async function eyReports(t: TermDef) {
  const head = await as('head');
  const past = t.key !== 't4';
  const periodEnd = past ? t.end : addDays(mondayOf(TODAY), -3);
  const jobs: { l: L; c: number }[] = [];
  for (const c of EARLY) for (const l of model.learners) if (l.segs.some(s => s.y === t.year && s.c === c && s.from <= t.start && (!s.to || s.to > periodEnd)) && !done(`eyrep:${t.key}:${l.key}`)) jobs.push({ l, c });
  step(`${t.key}: ${jobs.length} narrative progress reports`);
  await pool(jobs, async ({ l, c }) => {
    const author = await actorFor(t, c), k = `eyrep:${t.key}:${l.key}`, [strengths, nextSteps] = REPORT_TEXTS[Math.floor(u('eytext', l.key, t.key) * REPORT_TEXTS.length)]!;
    // Past terms are published. In the running term each class has reports at every stage of review.
    const stage = past ? 3 : Math.floor(u('eystage', l.key) * 4);
    const report = await author.post('/early-years/reports', { learnerId: idOf(l), enrolmentId: await enrolmentId(l, t.year, c), periodStart: t.start, periodEnd, strengths, nextSteps }, `${k}:create`);
    const base = `/early-years/report-revisions/${report.revisionId}`;
    if (stage >= 1) {
      let version = (await author.post(`${base}/submit`, { version: report.version }, `${k}:submit`)).version;
      if (stage >= 2) { version = (await head.post(`${base}/approve`, { version }, `${k}:approve`)).version; }
      if (stage >= 3) await head.post(`${base}/publish`, { version }, `${k}:publish`);
    }
    mark(k);
  }, `${t.key} early-years reports`);
}

// ---------------------------------------------------------------- fees
// Each family's paying habit for a term. Within a class the habits follow fixed shares, so no class is by chance the best or the worst;
// Basic 3 in 2026/27 is the class that struggles to pay. Kwame's family (the parent login) paid Term 3 only in part and has paid this term's first half.
function habitsFor(t: TermDef) {
  const out = new Map<string, string>();
  for (let c = 0; c < 13; c++) {
    const members = model.learners.filter(l => inTerm(l, t.year, c, t)).sort((a, b) => u('habit', a.key, t.key) - u('habit', b.key, t.key));
    const shares = t.key === 't4' ? (c === 6 ? [0.12, 0.26, 0.30, 0.32] : [0.44, 0.28, 0.17, 0.11]) : [0.55, 0.27, 0.12, 0.06];
    members.forEach((l, i) => { const q = (i + 0.5) / members.length; out.set(l.key, q < shares[0]! ? 'early' : q < shares[0]! + shares[1]! ? 'instalments' : q < shares[0]! + shares[1]! + shares[2]! ? 'late' : 'none'); });
  }
  for (const l of model.learners) {
    if (l.story === 'improver') out.set(l.key, t.key === 't3' ? 'late' : t.key === 't4' ? 'instalments' : 'early');
    if (l.story === 'kgparent') out.set(l.key, 'early');
  }
  return out;
}
const STAFF_WARDS = model.learners.filter(l => l.csv && l.c0 >= 4 && u('ward', l.key) < 0.02).slice(0, 3).map(l => l.key);
const BURSARIES = model.learners.filter(l => l.csv && l.c0 >= 4 && !STAFF_WARDS.includes(l.key) && u('bursary', l.key) < 0.02).slice(0, 2).map(l => l.key);
function discountFor(l: L, t: TermDef, level: string): { label: string; amount: number; reason: string } | null {
  if (STAFF_WARDS.includes(l.key)) return { label: 'Staff ward (50% tuition)', amount: tuitionOf(level, t) / 2, reason: 'Child of a member of staff; 50% of tuition by the board decision of September 2025' };
  if (BURSARIES.includes(l.key)) return { label: 'Bursary (Old Students Association)', amount: Math.round(tuitionOf(level, t) * 0.2 / 100) * 100, reason: 'Awarded by the Old Students Association after a home visit by the headteacher' };
  const fam = l.family >= 0 ? model.families[l.family]! : null;
  if (fam && fam.children.length >= 2 && fam.children[fam.children.length - 1] === l.key && u('sibling', l.key, t.key) < 0.5) return { label: 'Second-child discount (GH₵50)', amount: 5000, reason: 'Two children in the school: GH₵50 off the younger child\'s bill, per the PTA fees policy' };
  return null;
}
const nextWeekday = (d: string) => { let x = d; while (!weekday(x)) x = addDays(x, 1); return x; };
async function fees(t: TermDef) {
  const head = await as('head'), bursar = await as('bursar'), termId = state.termIds[t.key]!;
  await feeItems(t);
  if (!done(`invoices:${t.key}`)) {
    step(`${t.key}: invoices for every class`);
    for (let c = 0; c < 13; c++) if (model.learners.some(l => inTerm(l, t.year, c, t))) await bursar.post('/finance/invoices/generate', { termId, classId: classId(t.year, c) }, `invoices:${t.key}:${c}`);
    mark(`invoices:${t.key}`);
  }
  const invoices = await all(bursar, `/finance/invoices?termId=${termId}`);
  const byLearner = new Map<string, { id: string }>(invoices.map((i: { learner_id: string; id: string }) => [i.learner_id, i]));
  const levelOf = (c: number) => CLASSES[c]!.level;
  // Discounts, recorded by the headteacher with a reason.
  const discounts = model.learners.filter(l => byLearner.has(idOf(l))).map(l => ({ l, c: l.segs.find(s => s.y === t.year && inTerm(l, s.y, s.c, t))!.c })).map(x => ({ ...x, d: discountFor(x.l, t, levelOf(x.c)) })).filter(x => x.d);
  await pool(discounts.filter(x => !done(`discount:${t.key}:${x.l.key}`)), async ({ l, d }) => {
    const inv = byLearner.get(idOf(l))!;
    await head.post(`/finance/invoices/${inv.id}/adjustments`, { kind: 'discount', label: d!.label, amountPesewas: d!.amount, reason: d!.reason }, `discount:${t.key}:${l.key}`);
    mark(`discount:${t.key}:${l.key}`);
  }, `${t.key} discounts`);
  // Payments over the term at the bursar's desk.
  const length = Math.max(1, Math.round((day(t.end).getTime() - day(t.start).getTime()) / 864e5));
  const plan: { l: L; n: number; amount: number; on: string; invoiceId: string }[] = [];
  const habits = habitsFor(t);
  for (const l of model.learners) {
    const inv = byLearner.get(idOf(l)); if (!inv) continue;
    const c = l.segs.find(s => s.y === t.year && inTerm(l, s.y, s.c, t))!.c, level = levelOf(c);
    const due = feeTotal(level, t) - (discountFor(l, t, level)?.amount ?? 0), habit = habits.get(l.key) ?? 'none';
    const at = (lo: number, hi: number, n: number) => nextWeekday(addDays(t.start, Math.floor(lo + u('paydate', l.key, t.key, n) * (hi - lo))));
    const round = (x: number) => Math.round(x / 100) * 100;
    const parts: { amount: number; on: string }[] = [];
    if (habit === 'early') parts.push({ amount: due, on: at(0, 14, 0) });
    else if (habit === 'instalments') {
      const first = round(due / 2);
      parts.push({ amount: first, on: at(0, 21, 0) });
      const second = l.story === 'improver' ? false : t.key === 't4' ? u('second', l.key, t.key) < 0.2 : u('second', l.key, t.key) < 0.85;
      if (second) parts.push({ amount: due - first, on: t.key === 't4' ? at(28, 36, 1) : at(35, Math.min(70, length - 8), 1) });
    } else if (habit === 'late' && t.key !== 't4') { const part = l.story === 'improver' || u('latepart', l.key, t.key) < 0.5 ? round(due * 0.6) : due; parts.push({ amount: part, on: at(Math.min(55, length - 25), Math.min(80, length - 10), 0) }); }
    parts.forEach((p, n) => { if (p.amount > 0 && p.on <= TODAY && p.on <= t.end) plan.push({ l, n, amount: p.amount, on: p.on, invoiceId: inv.id }); });
  }
  if (t.key === 't2' && !done('reversal')) {
    step('t2: the bursar posts a payment to the wrong learner and the headteacher reverses it');
    const target = plan.length ? invoices.find((i: { id: string; learner_id: string }) => !plan.some(p => p.invoiceId === i.id)) : null;
    if (target) {
      const wrong = await bursar.post('/finance/payments', { invoiceId: target.id, amountPesewas: 30000, method: 'cash', receivedOn: addDays(t.start, 6) }, 'reversal:wrong');
      await head.post(`/finance/payments/${wrong.id}/reverse`, { reason: 'Posted to the wrong learner; the cash belongs to another family and was re-entered there' }, 'reversal:reverse');
    }
    mark('reversal');
  }
  step(`${t.key}: ${plan.filter(p => !done(`pay:${t.key}:${p.l.key}:${p.n}`)).length} payments to record`);
  await pool(plan.filter(p => !done(`pay:${t.key}:${p.l.key}:${p.n}`)).sort((a, b) => a.on.localeCompare(b.on)), async p => {
    const method = ['mobile_money', 'mobile_money', 'mobile_money', 'cash', 'cash', 'bank'][Math.floor(u('method', p.l.key, t.key, p.n) * 6)]!;
    const reference = method === 'mobile_money' ? `MoMo ${Math.floor(1e9 + u('ref', p.l.key, t.key, p.n) * 9e9)}` : method === 'bank' ? `GCB slip ${Math.floor(10000 + u('ref', p.l.key, t.key, p.n) * 89999)}` : undefined;
    await bursar.post('/finance/payments', { invoiceId: p.invoiceId, amountPesewas: p.amount, method, receivedOn: p.on, ...(reference ? { reference } : {}) }, `pay:${t.key}:${p.l.key}:${p.n}`);
    mark(`pay:${t.key}:${p.l.key}:${p.n}`);
  }, `${t.key} payments`);
}

// ---------------------------------------------------------------- scores, remarks and report cards for a finished term
async function results(t: TermDef) {
  const head = await as('head'), termId = state.termIds[t.key]!;
  const jobs: { c: number; s: number }[] = [];
  for (const c of GRADED) for (let s = 0; s < SUBJECTS.length; s++) if (!done(`scores:${t.key}:${c}:${s}`)) jobs.push({ c, s });
  step(`${t.key}: ${jobs.length} score sheets (class score and examination)`);
  await pool(jobs, async ({ c, s }) => {
    const present = model.learners.filter(l => inTerm(l, t.year, c, t));
    await head.post(`/assessment/classes/${classId(t.year, c)}/scores`, { termId, subjectId: state.subjectIds[s], scores: present.flatMap(l => [{ learnerId: idOf(l), kind: 'ca', score: caScore(l, t, c, s) }, { learnerId: idOf(l), kind: 'exam', score: examPercent(l, t, c, s) }]) }, `scores:${t.key}:${c}:${s}`);
    mark(`scores:${t.key}:${c}:${s}`);
  }, `${t.key} scores`);
  for (const c of GRADED) {
    if (done(`published:${t.key}:${c}`)) continue;
    const cid = classId(t.year, c), present = model.learners.filter(l => inTerm(l, t.year, c, t));
    const avg = (l: L) => { const subj = [...Array(SUBJECTS.length).keys()].map(s => 0.3 * caScore(l, t, c, s) + 0.7 * examPercent(l, t, c, s)); return subj.reduce((a, b) => a + b, 0) / subj.length; };
    const teacherRemark = (l: L) => avg(l) > 75 ? 'Excellent performance. Keep it up.' : avg(l) > 62 ? 'Good work. Can do better with more effort.' : avg(l) > 48 ? 'Fair performance. Needs to put in more effort.' : 'Weak performance. Needs extra support at home and in school.';
    await head.post(`/assessment/classes/${cid}/remarks`, { termId, author: 'class_teacher', items: present.map(l => ({ learnerId: idOf(l), conduct: CONDUCT[Math.floor(u('conduct', l.key, t.key) * CONDUCT.length)], attitude: ATTITUDE[Math.floor(u('attitude', l.key, t.key) * ATTITUDE.length)], interest: INTEREST[Math.floor(u('interest', l.key) * INTEREST.length)], remark: teacherRemark(l) })) }, `remarks:${t.key}:${c}:teacher`);
    const next = CLASSES[c + 1]?.name;
    await head.post(`/assessment/classes/${cid}/remarks`, { termId, author: 'headteacher', items: present.map(l => ({ learnerId: idOf(l), remark: t.key !== 't3' ? (avg(l) < 45 ? 'Parents please see the headteacher about extra support.' : 'Keep working hard.') : l.repeats ? `To repeat ${CLASSES[c]!.name}. Parents to see the headteacher.` : next ? `Promoted to ${next}.` : 'Completed basic school. We wish you well in senior high school.' })) }, `remarks:${t.key}:${c}:head`);
    const published = await head.post(`/assessment/classes/${cid}/publish`, { termId }, `publish:${t.key}:${c}`);
    step(`  ${CLASSES[c]!.name}: ${published.published} report cards published`);
    mark(`published:${t.key}:${c}`);
  }
}

// ---------------------------------------------------------------- support plans
async function supportPast(t: TermDef) {
  const head = await as('head');
  for (const p of [...model.plans.values()].filter(x => x.key.startsWith(`${t.key}|`))) {
    const k = `plan:${p.key}`; if (done(k)) continue;
    const l = model.byKey.get(p.learner)!, owner = state.accounts[teacherKey(p.classIdx)]!.membershipId;
    const start = weekDate(t, p.startW), first = weekDate(t, p.reviews[0]!.w);
    const plan = await head.post(`/assessment/classes/${classId(0, p.classIdx)}/support-plans`, { termId: state.termIds[t.key], subjectId: state.subjectIds[p.s], learnerIds: [idOf(l)], concern: `${SUBJECTS[p.s]}: marks mostly below 50% in the first weeks of the term.`, action: p.reviews.length > 1 ? 'Re-teach key topics in a small group twice a week and set short practice for home.' : 'One-to-one help during break and a peer helper in class.', ownerMembershipId: owner, startDate: start, reviewDate: first }, k);
    for (const [n, r] of p.reviews.entries()) {
      await head.post(`/support-plans/${plan.id}/reviews`, { reviewedOn: weekDate(t, r.w), outcome: r.outcome, note: r.outcome === 'improved' ? 'Class work marks have risen since the plan began and the learner is completing exercises. Closing the plan.' : 'Attending the sessions but marks have not moved yet. Continuing with a change to the practice set.', decision: r.decision, ...(r.next ? { nextReviewDate: weekDate(t, r.next) } : {}) }, `${k}:review${n}`);
    }
    mark(k);
  }
}
// The current term: plans the class teachers wrote, at every stage (improving, overdue, due today, closed).
async function supportNow() {
  const t = T('t4');
  const byStory = (s: string) => model.learners.find(l => l.story === s)!;
  const d = (n: number) => weekDate(t, n);
  const specs: { k: string; c: number; s: number; topic?: string; story?: string; group?: boolean; start: string; review: string; concern: string; action: string; familyNote?: string; reviews?: { on: string; outcome: string; decision: string; note: string; next?: string }[] }[] = [
    { k: 'kwame', c: BASIC6, s: 1, topic: 'Fractions', story: 'improver', start: d(1), review: '2026-10-08', concern: 'Mathematics: Kwame\'s lowest subject; marks below 40% on fractions in the first weeks.', action: 'Small-group fractions practice on Tuesdays and Thursdays, with fraction strips.', familyNote: 'Fold a sheet of paper into halves, quarters and eighths with Kwame and ask which piece is bigger. A few minutes most evenings helps.', reviews: [{ on: '2026-10-08', outcome: 'improved', decision: 'continue', note: 'Fractions marks are rising week by week and Kwame now volunteers answers. Continuing for two more weeks.', next: '2026-10-22' }] },
    { k: 'fractions', c: BASIC6, s: 1, topic: 'Fractions', group: true, start: d(2), review: '2026-10-12', concern: 'Several learners average below 50% on Fractions across this term\'s assessments.', action: 'Re-teach in a small group on Tuesdays and Thursdays. Extra practice exercises.' },
    { k: 'maps', c: BASIC6, s: 3, topic: 'Map reading', group: true, start: d(2), review: TODAY, concern: 'Several learners average below 50% on Map reading across this term\'s assessments.', action: 'Draw and label the school compound map in pairs; revisit the compass directions.' },
    { k: 'kojo', c: 7, s: 1, story: 'absentee', start: d(2), review: addDays(TODAY, 1), concern: 'Mathematics: marks have fallen since absences began in mid-September.', action: 'Catch-up sheets for missed lessons and a call to the guardian about attendance.' },
    { k: 'akua', c: 12, s: 0, story: 'mock26', start: d(2), review: TODAY, concern: 'English: below 50% in two or more subjects in Mock 1.', action: 'Weekly essay practice with feedback; extra comprehension passages.' },
    { k: 'closed', c: 5, s: 0, start: d(0), review: '2026-09-30', concern: 'English: reading comprehension marks below 40% in the first week.', action: 'Daily guided reading for ten minutes.', reviews: [{ on: '2026-09-30', outcome: 'improved', decision: 'close', note: 'Reads aloud with confidence and class exercises are above 55%. Closing the plan.' }] },
    { k: 'compose', c: 11, s: 0, topic: 'Composition writing', group: true, start: d(1), review: '2026-10-08', concern: 'Several learners average below 50% on Composition writing this term.', action: 'Plan-write-check routine each Friday.', reviews: [{ on: '2026-10-08', outcome: 'no_change', decision: 'continue', note: 'Plans are done but the writing is still short. Adding a sentence-starter bank.', next: '2026-10-22' }] },
  ];
  for (const sp of specs) {
    const key = `plan:t4:${sp.k}`; if (done(key) || sp.start > TODAY || sp.review <= sp.start) continue;
    const teacher = await as(teacherKey(sp.c)), cid = classId(1, sp.c), termId = state.termIds.t4!;
    let learnerIds: string[];
    let indicatorId: string | undefined;
    if (sp.topic) indicatorId = state.indicatorIds[sp.s]![TOPICS[sp.s]!.findIndex(([x]) => x === sp.topic)];
    if (sp.group) {
      const gaps = (await teacher.get(`/assessment/classes/${cid}/gaps?termId=${termId}&subjectId=${state.subjectIds[sp.s]}`)).items as { indicatorId: string; below: { learnerId: string }[] }[];
      learnerIds = (gaps.find(g => g.indicatorId === indicatorId)?.below ?? []).map(b => b.learnerId).slice(0, 12);
      if (learnerIds.length < 2) { finding(`Support plan ${sp.k}: fewer than two learners below 50% on the topic yet, so it was skipped`); continue; }
    } else {
      const l = sp.story ? byStory(sp.story) : rosterOn(1, sp.c, TODAY).sort((a, b) => a.ability - b.ability)[0]!;
      learnerIds = [idOf(l)];
    }
    const plan = await teacher.post(`/assessment/classes/${cid}/support-plans`, { termId, subjectId: state.subjectIds[sp.s], ...(indicatorId ? { indicatorId } : {}), learnerIds, concern: sp.concern, action: sp.action, ...(sp.familyNote ? { familyNote: sp.familyNote } : {}), startDate: sp.start, reviewDate: sp.review }, key);
    for (const [n, r] of (sp.reviews ?? []).entries()) if (r.on <= TODAY) await teacher.post(`/support-plans/${plan.id}/reviews`, { reviewedOn: r.on, outcome: r.outcome, note: r.note, decision: r.decision, ...(r.next ? { nextReviewDate: r.next } : {}) }, `${key}:review${n}`);
    mark(key);
  }
  // The parent persona's younger child has a note for home too, once the plans exist.
}

// ---------------------------------------------------------------- notices
// Notices go to the guardians of learners enrolled today, so past terms use school-wide notices; fee reminders go to the families who owed that term.
type NoticeSpec = { t: TermKey; when: 'open' | 'late' | 'close'; title: string; body: string; audience: 'school' | 'class' | 'owing'; c?: number; approve?: boolean };
const NOTICES: NoticeSpec[] = [
  { t: 't1', when: 'open', title: 'Welcome to 2025/2026', body: 'Dear parents, welcome to the new academic year. Term 1 runs from 8 September to 18 December 2025. Term 1 fees are due by Friday 3 October. Thank you.', audience: 'school' },
  { t: 't1', when: 'close', title: 'Vacation and reopening, Term 1', body: 'School vacated on Thursday 18 December 2025. Reports were issued. School reopened for Term 2 on Tuesday 13 January 2026.', audience: 'school' },
  { t: 't2', when: 'late', title: 'Fees reminder, Term 2', body: 'Term 2 fees were due on 6 February 2026. This ward still had a balance at the time. Please see the bursar or call the school to agree a payment plan.', audience: 'owing' },
  { t: 't3', when: 'open', title: 'JHS 3 BECE 2026', body: 'JHS 3 candidates wrote the BECE from Monday 8 June to Friday 12 June 2026. Index cards were issued at the office. Thank you for supporting the candidates.', audience: 'school' },
  { t: 't3', when: 'late', title: 'Fees reminder, Term 3', body: 'Term 3 fees were due on 15 May 2026. This ward still had a balance at the time. Please see the bursar or call the school to agree a payment plan.', audience: 'owing' },
  { t: 't3', when: 'close', title: 'Vacation and reopening, Term 3', body: 'School vacated on Friday 24 July 2026. Reports were given out. School reopened for the 2026/2027 year on Tuesday 8 September 2026. Thank you for a good year.', audience: 'school' },
  { t: 't4', when: 'open', title: 'Welcome to 2026/2027', body: 'Welcome back. Term 1 runs from 8 September to 17 December 2026. Bills include any balance from last term. Please clear arrears before mid-term.', audience: 'school' },
  { t: 't4', when: 'open', title: 'PTA general meeting', body: 'The PTA general meeting is on Saturday 17 October at 9:00 am in the school hall. We will discuss the Term 1 budget and the school library.', audience: 'school' },
  { t: 't4', when: 'open', title: 'JHS 3 mock examinations', body: 'JHS 3 Mock 2 was written on Thursday 8 October. Results are with the class teacher. Mock 3 is in November. Please check your ward\'s progress.', audience: 'class', c: 12 },
  { t: 't4', when: 'late', title: 'Fees reminder', body: 'Term 1 fees are due by Friday 30 October. Your ward still has a balance. Please see the bursar this week or call the school to agree a payment plan.', audience: 'owing' },
  { t: 't4', when: 'open', title: 'Inter-house sports day', body: 'Our inter-house sports day is coming up. Each learner should come in their house T-shirt and bring a water bottle.', audience: 'school', approve: false },
];
async function notices(t: TermDef, stage: 'early' | 'late') {
  const head = await as('head');
  for (const [n, spec] of NOTICES.entries()) {
    const k = `notice:${n}`;
    if (spec.t !== t.key || done(k) || (stage === 'early') !== (spec.when === 'open')) continue;
    if (spec.when === 'close' && TODAY < t.end) continue;
    const created = await head.post('/notices', { title: spec.title, body: spec.body, audience: spec.audience, ...(spec.audience === 'class' ? { classId: classId(t.year, spec.c!) } : {}), ...(spec.audience === 'owing' ? { termId: state.termIds[t.key] } : {}) }, k);
    if (spec.approve !== false) {
      try { await head.post(`/notices/${created.id}/approve`, { version: created.version }, `${k}:approve`); }
      catch (error) { if ((error as { status?: number }).status === 400) finding(`Notice "${spec.title}" was left as a draft: ${(error as Error).message.slice(0, 140)}`); else throw error; }
    }
    mark(k);
  }
}

// ---------------------------------------------------------------- terms 1 to 3 of 2025/26
async function pastTerm(key: TermKey) {
  const t = T(key), head = await as('head');
  if (key === 't2' && !done('t2:events')) {
    step('Term 2 opens: three new admissions, and a Basic 1 learner moved up to Basic 2');
    const newcomers = model.learners.filter(l => !l.csv && l.joins === t.start && l.segs.some(s => s.y === 0));
    for (const l of newcomers) {
      if (state.learners[l.key]) continue;
      let a = await head.post('/admissions', { fullName: l.name, dateOfBirth: l.dob, sex: l.sex, classId: classId(0, l.c0), startDate: l.joins, admissionNumber: l.admission }, `adm:${l.key}`);
      for (const action of ['review', 'offer', 'accept', 'enrol']) a = await head.post(`/admissions/${a.id}/transition`, { version: a.version, action }, `adm:${l.key}:${action}`);
      state.learners[l.key] = a.learner_id; save();
    }
    await ensureGuardians(newcomers);
    const skip = model.learners.find(l => l.skipTo !== undefined)!;
    const detail = await head.get(`/learners/${idOf(skip)}`);
    await head.post(`/learners/${idOf(skip)}/transfer`, { version: detail.version, classId: classId(0, skip.skipTo!), effectiveDate: t.start, reason: 'Assessed by the class teacher and the headteacher as ready for Basic 2; parents agreed' }, 'skip');
    mark('t2:events');
  }
  await notices(t, 'early');
  await schoolDays(t);
  await registers(t);
  await classWorkFor(t);
  await mocks(t);
  await observations(t);
  await fees(t);
  await supportPast(t);
  if (key === 't2' && !done('t2:leaves')) {
    step('End of Term 2: a Basic 3 learner transfers to another school');
    const leaver = model.learners.find(l => l.leaves)!;
    const detail = await head.get(`/learners/${idOf(leaver)}`);
    await head.post(`/learners/${idOf(leaver)}/withdraw`, { version: detail.version, effectiveDate: leaver.leaves!, reason: 'Transferred to another school: family relocated to Takoradi; transfer letter and records issued' }, 'leaver');
    mark('t2:leaves');
  }
  await results(t);
  await eyReports(t);
  await notices(t, 'late');
  step(`${t.key} done`);
  mark(`term:${key}`);
}

// ---------------------------------------------------------------- the new year: promotion, intake, class teachers, fees
async function promote() {
  const head = await as('head');
  step('Academic year 2026/27, its Term 1 and thirteen classes');
  if (!state.yearIds[1]) { state.yearIds[1] = (await head.post('/academic-years', { name: YEARS[1]!.name, startDate: YEARS[1]!.start, endDate: YEARS[1]!.end }, 'year1')).id; save(); }
  const t4 = T('t4');
  if (!state.termIds.t4) { state.termIds.t4 = (await head.post('/assessment/terms', { academicYearId: state.yearIds[1], name: t4.name, startDate: t4.start, endDate: t4.end }, 'term:t4')).id; save(); }
  for (const [c, def] of CLASSES.entries()) if (!state.classIds[1]![c]) { state.classIds[1]![c] = (await head.post('/classes', { name: def.name, level: def.level, capacity: 22, academicYearId: state.yearIds[1] }, `class:1:${c}`)).id; save(); }
  for (let c = 0; c < 13; c++) {
    if (done(`promote:${c}`)) continue;
    const preview = (await head.get(`/promotions/preview?sourceClassId=${classId(0, c)}&effectiveDate=${PROMO}`)).items as { id: string }[];
    const decisions = preview.map(row => {
      const l = model.learners.find(x => idOf(x) === row.id)!;
      const seg = l.segs.find(s => s.y === 1);
      return seg ? { learnerId: row.id, action: 'move', classId: classId(1, seg.c) } : { learnerId: row.id, action: 'leave' };
    });
    if (decisions.length) {
      const result = await head.post('/promotions', { sourceClassId: classId(0, c), effectiveDate: PROMO, reason: `End of year promotion approved at the staff meeting of 23 July 2026 (${CLASSES[c]!.name})`, decisions }, `promote:${c}`);
      step(`  ${CLASSES[c]!.name}: ${result.moved} moved on, ${result.left} left`);
    }
    mark(`promote:${c}`);
  }
  step('2026/27 Nursery 1 intake (admission flow) and applications still being decided');
  const intake = model.learners.filter(l => !l.csv && l.joins === t4.start);
  await pool(intake.filter(l => !state.learners[l.key]), async l => {
    let a = await head.post('/admissions', { fullName: l.name, dateOfBirth: l.dob, sex: l.sex, classId: classId(1, 0), startDate: l.joins, admissionNumber: l.admission }, `adm:${l.key}`);
    for (const action of ['review', 'offer', 'accept', 'enrol']) a = await head.post(`/admissions/${a.id}/transition`, { version: a.version, action }, `adm:${l.key}:${action}`);
    state.learners[l.key] = a.learner_id; save();
  }, 'intake admissions');
  if (!done('applications')) {
    for (const [i, [name, c]] of ([['Nana Yaa Ofori', 2], ['Kekeli Agbeko', 4], ['Selorm Badu', 10], ['Afua Dogbe', 5]] as [string, number][]).entries()) {
      const a = await head.post('/admissions', { fullName: name, classId: classId(1, c), startDate: addDays(TODAY, 14), admissionNumber: `SIS/26/A${String(i + 1).padStart(3, '0')}` }, `app:${i}`);
      if (i < 2) await head.post(`/admissions/${a.id}/transition`, { version: a.version, action: 'review' }, `app:${i}:review`);
    }
    mark('applications');
  }
  await ensureGuardians(intake);
  step('2026/27 class teachers, Term 1 fee items');
  if (!done('assign')) {
    for (const [c, def] of CLASSES.entries()) await head.post('/teaching/assignments', { classId: classId(1, c), teacherMembershipId: state.accounts[teacherKey(c)]!.membershipId, startDate: PROMO, endDate: YEARS[1]!.end, reason: `Class teacher for ${def.name}, approved at the staff meeting` }, `assign:${c}`);
    mark('assign');
  }
  await feeItems(t4);
  await pool(model.learners.filter(l => l.segs.some(s => s.y === 1) && l.csv), async l => { const s = l.segs.find(x => x.y === 1)!; if (s.c < 4) await enrolmentId(l, 1, s.c); }, 'early-years enrolments');
  await pool(intake, async l => { await enrolmentId(l, 1, 0); }, 'intake enrolments');
  mark('promote');
}

// ---------------------------------------------------------------- Term 1 of 2026/27, up to today (class teachers act themselves)
async function current() {
  const t = T('t4'), head = await as('head');
  if (!state.termIds.t4) throw new Error('Run promote first');
  step(`Teachers sign in (13 class teachers)`);
  await pool([...Array(13).keys()], async c => { await as(teacherKey(c)); }, 'teacher sign-ins', 4);
  await notices(t, 'early');
  await schoolDays(t);
  await registers(t);
  await classWorkFor(t);
  await mocks(t);
  await observations(t);
  await eyReports(t);
  await fees(t);
  await supportNow();
  await notesNow();
  await notices(t, 'late');
  void head;
  step(`Current term brought up to ${TODAY}`);
}

// ---------------------------------------------------------------- notes on learners: staff (some shared with the family) and a parent's note
async function notesNow() {
  const byStory = (s: string) => model.learners.find(l => l.story === s)!;
  const specs: { k: string; who: string; story: string; category: string; body: string; share?: boolean; family?: boolean }[] = [
    { k: 'kwame-teacher', who: teacherKey(BASIC6), story: 'improver', category: 'classwork', body: 'Fractions are coming on since the small-group sessions. He now checks his working with the fraction strips before handing in.' },
    { k: 'kwame-head', who: 'head', story: 'improver', category: 'home', share: true, body: 'Kwame has worked hard on fractions this term. Ten minutes of practice at home with the fraction strips on Tuesday and Thursday evenings will keep it going.' },
    { k: 'kwame-family', who: 'family0', story: 'improver', category: 'home', family: true, body: 'Thank you. We practise at home on Tuesday evenings. He says the strips help. Please tell us if he needs anything else for Mathematics.' },
    { k: 'kojo-teacher', who: teacherKey(7), story: 'absentee', category: 'attendance', share: true, body: 'Kojo has missed several days since mid-September and his Mathematics marks have dropped. Please call the school so we can agree catch-up work.' },
    { k: 'esi-teacher', who: teacherKey(BASIC6), story: 'strong', category: 'classwork', body: 'Consistently strong. Give her extension problems in Mathematics and ask her to lead the reading group.' },
  ];
  for (const sp of specs) {
    const key = `note:t4:${sp.k}`; if (done(key)) continue;
    const l = byStory(sp.story), person = await as(sp.who);
    if (sp.family) await person.post(`/guardian/children/${idOf(l)}/notes`, { category: sp.category, body: sp.body }, key);
    else await person.post(`/learners/${idOf(l)}/notes`, { category: sp.category, body: sp.body, sharedWithFamily: sp.share === true }, key);
    mark(key);
  }
}

// ---------------------------------------------------------------- home practice: approved question sets for the weakest topics
async function practiceNow() {
  const head = await as('head');
  step('Approved home-practice question sets for the weakest topics');
  for (const [topic, questions] of Object.entries(demoQuestionSets)) {
    const key = `questions:${topic}`; if (done(key)) continue;
    const s = TOPICS.findIndex(list => list.some(([d]) => d === topic));
    await head.post(`/assessment/indicators/${state.indicatorIds[s]![TOPICS[s]!.findIndex(([d]) => d === topic)]}/questions`, { questions }, key);
    mark(key);
  }
}

// ---------------------------------------------------------------- finish: shareable logins, AI for this school, family sharing
async function finish() {
  const head = await as('head');
  step('Progress shared with families, and AI switched on for this school only');
  await head.put('/assessment/sharing', { shareWithFamilies: true }, 'sharing');
  await head.put('/ai/settings', { enabled: true, monthlyRunCap: 300, acknowledgement: 'Sunrise International School (Demo) is a synthetic demonstration school with no real learners or staff. AI drafting and the Ask assistant are switched on here for demonstrations only, with a monthly cap of 300 questions.' }, 'ai-settings');
  step('Shared teacher and parent logins get their demo passwords (no forced change)');
  const personas: [string, string][] = [['teacher' + BASIC6, 'Class teacher (Basic 6)'], ['family0', 'Parent (two children)']];
  for (const [key] of personas) {
    const person = await as(key);
    if (!state.accounts[key]!.password.startsWith('Sunrise-')) await person.rotate(demoPassword());
  }
  const lines = [
    `${SCHOOL_NAME}: shareable demo logins (generated ${new Date().toISOString()})`,
    `API: ${API}`, '',
    'Role                          Sign in                              Password',
    ...[['Headteacher', 'head'], ['Class teacher (Basic 6)', teacherKey(BASIC6)], ['Parent (two children)', 'family0']].map(([role, key]) => `${role!.padEnd(30)}${state.accounts[key!]!.email.padEnd(37)}${state.accounts[key!]!.password}`),
    '', 'Not shared: bursar, front desk and the other twelve teachers use generated passwords kept in state.json.', '',
    'These three accounts can change data. If visitors change the password, ask for the "reset demo logins" command.',
  ];
  mkdirSync(DIR, { recursive: true }); writeFileSync(LOGINS, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Logins written to ${LOGINS}`);
  mark('finish');
}

// ---------------------------------------------------------------- verify: counts, then Ask
async function verify() {
  const head = await as('head'), bursar = await as('bursar');
  const out: string[] = [];
  const say = (s: string) => { console.log(s); out.push(s); };
  const bad: string[] = [];
  say(`Verification ${new Date().toISOString()} (today ${TODAY})`);
  for (const y of [0, 1] as const) {
    const day = y === 0 ? '2026-06-30' : TODAY;
    const census = (await head.get(`/learners/census?day=${day}`)).items as { name: string; id: string; female: number; male: number; unrecorded: number }[];
    say(`Learners per class on ${day}: ${census.map(c => `${c.name} ${c.female + c.male + c.unrecorded}`).join(', ')}`);
    const expected = CLASSES.map((_, c) => rosterOn(y, c, day).length);
    CLASSES.forEach((cl, c) => { const got = census.find(x => x.id === classId(y, c)); const n = got ? got.female + got.male + got.unrecorded : 0; if (n !== expected[c]) bad.push(`${cl.name} ${y ? '2026/27' : '2025/26'} has ${n} learners, expected ${expected[c]}`); });
  }
  for (const t of TERMS) {
    if (t.start > TODAY) continue;
    let assessments = 0, short = 0, perWeek = 0;
    for (const c of GRADED) {
      const list = (await head.get(`/assessment/classes/${classId(t.year, c)}/assessments?termId=${state.termIds[t.key]}`)).items as { subject_id: string; held_on: string; kind: string; marked: number; title: string }[];
      const classWork = list.filter(a => a.kind !== 'mock');
      assessments += classWork.length;
      const keys = new Set(classWork.map(a => `${a.subject_id}|${mondayOf(a.held_on)}`));
      perWeek += keys.size === classWork.length ? 0 : 1;
      for (const a of list) { const want = rosterOn(t.year, c, a.held_on).length; if (a.marked !== want) short++; }
    }
    say(`${t.key}: ${assessments} class assessments (${weeks(t).length} weeks × 4 core subjects × 9 classes = ${weeks(t).length * 36}); classes with two in one subject-week: ${perWeek}; assessments whose marks differ from the roll: ${short}`);
    if (assessments !== weeks(t).length * 36) bad.push(`${t.key} has ${assessments} class assessments`);
    if (short) bad.push(`${t.key}: ${short} assessments are not fully marked`);
    if (t.end <= TODAY) {
      let cards = 0, want = 0;
      for (const c of GRADED) { cards += (await head.get(`/assessment/classes/${classId(t.year, c)}/reports?termId=${state.termIds[t.key]}`)).items.length; want += model.learners.filter(l => inTerm(l, t.year, c, t)).length; }
      say(`${t.key}: ${cards} published report cards for ${want} learners`);
      if (cards !== want) bad.push(`${t.key}: ${cards} report cards for ${want} learners`);
    }
    const summary = await bursar.get(`/finance/summary?termId=${state.termIds[t.key]}`);
    const invoices = (await bursar.get(`/finance/invoices?termId=${state.termIds[t.key]}&limit=1`)).total;
    say(`${t.key} fees: ${invoices} invoices, billed GH₵${summary.billedPesewas / 100}, collected GH₵${summary.collectedPesewas / 100} (${Math.round(summary.collectedPesewas * 100 / summary.billedPesewas)}%), outstanding GH₵${summary.outstandingPesewas / 100}`);
  }
  step('Checking every register (this reads one register per school day per class)');
  let registers = 0, missing = 0;
  const jobs: { t: TermDef; d: string; c: number }[] = [];
  for (const t of TERMS) for (const d of openDays(t)) for (let c = 0; c < 13; c++) if (rosterOn(t.year, c, d).length) jobs.push({ t, d, c });
  const presence = { present: 0, marked: 0 };
  await pool(jobs, async ({ t, d, c }) => {
    const r = await head.get(`/attendance/classes/${classId(t.year, c)}/register?day=${d}`);
    registers++;
    if (r.status === 'draft' && !(d === TODAY)) missing++;
    if (r.status === 'draft' && d === TODAY) return;
    for (const row of r.items as { mark: string }[]) { if (row.mark !== 'unmarked') { presence.marked++; if (row.mark === 'present' || row.mark === 'late') presence.present++; } }
  }, 'register checks');
  say(`Registers: ${registers} school-day registers read, ${missing} not submitted before today; presence ${(presence.present * 100 / presence.marked).toFixed(1)}%`);
  if (missing) bad.push(`${missing} registers are not submitted`);
  say(bad.length ? `PROBLEMS:\n${bad.map(b => ` - ${b}`).join('\n')}` : 'All count checks passed.');
  writeFileSync(path.join(DIR, 'verify.txt'), out.join('\n') + '\n');
  if (bad.length) process.exitCode = 1;
}
async function ask() {
  const head = await as('head'), teacher = await as(teacherKey(BASIC6));
  const lines: string[] = [];
  const questions: [Person, string, string][] = [
    [head, 'Headteacher', 'What is the performance of Basic 6?'], [head, 'Headteacher', 'What can we do about it?'], [head, 'Headteacher', 'Who has been absenting him/herself most last week?'],
    [head, 'Headteacher', 'How did JHS 3 do in the mocks?'], [head, 'Headteacher', 'How much in fees is outstanding?'], [teacher, 'Basic 6 teacher', 'How is my class doing?'],
  ];
  let history: { role: string; text: string }[] = [], who = '';
  for (const [person, role, question] of questions) {
    if (role !== who) { history = []; who = role; }
    history.push({ role: 'user', text: question });
    const started = Date.now();
    const answer = await person.post('/assistant/chat', { messages: history });
    history.push({ role: 'assistant', text: answer.reply });
    lines.push(`## ${role}: ${question}`, `(${((Date.now() - started) / 1000).toFixed(1)}s, tools: ${(answer.tools ?? []).map((t: { name?: string } | string) => typeof t === 'string' ? t : t.name).join(', ')})`, '', answer.reply, '');
    console.log(`Asked as ${role}: ${question} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  writeFileSync(path.join(DIR, 'ask-answers.md'), lines.join('\n'));
  console.log(`Answers saved to ${path.join(DIR, 'ask-answers.md')}`);
}

// ---------------------------------------------------------------- main
const phases: Record<string, () => Promise<void>> = {
  setup, roll, t1: () => pastTerm('t1'), t2: () => pastTerm('t2'), t3: () => pastTerm('t3'), promote, current, finish, verify, ask, notes: notesNow, practice: practiceNow,
  year: async () => { for (const p of ['setup', 'roll', 't1', 't2', 't3', 'promote', 'current', 'finish', 'practice']) { if (!done(`phase:${p}`)) { console.log(`\n=== ${p} ===`); await phases[p]!(); mark(`phase:${p}`); flush(); } } },
  status: async () => {
    const planned = { learners: model.learners.length, families: model.families.length, openDays: TERMS.reduce((n, t) => n + openDays(t).length, 0) };
    console.log(JSON.stringify({ target: API, hosted: HOSTED, school: state.schoolId, today: TODAY, planned, calls: state.calls, phases: Object.keys(state.done).filter(k => k.startsWith('phase:') || k.startsWith('term:')), registers: Object.keys(state.regs).length, findings: state.findings }, null, 2));
  },
};
if (!phases[phase]) { console.error(`Unknown phase ${phase}. Use one of: ${Object.keys(phases).join(', ')}`); process.exit(1); }
if (HOSTED && phase !== 'status' && process.env.DEMO_CONFIRM_HOSTED !== 'write-to-production') { console.error('This would write to a hosted API. Set DEMO_CONFIRM_HOSTED=write-to-production only after the plan has been approved.'); process.exit(1); }
phases[phase]!().then(() => { flush(); }).catch(error => { flush(); console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
