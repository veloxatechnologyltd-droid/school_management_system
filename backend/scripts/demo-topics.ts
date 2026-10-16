// Approves a set of topics for the Sunrise demo school's current term, as its headteacher and its JHS 3 teacher would, and has Claude write
// their lessons and practice questions. Everything goes through the running API so the approval rules, the scope of each person's classes
// and the automatic checks all apply. Run it against a loaded demo (npm run demo:topics -w backend) after the API is up. Safe to run
// again: a topic already approved is skipped and a topic that is complete is not generated for again. Without AI switched on and a
// provider set up, topics are approved and nothing is made.
const API = process.env.DEMO_API ?? 'http://127.0.0.1:3018/api/v1';
const PASSWORD = 'Demo-school-2026!';
const DOMAIN = 'sunrise.demo';

class Person {
  cookie = ''; csrf = '';
  constructor(readonly email: string) {}
  async login() {
    let r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: PASSWORD }) });
    // The API allows 30 sign-ins a minute from one address; wait out the window rather than fail.
    for (let wait = 0; r.status === 429 && wait < 6; wait++) { await new Promise(done => setTimeout(done, 15_000)); r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: PASSWORD }) }); }
    if (!r.ok) throw new Error(`Sign-in failed for ${this.email}: ${r.status} ${await r.text()}`);
    this.cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); this.csrf = (await r.json()).csrfToken;
    return this;
  }
  async call<T = any>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', cookie: this.cookie, 'x-csrf-token': this.csrf }, body: method === 'GET' ? undefined : JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}
type Topic = { indicatorId: string; description: string; grade: string | null; approvals: { id: string; grade: string; content: { lesson: boolean; levels: number[]; target: number } }[] };

async function main() {
  const head = await new Person(`headteacher@${DOMAIN}`).login(), teacher = await new Person(`teacher@${DOMAIN}`).login();
  const school = (await head.call('GET', '/auth/session')).schools[0].id as string, base = `/schools/${school}/learning`;
  const overview = await head.call('GET', `${base}/topics`);
  console.log(`Term: ${overview.term.name} (${overview.term.yearName})`);
  const find = (topics: Topic[], description: string, grade: string | null) => topics.find(t => t.description === description && t.grade === grade);

  // The headteacher approves what Basic 6 and Basic 4 are learning; the JHS 3 class teacher approves the JHS 3 topics. Topics left alone stay available to approve.
  const plan: [Person, string, [string, string | null][]][] = [
    [head, 'Basic 6', ['Reading comprehension', 'Grammar: tenses and agreement', 'Composition writing', 'Place value and number sense', 'Fractions', 'Energy and its forms', 'Map reading', 'Governance and citizenship'].map(d => [d, null] as [string, null])],
    [head, 'Basic 4', [['Addition and subtraction', null], ['Reading tables and graphs', null], ['Living things and their habitats', null], ['Our environment', null], ['Reading aloud with expression', 'Basic 4'], ['Using capital letters and full stops', 'Basic 4']]],
    [teacher, 'JHS 3', [['Solving linear equations', 'JHS 3'], ['Simple and compound interest', 'JHS 3'], ['Argumentative essay writing', 'JHS 3'], ['Summary writing', 'JHS 3'], ['Energy and its forms', null]]],
  ];
  const approved: { who: Person; id: string; label: string }[] = [];
  for (const [who, className, wanted] of plan) {
    const listed = (await who.call('GET', `${base}/topics?termId=${overview.term.id}`)).topics as Topic[];
    const items = wanted.map(([description, grade]) => { const t = find(listed, description, grade); if (!t) throw new Error(`Topic not found in the demo school: ${description}`); return { indicatorId: t.indicatorId, ...(grade ? {} : { grade: className }) }; });
    const r = await who.call('POST', `${base}/topics/approve`, { termId: overview.term.id, items });
    console.log(`${who === head ? 'Headteacher' : 'JHS 3 teacher'}: ${r.approved.length} approved, ${r.alreadyApproved} already approved (${className})`);
    const after = (await who.call('GET', `${base}/topics?termId=${overview.term.id}`)).topics as Topic[];
    for (const [description, grade] of wanted) { const t = find(after, description, grade)!, a = t.approvals.find(x => x.grade.toLowerCase() === (grade ?? className).toLowerCase())!; approved.push({ who, id: a.id, label: `${description} (${a.grade})` }); }
  }

  // A few learning notes, staff only: a topic named in a note comes first on that student's list on the parent's phone.
  const roster = async (name: string) => ((await head.call('GET', `/schools/${school}/collection/learners?search=${encodeURIComponent(name)}`)).items as { id: string; full_name: string }[]).find(l => l.full_name === name)?.id;
  const topicId = async (description: string, grade: string | null) => { const t = find((await head.call('GET', `${base}/topics?termId=${overview.term.id}`)).topics as Topic[], description, grade); if (!t) throw new Error(`Topic not found: ${description}`); return t.indicatorId; };
  const notes: [Person, string, string, [string, string | null] | null][] = [
    [teacher, 'Kwame Asante', 'Give one worked example first, then exam-style questions', ['Solving linear equations', 'JHS 3']],
    [head, 'Akosua Asante', 'Short instructions, one step at a time', null],
    [head, 'Akosua Asante', 'Extra practice on this topic this month', ['Addition and subtraction', null]],
  ];
  for (const [who, name, text, topic] of notes) {
    const learnerId = await roster(name); if (!learnerId) throw new Error(`Learner not found: ${name}`);
    const existing = (await who.call('GET', `/schools/${school}/learners/${learnerId}/learning-notes`)).items as { note: string; withdrawn: unknown }[];
    if (existing.some(n => n.note === text && !n.withdrawn)) { console.log(`  note for ${name}: already there`); continue; }
    await who.call('POST', `/schools/${school}/learners/${learnerId}/learning-notes`, { note: text, ...(topic ? { indicatorId: await topicId(topic[0], topic[1]) } : {}) });
    console.log(`  note for ${name}: written${topic ? ` (${topic[0]} first)` : ''}`);
  }

  const ai = await head.call('GET', `/schools/${school}/ai/settings`);
  if (!(ai.enabled && ai.platformEnabled && ai.providerConfigured)) { console.log('AI is not switched on for this API and school, so the topics are approved and nothing was made.'); return; }
  let next = 0;
  await Promise.all([0, 1].map(async () => { while (next < approved.length) {
    const item = approved[next++]!;
    const r = await item.who.call('POST', `${base}/approvals/${item.id}/generate`);
    console.log(`  ${item.label}: ${r.generated ? `made (lesson ${r.lesson}, questions ${r.levels.map((l: { total: number }) => l.total).join('/')})` : r.note ? `not made (${r.note})` : 'already complete'}`);
  } }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
