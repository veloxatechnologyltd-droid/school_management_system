import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import './landing.css';
import { shots, tour, type Shot } from '../auth/content';
import { ask, basic6, basic6Weeks, fees, fractions, kwame, lesson, lessonCheck, notice, school, SNAPSHOT_DATE, type Question } from './data';

const cedi = (n: number) => 'GH₵' + Math.round(n).toLocaleString('en-GB');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const START = '#/register';

/* One scroll loop for the whole page. Each tall section reports its progress (0 to 1) through
   its sticky stage; the value goes to a CSS variable so scrolling never re-renders React. */
type Track = { el: HTMLElement; cb?: (p: number) => void };
const tracks = new Set<Track>();
let ticking = false;
function frame() {
  ticking = false;
  const vh = innerHeight;
  for (const t of tracks) {
    const r = t.el.getBoundingClientRect();
    // Pinned sections run 0 to 1 while their stage is held; unpinned ones (phones, reduced motion) as they enter.
    const p = Math.min(1, Math.max(0, r.height > vh * 1.3 ? -r.top / (r.height - vh) : (vh * 0.9 - r.top) / (vh * 0.6)));
    t.el.style.setProperty('--p', p.toFixed(4));
    t.cb?.(p);
  }
}
const schedule = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
function useProgress<T extends HTMLElement>(cb?: (p: number) => void) {
  const ref = useRef<T>(null);
  const cbRef = useRef(cb); cbRef.current = cb;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const t: Track = { el, cb: p => cbRef.current?.(p) };
    tracks.add(t);
    if (tracks.size === 1) { addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule); }
    schedule();
    return () => { tracks.delete(t); if (!tracks.size) { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); } };
  }, []);
  return ref;
}
function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el); return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}
function Reveal({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'p' }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return <Tag ref={ref as never} className={`lp-reveal ${seen ? 'in' : ''} ${className}`}>{children}</Tag>;
}

/* ---------- Hero: the school as a stack of real screens, pulled apart by the pointer and laid flat by scrolling. */
function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const ref = useProgress<HTMLElement>();
  useEffect(() => {
    const el = stage.current; if (!el || reduced()) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      el.style.setProperty('--mx', ((e.clientX / innerWidth) - 0.5).toFixed(3));
      el.style.setProperty('--my', ((e.clientY / innerHeight) - 0.5).toFixed(3));
    };
    addEventListener('pointermove', move); return () => removeEventListener('pointermove', move);
  }, []);
  return <header className="lp-hero lp-blue" ref={ref}>
    <div className="lp-hero-sticky">
      <div className="lp-hero-copy">
        <p className="lp-kicker">For Ghanaian basic schools, KG to JHS</p>
        <h1>Run the whole school.<br/><span>Lift every child.</span></h1>
        <p className="lp-lede">Registers, fees, report cards and an assistant that reads your records, in one place your staff can use from a phone. And every child gets a teacher at home in the evening: lessons and practice built on what their own school is teaching this term.</p>
        <div className="lp-cta-row">
          <a className="lp-btn" href={START}>Set up your school free</a>
          <a className="lp-btn ghost" href="#families">I'm a parent</a>
        </div>
        <p className="lp-fine">Free setup. No card. Your school's data stays your school's.</p>
      </div>
      <div className="lp-stage" ref={stage} aria-hidden="true">
        <div className="lp-stack">
          <div className="lp-layer l0">
            <div className="ui-bar"><b>Today</b><span>Fri 16 Oct</span></div>
            <div className="ui-tiles">
              <div><small>Learners</small><strong>{school.learners}</strong></div>
              <div><small>Classes</small><strong>{school.classes}</strong></div>
              <div><small>Fees collected</small><strong>56.8%</strong></div>
            </div>
            <div className="ui-spark"><Spark values={basic6Weeks.overall} /><small>Basic 6, class average by week</small></div>
          </div>
          <div className="lp-layer l1">
            <div className="ui-bar"><b>Register · Basic 6</b><span>16 learners</span></div>
            {basic6.slice(0, 6).map((n, i) => <div className="ui-row" key={n}><span>{n}</span><i className={i === 4 ? 'a' : 'p'}>{i === 4 ? 'Absent' : 'Present'}</i></div>)}
          </div>
          <div className="lp-layer l2">
            <div className="ui-bar"><b>Report card</b><span>{kwame.report.term}</span></div>
            {kwame.report.subjects.slice(0, 4).map(s => <div className="ui-row" key={s[0]}><span>{s[0]}</span><em>{s[3]}</em><i className="g">{s[4]}</i></div>)}
          </div>
          <div className="lp-layer l3 phone">
            <div className="ui-notch"/>
            <p className="ui-small">Kwame · Basic 6</p>
            <p className="ui-big">Mathematics <b>improving</b></p>
            <Spark values={kwame.maths.values} />
            <div className="ui-level"><span>Map reading</span><LevelDots level={2} /></div>
            <div className="ui-level"><span>Tenses</span><LevelDots level={2} /></div>
            <div className="ui-pill">Start practice</div>
          </div>
        </div>
      </div>
    </div>
  </header>;
}

function Spark({ values, max = 100, className = '' }: { values: number[]; max?: number; className?: string }) {
  const w = 120, h = 36;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return <svg className={`ui-sparksvg ${className}`} viewBox={`0 -2 ${w} ${h + 4}`} preserveAspectRatio="none"><polyline points={pts} /></svg>;
}
function LevelDots({ level, of = 3 }: { level: number; of?: number }) {
  return <span className="ui-dots" aria-label={`Level ${level} of ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} className={i < level ? 'on' : ''} />)}</span>;
}

/* ---------- Fees: the number every head carries, counted out as you scroll, then broken down by class. */
function Fees() {
  const billed = useRef<HTMLElement>(null), collected = useRef<HTMLElement>(null), owed = useRef<HTMLElement>(null);
  const ref = useProgress<HTMLElement>(raw => {
    const p = reduced() ? 1 : raw;
    const k = Math.min(1, p / 0.45);
    if (billed.current) billed.current.textContent = cedi(fees.billed * k);
    if (collected.current) collected.current.textContent = cedi(fees.collected * k);
    if (owed.current) owed.current.textContent = cedi(fees.outstanding * Math.min(1, Math.max(0, (p - 0.1) / 0.4)));
  });
  return <section className="lp-fees" id="schools" ref={ref}>
    <div className="lp-sticky">
      <div className="lp-fees-grid">
        <div className="lp-fees-copy">
          <h2>Half a term in, and somebody asks: <em>how much is still owed?</em></h2>
          <p>In most schools that answer lives in three receipt books and the bursar's memory. Here it is the moment you open the page, class by class, with every receipt numbered and every reversal signed for.</p>
        </div>
        <div className="lp-fees-board">
          <div className="lp-ledger">
            <div><small>Billed this term</small><strong ref={billed}>{cedi(fees.billed)}</strong></div>
            <div><small>Collected</small><strong ref={collected} className="ok">{cedi(fees.collected)}</strong></div>
            <div><small>Outstanding</small><strong ref={owed} className="due">{cedi(fees.outstanding)}</strong></div>
          </div>
          <ul className="lp-bars">
            {fees.classes.map((c, i) => <li key={c.name} style={{ ['--w' as string]: c.collected / 100, ['--i' as string]: i }} className={c.collected < 40 ? 'low' : ''}>
              <span className="n">{c.name}</span><span className="bar"><i /></span><span className="v">{c.collected}%</span>
            </li>)}
          </ul>
          <p className="lp-flag"><b>Basic 3 has collected 23.5%.</b> Every other class is between 55.7% and 65.6%. You know where to look before the PTA meeting, not after it.</p>
        </div>
      </div>
    </div>
  </section>;
}

/* ---------- Ask: real questions, real answers, typed out the way the assistant answers in the app. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part);
  const blocks = text.split(/\n\n+/);
  return <>{blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines[0].startsWith('|')) {
      const rows = lines.filter(l => !/^\|[-| ]+\|$/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
      if (rows.length < 2) return null;
      return <div className="lp-table" key={i}><table><thead><tr>{rows[0].map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
    }
    const head = lines[0].startsWith('- ') || /^\d+\. /.test(lines[0]) ? null : lines.shift();
    const items = lines.filter(l => l.startsWith('- ') || /^\d+\. /.test(l));
    const ordered = items.length > 0 && /^\d/.test(items[0]);
    return <div key={i}>{head && <p>{inline(head)}</p>}{items.length > 0 && (ordered
      ? <ol>{items.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>)}</ol>
      : <ul>{items.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>)}</div>;
  })}</>;
}
function Ask() {
  const [box, seen] = useInView<HTMLDivElement>(0.3);
  const [pick, setPick] = useState(0);
  const [shown, setShown] = useState(0);
  const answer = ask[pick].a;
  useEffect(() => {
    if (!seen) return;
    if (reduced()) { setShown(answer.length); return; }
    setShown(0);
    let n = 0, id = 0;
    const step = () => { n = Math.min(answer.length, n + 9); setShown(n); if (n < answer.length) id = requestAnimationFrame(step); };
    const delay = window.setTimeout(() => { id = requestAnimationFrame(step); }, 650);
    return () => { clearTimeout(delay); cancelAnimationFrame(id); };
  }, [pick, seen, answer]);
  // Show only whole blocks while typing, so tables appear row-complete rather than as raw pipes.
  const visible = useMemo(() => {
    if (shown >= answer.length) return answer;
    const cut = answer.slice(0, shown);
    const lastBreak = cut.lastIndexOf('\n');
    const partial = cut.slice(lastBreak + 1);
    const text = partial.startsWith('|') ? cut.slice(0, lastBreak) : cut;
    // Hide a half-typed bold marker so no stray asterisks show while typing.
    return (text.match(/\*\*/g) ?? []).length % 2 ? text.replace(/\*\*(?!.*\*\*)/s, '') : text.replace(/\*$/, '');
  }, [shown, answer]);
  const done = shown >= answer.length;
  return <section className="lp-ask lp-blue" id="try">
    <div className="lp-wrap">
      <div className="lp-ask-head">
        <h2>Ask your school a question. Get an answer you can act on.</h2>
        <p>Ask is built into the platform. It reads registers, marks, mocks and fees, then answers in plain English with the numbers behind it. Tap a question: these are real answers it gave on our demo school.</p>
      </div>
      <div className="lp-chat" ref={box}>
        <div className="lp-chips" role="tablist" aria-label="Questions">
          {ask.map((a, i) => <button key={a.q} role="tab" aria-selected={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>{a.q}</button>)}
        </div>
        <div className="lp-thread" aria-live="polite">
          <div className="lp-msg me"><small>{ask[pick].who}</small>{ask[pick].q}</div>
          <div className="lp-msg ai">
            <small>Ask · {done ? `answered in ${ask[pick].secs} s from the school's records` : 'reading the records…'}</small>
            <Markdown text={visible} />{!done && <span className="lp-caret" />}
          </div>
        </div>
        <p className="lp-chat-note">Ask can only read, never change a record, and it answers inside what each person is allowed to see: a class teacher hears about their own class. Children's names are replaced before anything is sent to the AI.</p>
      </div>
    </div>
  </section>;
}

/* ---------- A school day: a horizontal run of real screens, from the morning register to the report card. */
function Day() {
  const track = useRef<HTMLDivElement>(null);
  const ref = useProgress<HTMLElement>(p => {
    const t = track.current; if (!t || matchMedia('(max-width: 760px)').matches || reduced()) { if (t) t.style.transform = ''; return; }
    const extra = t.scrollWidth - t.parentElement!.clientWidth;
    t.style.transform = `translate3d(${-extra * Math.min(1, Math.max(0, (p - 0.08) / 0.84))}px,0,0)`;
  });
  const [absent, setAbsent] = useState<Set<string>>(() => new Set());
  const toggle = (n: string) => setAbsent(s => { const c = new Set(s); c.has(n) ? c.delete(n) : c.add(n); return c; });
  return <section className="lp-day" ref={ref}>
    <div className="lp-sticky">
      <div className="lp-day-head lp-wrap">
        <h2>One school day, from the first bell to the report card.</h2>
        <p>Each screen below is the real thing, filled with the demo school's records. The register works: tap a name.</p>
      </div>
      <div className="lp-day-view">
        <div className="lp-day-track" ref={track}>
          <article className="lp-card">
            <p className="lp-time">7:45 am · Class teacher</p>
            <h3>Take the register in under a minute</h3>
            <div className="lp-register">
              {basic6.map(n => <button key={n} className={absent.has(n) ? 'a' : ''} onClick={() => toggle(n)} aria-pressed={absent.has(n)}><span>{n}</span><i>{absent.has(n) ? 'Absent' : 'Present'}</i></button>)}
            </div>
            <p className="lp-card-foot">{16 - absent.size} present, {absent.size} absent. The head sees which registers are still open, and repeated absence is flagged for follow-up.</p>
          </article>
          <article className="lp-card">
            <p className="lp-time">11:00 am · Class work</p>
            <h3>Class exercises add up to CA by themselves</h3>
            <div className="lp-chart">
              <Chart labels={basic6Weeks.labels} series={[{ name: 'All subjects', values: basic6Weeks.overall }, { name: 'Mathematics', values: basic6Weeks.maths, alt: true }]} />
            </div>
            <p className="lp-card-foot">Basic 6 by week. Marks feed continuous assessment with your school's own weighting, so the end-of-term sheet is ready when the exam marks are.</p>
          </article>
          <article className="lp-card">
            <p className="lp-time">1:30 pm · Teacher, with Claude</p>
            <h3>Practice on the topic the class finds hard</h3>
            <div className="lp-draft">
              <div className="lp-draft-top"><b>Mathematics · Fractions</b><span>Basic 6</span></div>
              <p className="lp-draft-q">Ama has 24 mangoes and sells 1/3 of them. How many does she sell?</p>
              <div className="lp-draft-levels"><span>Level 1 · 5 questions</span><span>Level 2 · 5</span><span>Level 3 · 5</span></div>
              <p className="lp-approved">Approved by Samuel Owusu-Ansah, headteacher</p>
            </div>
            <p className="lp-card-foot">The AI drafts from the topic, never from a child's record. Nothing reaches a child until a teacher or the head has read and approved it.</p>
          </article>
          <article className="lp-card">
            <p className="lp-time">2:15 pm · Bursar</p>
            <h3>A payment, a receipt, a balance the parent can see</h3>
            <div className="lp-bill">
              <div className="lp-bill-top"><b>{kwame.name}</b><span>{kwame.bill.term}</span></div>
              {kwame.bill.lines.map(([n, v]) => <div key={n}><span>{n}</span><span>{cedi(v)}</span></div>)}
              <div className="minus"><span>{kwame.bill.discount[0]}</span><span>-{cedi(kwame.bill.discount[1])}</span></div>
              <div><span>Paid</span><span>{cedi(kwame.bill.paid)}</span></div>
              <div className="total"><span>Balance</span><span>{cedi(kwame.bill.balance)}</span></div>
            </div>
            <p className="lp-card-foot">Amounts are kept to the pesewa. Payments can't be edited away: a reversal needs the head and a reason.</p>
          </article>
          <article className="lp-card">
            <p className="lp-time">3:30 pm · Headteacher</p>
            <h3>One notice, every family</h3>
            <div className="lp-notice"><b>{notice.title}</b><p>{notice.body}</p><span>Approved · sent to families</span></div>
            <p className="lp-card-foot">Drafted, approved by the head, then sent to every family's account. The office sees exactly who it went to.</p>
          </article>
          <article className="lp-card">
            <p className="lp-time">End of term · Everyone</p>
            <h3>Report cards your families can read on a phone</h3>
            <div className="lp-report">
              <div className="lp-report-top"><b>{kwame.name}</b><span>{kwame.report.className} · {kwame.report.term}</span></div>
              <table><thead><tr><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th></tr></thead>
                <tbody>{kwame.report.subjects.slice(0, 5).map(s => <tr key={s[0]}><td>{s[0]}</td><td>{s[1]}</td><td>{s[2]}</td><td>{s[3]}</td><td>{s[4]}</td></tr>)}</tbody></table>
              <p>Conduct: {kwame.report.conduct} · Interest: {kwame.report.interest}</p>
            </div>
            <p className="lp-card-foot">CA 30%, exam 70%, graded on the GES 1 to 9 bands, or your school's own policy. Published reports are kept as issued; corrections leave a record.</p>
          </article>
        </div>
      </div>
    </div>
  </section>;
}

function Chart({ labels, series, extra, ends }: { labels: string[]; series: { name: string; values: number[]; alt?: boolean }[]; extra?: { label: string; value: number } | null; ends?: boolean }) {
  const w = 320, h = 150, pad = 8;
  const count = labels.length + (extra ? 1 : 0);
  const x = (i: number) => pad + (i / (count - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2);
  return <figure className="lp-figure">
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={series.map(s => `${s.name}: ${s.values.join(', ')}`).join('. ')}>
      <line x1={pad} x2={w - pad} y1={y(50)} y2={y(50)} className="pass" />
      {series.map(s => <polyline key={s.name} className={s.alt ? 'alt' : ''} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} pathLength={1} />)}
      {series.map(s => s.values.map((v, i) => <circle key={s.name + i} cx={x(i)} cy={y(v)} r={3} className={s.alt ? 'alt' : ''} />))}
      {ends && series[0].values.map((v, i) => (i === 0 || i === series[0].values.length - 1) && <text key={i} x={x(i)} y={y(v) - 12} textAnchor={i ? 'end' : 'start'} className="val">{Math.round(v)}%</text>)}
      {extra && <text x={x(labels.length)} y={y(extra.value) - 14} textAnchor="end" className="val you">{extra.value}%</text>}
      {extra && <g className="you"><line x1={x(labels.length - 1)} y1={y(series[0].values.at(-1)!)} x2={x(labels.length)} y2={y(extra.value)} /><circle cx={x(labels.length)} cy={y(extra.value)} r={6} /></g>}
    </svg>
    <figcaption>{labels.map(l => <span key={l}>{l}</span>)}{extra && <span className="you">{extra.label}</span>}</figcaption>
    {series.length > 1 && <p className="lp-legend">{series.map(s => <span key={s.name} className={s.alt ? 'alt' : ''}>{s.name}</span>)}<span className="pass">Pass line</span></p>}
  </figure>;
}

/* ---------- Families, the reason parents pay: a teacher at home every evening, built on the school's own term.
   The phone is the signature move: the visitor is Kwame for one evening, studies a real lesson, practises,
   and their score lands on his progress chart. */
const SHARE = 'https://wa.me/?text=' + encodeURIComponent('Our school could use this: registers, fees, report cards, and lessons and practice for our children at home, built on what the school teaches. ' + location.origin);

function Families() {
  const [ref, seen] = useInView<HTMLElement>(0.1);
  const [you, setYou] = useState<number | null>(null);
  return <section className={`lp-kwame ${seen ? 'in' : ''}`} id="families" ref={ref}>
    <div className="lp-wrap lp-kwame-grid">
      <div className="lp-kwame-story">
        <p className="lp-kicker">For parents</p>
        <h2>A teacher at home, every evening.</h2>
        <p className="lp-sub">Built on what your child's own school is teaching this term.</p>
        <p className="lp-lede">Your child picks a topic from this term's work. A short lesson explains it step by step, the way a good teacher would, with an example and a recap. Then they practise and move up a level when they are ready. You don't need to know the subject to help.</p>
        <ul className="lp-why-list">
          <li><b>It follows your child's own school.</b> Lessons and questions come from the topics their teachers approved for this term, not a generic course.</li>
          <li><b>It starts where your child is weak.</b> "Improve from my class work" goes straight to the topics where their marks are low.</li>
          <li><b>It works at night, on your phone.</b> No extra trip, no waiting for a lesson teacher. Ten minutes most evenings is enough.</li>
          <li><b>You see it working.</b> The topics practised, the level reached and the school's notes, with no rankings and no comparisons.</li>
        </ul>
        <div className="lp-price-tag"><strong>GH₵50</strong><span>for the whole term, per child. Compare that with a term of extra classes.</span></div>
        <div className="lp-cta-row"><a className="lp-btn" href={SHARE} target="_blank" rel="noopener noreferrer">Share with your child's school</a></div>
        <p className="lp-fine">The pass comes through your child's school. Reports, fees, notices and basic practice stay free for every family.</p>
      </div>
      <div className="lp-kwame-phone">
        <HomePhone onPractised={setYou} />
        <p className="lp-phone-note">Be Kwame for one evening. The lesson and questions are real: made by Claude from topics the headteacher approved for Basic 6 at our demo school.</p>
      </div>
    </div>
    <div className="lp-wrap lp-proof">
      <div>
        <h3>And you can see it working.</h3>
        <p className="lp-lede">In April, Kwame scored 33% in Maths. In October, 66%. His teacher named fractions as the gap and sent the family something to do at home. His mother replied.</p>
        <div className="lp-chart big">
          <Chart labels={kwame.maths.labels} series={[{ name: 'Mathematics', values: kwame.maths.values }]} extra={you === null ? null : { label: 'You', value: you }} ends />
        </div>
      </div>
      <div className="lp-notes">
        <Reveal className="lp-note staff"><small>{kwame.teacherTip.teacher}, Mathematics · {kwame.teacherTip.topic}</small>{kwame.teacherTip.body}</Reveal>
        <Reveal className="lp-note staff"><small>{kwame.headNote.author}</small>{kwame.headNote.body}</Reveal>
        <Reveal className="lp-note family"><small>{kwame.familyNote.author}</small>{kwame.familyNote.body}</Reveal>
      </div>
    </div>
    <p className="lp-demo-note lp-wrap">Kwame is a sample learner in our demo school, Sunrise International School. The screens, rules, lesson and questions are the live platform.</p>
  </section>;
}

/* ---------- Inside the product: real pages of the demo school, the same pictures the sign-in page uses. */
function Browser({ shot }: { shot: Shot }) {
  return <figure className="lp-browser"><div className="lp-browser-bar" aria-hidden="true"><i /><i /><i /><span>Sunrise International School · demo school</span></div>
    <img src={`/auth/${shot.file}.webp`} alt={shot.alt} width={1100} height={720} loading="lazy" decoding="async" /></figure>;
}
function Screens() {
  const [pick, setPick] = useState(0);
  const item = tour[pick];
  return <section className="lp-screens lp-blue" id="inside">
    <div className="lp-wrap">
      <p className="lp-kicker">Inside the product</p>
      <h2>Every page your staff will use, before you sign up.</h2>
      <p className="lp-band-lede">These are real pages of our demo school, with sample learners. Choose one.</p>
      <div className="lp-chips" role="tablist" aria-label="Pages of the product">
        {tour.map((t, i) => <button key={t.id} role="tab" id={`lp-tab-${t.id}`} aria-selected={i === pick} aria-controls="lp-shot" className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>{t.label}</button>)}
      </div>
      <div className="lp-shot" role="tabpanel" id="lp-shot" aria-labelledby={`lp-tab-${item.id}`}>
        <div className="lp-shot-text">
          <h3>{item.title}</h3>
          <p>{item.text}</p>
          <ul>{item.points.map(point => <li key={point}>{point}</li>)}</ul>
        </div>
        <Browser shot={item.shot} />
      </div>
    </div>
  </section>;
}

/* ---------- The rest of the parent's side, on their own phone. */
function ParentScreens() {
  const list: [Shot, string, string][] = [
    [shots.parentHome, 'Home', 'How their child is doing, at a glance.'],
    [shots.parentLearn, 'Learn at home', "Lessons and practice on this term's topics, approved by teachers."],
    [shots.parentProgress, 'Progress', 'Class work and tests, term by term.'],
    [shots.parentReports, 'Report cards', 'Published report cards, kept as issued.'],
  ];
  return <section className="lp-parents lp-blue" aria-labelledby="lp-parents-h">
    <div className="lp-wrap">
      <p className="lp-kicker">On the phone they already have</p>
      <h2 id="lp-parents-h">A parent signs in once and sees all of it.</h2>
      <p className="lp-band-lede">Children never get their own logins. Each child's progress, report cards, fees and notices sit on the parent's phone, in plain words.</p>
      <ul className="lp-phones">{list.map(([shot, title, text]) => <Reveal as="li" key={title}>
        <figure className="lp-shotphone"><img src={`/auth/${shot.file}.webp`} alt={shot.alt} width={390} height={780} loading="lazy" decoding="async" /></figure>
        <b>{title}</b><span>{text}</span>
      </Reveal>)}</ul>
    </div>
  </section>;
}

type Screen = 'home' | 'study' | 'check' | 'practice';
function HomePhone({ onPractised }: { onPractised: (score: number) => void }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [page, setPage] = useState(0);
  const pages = [
    { title: 'What you will learn', body: <p className="lp-q">{lesson.goal}</p> },
    ...lesson.steps.map(s => ({ title: s.heading, body: <p className="lp-lesson">{s.text}</p> })),
    { title: 'A worked example', body: <div className="lp-example"><p>{lesson.example.problem}</p><p>{lesson.example.working}</p></div> },
    { title: 'Remember', body: <ul className="lp-recap">{lesson.recap.map(r => <li key={r}>{r}</li>)}</ul> },
  ];
  const home = () => { setScreen('home'); setPage(0); };
  return <div className="lp-phone">
    {screen === 'home' && <div className="lp-phone-body" key="home">
      <p className="lp-q-count">Good evening, Kwame</p>
      <p className="lp-q">What would you like to learn tonight?</p>
      <p className="lp-group">Improve from my class work</p>
      <button className="lp-topic" onClick={() => setScreen('practice')}><span><b>Fractions</b><small>Mathematics · your marks are low here</small></span><i>Practise</i></button>
      <div className="lp-topic static"><span><b>Map reading</b><small>Social Studies · Level 2 of 3</small></span><LevelDots level={2} /></div>
      <p className="lp-group">Learn on my own</p>
      <button className="lp-topic" onClick={() => setScreen('study')}><span><b>{lesson.topic}</b><small>{lesson.subject} · short lesson, then 5 questions</small></span><i>Study</i></button>
      <div className="lp-topic static"><span><b>Energy and its forms</b><small>Science · Level 1 of 3</small></span><LevelDots level={1} /></div>
    </div>}
    {screen === 'study' && <div className="lp-phone-body" key={`study-${page}`}>
      <div className="lp-phone-top"><button className="lp-back" onClick={home} aria-label="Back to topics">‹</button><span>Study · {lesson.topic}</span></div>
      <div className="lp-phone-progress"><i style={{ transform: `scaleX(${(page + 1) / pages.length})` }} /></div>
      <p className="lp-q-count">Step {page + 1} of {pages.length}</p>
      <h4 className="lp-step-title">{pages[page].title}</h4>
      {pages[page].body}
      <div className="lp-phone-act two">
        {page > 0 && <button className="lp-btn ghost light" onClick={() => setPage(page - 1)}>Back</button>}
        {page < pages.length - 1
          ? <button className="lp-btn" onClick={() => setPage(page + 1)}>Next</button>
          : <button className="lp-btn" onClick={() => setScreen('check')}>Check what you learned</button>}
      </div>
    </div>}
    {screen === 'check' && <Practice key="check" title={`Check · ${lesson.topic}`} levels={[lessonCheck]} onExit={home} onDone={() => undefined} />}
    {screen === 'practice' && <Practice key="practice" title="Fractions" levels={fractions} onExit={home} onDone={onPractised} />}
  </div>;
}

function Practice({ title, levels, onDone, onExit }: { title: string; levels: Question[][]; onDone: (score: number) => void; onExit: () => void }) {
  const [level, setLevel] = useState(0);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const [right, setRight] = useState(0);
  const [finished, setFinished] = useState(false);
  const q: Question = levels[level][i];
  const isNumber = q.answer !== undefined;
  const last = levels.length - 1;
  function check() {
    const ok = isNumber ? Math.abs(Number(typed.replace(',', '.')) - q.answer!) < 1e-9 : picked === q.correct;
    setChecked(ok); if (ok) setRight(r => r + 1);
  }
  function next() {
    if (i === levels[level].length - 1) { setFinished(true); onDone(Math.round((right / levels[level].length) * 100)); return; }
    setI(i + 1); setPicked(null); setTyped(''); setChecked(null);
  }
  function restart(nextLevel: number) { setLevel(nextLevel); setI(0); setPicked(null); setTyped(''); setChecked(null); setRight(0); setFinished(false); }
  const up = right >= 4;
  return <>
    <div className="lp-phone-top"><button className="lp-back" onClick={onExit} aria-label="Back to topics">‹</button><span>{title}</span>{levels.length > 1 && <LevelDots level={level + 1} of={levels.length} />}</div>
    <div className="lp-phone-progress"><i style={{ transform: `scaleX(${(finished ? 5 : i + (checked === null ? 0 : 1)) / 5})` }} /></div>
    {!finished ? <div className="lp-phone-body" key={`${level}-${i}`}>
      <p className="lp-q-count">{levels.length > 1 ? `Level ${level + 1} · ` : ''}Question {i + 1} of 5</p>
      <p className="lp-q">{q.prompt}</p>
      {isNumber
        ? <input className="lp-input" inputMode="decimal" aria-label="Your answer" value={typed} disabled={checked !== null} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && typed && checked === null) check(); }} placeholder="Type a number" />
        : <div className="lp-options">{q.options!.map((o, k) => <button key={o} disabled={checked !== null} onClick={() => setPicked(k)}
          className={[picked === k ? 'picked' : '', checked !== null && k === q.correct ? 'right' : '', checked === false && picked === k ? 'wrong' : ''].join(' ')}>{o}</button>)}</div>}
      {checked !== null && <p className={`lp-why ${checked ? 'ok' : 'no'}`}><b>{checked ? 'Correct.' : 'Not quite.'}</b> {q.why}</p>}
      <div className="lp-phone-act">
        {checked === null
          ? <button className="lp-btn" disabled={isNumber ? !typed : picked === null} onClick={check}>Check</button>
          : <button className="lp-btn" onClick={next}>{i === 4 ? 'See result' : 'Next question'}</button>}
      </div>
    </div> : <div className="lp-phone-body lp-result">
      <div className={`lp-ring ${up ? 'up' : ''}`}><strong>{right}/5</strong></div>
      <p className="lp-q">{levels.length === 1 ? (up ? 'Well done. You learned it tonight.' : 'Good try. Read the lesson again tomorrow.') : up ? (level < last ? `Level ${level + 2} unlocked.` : 'Every level cleared.') : 'Stay on this level and try again.'}</p>
      <p className="lp-q-count">{up ? 'Your family sees the topic and the level reached. No percentages, no ranking.' : 'Two weak sessions in a row move a child down a level, never below Level 1.'}</p>
      <div className="lp-phone-act">
        {levels.length > 1 && up && level < last
          ? <button className="lp-btn" onClick={() => restart(level + 1)}>Try Level {level + 2}</button>
          : <button className="lp-btn" onClick={onExit}>Choose another topic</button>}
      </div>
    </div>}
  </>;
}

/* ---------- Pricing: free for the school; families choose the pass; the school earns from every pass. */
function Pricing() {
  const [learners, setLearners] = useState(school.learners);
  const [uptake, setUptake] = useState(30);
  const passes = Math.round(learners * uptake / 100);
  const perPass = 15;
  return <section className="lp-pricing" id="pricing">
    <div className="lp-wrap lp-price-grid">
      <div>
        <h2>Free for your school. The school earns when families choose to learn at home.</h2>
        <p className="lp-lede">There is no setup fee and no subscription. Registers, fees, report cards, notices and Ask cost the school nothing. Families who want more practice at home can buy the Home Learning Pass, and your school earns from every pass sold.</p>
        <ul className="lp-free">
          <li><b>Free for every family, always:</b> report cards, fee statements, notices, the progress view and basic practice.</li>
          <li><b>Home Learning Pass, GH₵50 per child per term:</b> practice every school day on the topics the child finds hard, with short lessons, all approved by the child's teachers. Launching with our first partner schools.</li>
          <li><b>Your school receives 30% of every pass</b>, about GH₵15, paid out each term with a statement of counts and amounts. It never shows which families paid.</li>
        </ul>
      </div>
      <div className="lp-calc">
        <h3>What could your school earn?</h3>
        <label>Learners in your school <output>{learners}</output>
          <input type="range" min={50} max={1200} step={10} value={learners} onChange={e => setLearners(+e.target.value)} /></label>
        <label>Families who buy the pass <output>{uptake}%</output>
          <input type="range" min={5} max={80} step={5} value={uptake} onChange={e => setUptake(+e.target.value)} /></label>
        <div className="lp-calc-out">
          <div><small>Passes a term</small><strong>{passes}</strong></div>
          <div><small>Your school, each term</small><strong>{cedi(passes * perPass)}</strong></div>
          <div className="wide"><small>Your school, over a year of three terms</small><strong>{cedi(passes * perPass * 3)}</strong></div>
        </div>
        <div className="lp-split" aria-label="How a GH₵50 pass is shared">
          <span style={{ flex: 30 }} className="s">School 30%</span><span style={{ flex: 50 }}>Veloxa 50%</span><span style={{ flex: 20 }} className="i">Running costs 20%</span>
        </div>
        <p className="lp-fine">Launch partner terms. Shares are worked out after mobile money fees and refunds. Running costs cover hosting, SMS and the AI. Families are never pressed to buy: paying never changes what the school records or reports about a child.</p>
      </div>
    </div>
  </section>;
}

function Trust() {
  const items: [string, string][] = [
    ['Each school is sealed off', 'Every record carries its school, and the database itself refuses to show one school\'s data to another.'],
    ['People see only their part', 'A class teacher sees their own classes. A parent sees their own children. Every sign-in is checked on each request.'],
    ['Teachers approve what children see', 'The AI drafts. A teacher or the head reads, edits and approves. Anyone can report a wrong question and it is taken out.'],
    ['Records are kept, not overwritten', 'Scores, payments and published reports keep their history. A correction is a new entry with a name and a reason.'],
    ['Built for the phone in your hand', 'Large buttons, plain words, and pages that work on a small screen at the front desk or in the classroom.'],
    ['Children\'s names stay home', 'Ask and the drafting tools work with stand-in names, so a child\'s name never reaches the AI.'],
  ];
  return <section className="lp-trust">
    <div className="lp-wrap">
      <h2>Built the way a careful head would run the office.</h2>
      <ol className="lp-trust-list">{items.map(([h, t]) => <Reveal as="li" key={h}><b>{h}</b><span>{t}</span></Reveal>)}</ol>
    </div>
  </section>;
}

/* Closing call to action and footer in one blue band, with the name set large and faint underneath. */
function Footer() {
  return <footer className="lp-footer lp-blue">
    <div className="lp-wrap">
      <div className="lp-footer-cta">
        <h2>Set up your school this afternoon.</h2>
        <p>Create the headteacher account, add your classes, and invite your teachers. Bring your learner list from Excel and see a preview first.</p>
        <a className="lp-pill" href={START}>Set up your school free<span aria-hidden="true">↗</span></a>
      </div>
      <div className="lp-footer-row">
        <ul className="lp-footer-links">
          <li><a href="#schools">For schools</a></li>
          <li><a href="#inside">Inside the product</a></li>
          <li><a href="#families">For parents</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#/signin">Sign in</a></li>
        </ul>
        <p className="lp-footer-brand"><img className="logo" src="/brand/mark-white.svg" alt="Veloxa SmartSchool" /></p>
        <div className="lp-footer-meta">
          <p>Made for schools in Ghana, KG to JHS</p>
          <p><a href={SHARE} target="_blank" rel="noopener noreferrer">Share with a school on WhatsApp</a></p>
          <p className="lp-fine">Figures on this page come from our demo school on {SNAPSHOT_DATE}.</p>
          <p className="lp-fine">© 2026 Veloxa SmartSchool</p>
        </div>
      </div>
    </div>
    <p className="lp-footer-mark" aria-hidden="true"><img src="/brand/mark-white.svg" alt="" /></p>
  </footer>;
}

export default function Landing() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    document.title = 'Veloxa SmartSchool · School management and home learning for Ghana';
    // Heavier headline face, loaded only for the landing page (Google Sans stops at 700).
    if (!document.getElementById('lp-display-font')) {
      const link = Object.assign(document.createElement('link'), { id: 'lp-display-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@600..1000&display=swap' });
      document.head.appendChild(link);
    }
    const on = () => setSolid(scrollY > 24); on();
    addEventListener('scroll', on, { passive: true }); return () => removeEventListener('scroll', on);
  }, []);
  const jump = (e: ReactMouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (!href.startsWith('#') || href.startsWith('#/')) return;
    e.preventDefault();
    const target = href === '#' ? null : document.getElementById(href.slice(1));
    const top = target ? target.getBoundingClientRect().top + scrollY - 60 : 0;
    scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' });
  };
  return <div className="lp" onClick={jump}>
    <nav className={`lp-nav ${solid ? 'solid' : 'on-blue'}`} aria-label="Main">
      <a className="lp-brand" href="#" aria-label="Veloxa SmartSchool home"><img className="logo" src={solid ? "/brand/mark.svg" : "/brand/mark-white.svg"} alt="" /></a>
      <div className="lp-links"><a href="#schools">Schools</a><a href="#families">Parents</a><a href="#pricing">Pricing</a></div>
      <div className="lp-nav-cta"><a className="lp-signin" href="#/signin">Sign in</a><a className="lp-btn small" href={START}>Start free</a></div>
    </nav>
    <main>
      <Hero />
      <Fees />
      <Ask />
      <Day />
      <Screens />
      <Families />
      <ParentScreens />
      <Pricing />
      <Trust />
    </main>
    <Footer />
  </div>;
}
