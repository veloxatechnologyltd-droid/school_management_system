import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { SchoolLogo } from '../lib/logo';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Tabs } from '../lib/ui';

type Period = { starts: string; ends: string; kind: 'lesson' | 'break'; label?: string };
type Term = { id: string; name: string; year_name: string; current: boolean };
type Version = { id: string; version: number; status: 'draft' | 'published' | 'retired'; periods: Period[]; published_at: string | null; lessons: number };
type Named = { id: string; name: string };
type Overview = { terms: Term[]; term: Term | null; versions: Version[]; classes: (Named & { level: string })[]; subjects: Named[]; teachers: Named[]; rooms: Named[]; me: string };
type Lesson = { id: string; class_id: string; class_name: string; weekday: number; period: number; subject_id: string | null; subject_name: string | null; label: string | null; teacher_membership_id: string | null; teacher_name: string | null; room_id: string | null; room_name: string | null };
type Grid = { id: string; version: number; status: Version['status']; periods: Period[]; items: Lesson[] };
type View = 'class' | 'teacher' | 'room' | 'bell';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const statusName = { draft: 'Draft', published: 'In use', retired: 'Replaced' } as const;
// A common Ghana basic-school day, offered when a draft has no bell schedule yet.
const COMMON_DAY: Period[] = [['08:00', '08:40'], ['08:40', '09:20'], ['09:20', '10:00'], ['10:00', '10:30', 'Break'], ['10:30', '11:10'], ['11:10', '11:50'], ['11:50', '12:30'], ['12:30', '13:10', 'Lunch'], ['13:10', '13:50'], ['13:50', '14:30']]
  .map(([starts, ends, label]) => label ? { starts: starts!, ends: ends!, kind: 'break', label } : { starts: starts!, ends: ends!, kind: 'lesson' });
const what = (l: Lesson) => l.subject_name ?? l.label ?? '';

// The school timetable: a weekly grid per class, per teacher and per room, the bell schedule, versions and printing.
// The headteacher edits a draft and publishes it; teachers read the published version for their own lessons and classes.
export function Timetable({ schoolId, csrfToken, role }: { schoolId: string; csrfToken: string; role: string }) {
  const head = role === 'headteacher';
  const [overview, setOverview] = useState<Overview | null>(null);
  const [termId, setTermId] = useState(''); const [versionId, setVersionId] = useState('');
  const [grid, setGrid] = useState<Grid | null>(null);
  const [view, setView] = useState<View>(head ? 'class' : 'teacher');
  const [pick, setPick] = useState({ class: '', teacher: '', room: '' });
  const [day, setDay] = useState(() => Math.min(Math.max(new Date().getDay(), 1), 5));
  const [cell, setCell] = useState<{ classId: string; weekday: number; period: number } | null>(null);
  const [printing, setPrinting] = useState<'' | 'one' | 'all'>('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');

  const loadOverview = useCallback(async (keepVersion = '') => {
    try {
      const o = await request<Overview>(`/schools/${schoolId}/timetable${termId ? `?termId=${termId}` : ''}`);
      setOverview(o);
      setVersionId(keepVersion && o.versions.some(v => v.id === keepVersion) ? keepVersion : (o.versions.find(v => v.status === (head ? 'draft' : 'published')) ?? o.versions.find(v => v.status === 'published') ?? o.versions[0])?.id ?? '');
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, termId, head]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  const loadGrid = useCallback(async () => {
    if (!versionId) { setGrid(null); return; }
    try { setGrid(await request<Grid>(`/schools/${schoolId}/timetable/${versionId}/lessons`)); } catch (e) { setError((e as Error).message); }
  }, [schoolId, versionId]);
  useEffect(() => { void loadGrid(); }, [loadGrid]);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(''); addEventListener('afterprint', done); const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); removeEventListener('afterprint', done); };
  }, [printing]);

  // The choices for each view. A teacher's own week is chosen by default; their class list is the classes they can see.
  const items = grid?.items ?? [];
  const teachers = useMemo(() => head ? overview?.teachers ?? [] : [...new Map(items.filter(l => l.teacher_membership_id).map(l => [l.teacher_membership_id!, { id: l.teacher_membership_id!, name: l.teacher_name! }])).values()], [head, overview, items]);
  const classes = useMemo(() => head ? overview?.classes ?? [] : (overview?.classes ?? []).filter(c => items.some(l => l.class_id === c.id)), [head, overview, items]);
  const rooms = overview?.rooms ?? [];
  const me = head ? '' : overview?.me ?? '';
  const chosen = { class: pick.class || classes[0]?.id || '', teacher: pick.teacher || me || teachers[0]?.id || '', room: pick.room || rooms[0]?.id || '' };
  const version = overview?.versions.find(v => v.id === versionId);
  const editable = head && version?.status === 'draft';
  const periods = grid?.periods ?? [];
  // A colour per subject, in the order of the school's subject list, so up to eight subjects never share one.
  const hue = (id: string | null) => { const i = id ? (overview?.subjects ?? []).findIndex(s => s.id === id) : -1; return i < 0 ? 'tt-label' : `tt-c${i % 8}`; };

  async function send(method: string, url: string, body: unknown, done: string) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await request<any>(`/schools/${schoolId}/timetable${url}`, { method, headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }); setNotice(done); return r ?? true; }
    catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  async function newDraft() { const r = await send('POST', '/drafts', { operationId: crypto.randomUUID(), termId: overview!.term!.id }, 'Draft started. Change it, then publish it.'); if (r) await loadOverview(r.id); }
  async function publish() {
    const r = await send('POST', `/${versionId}/publish`, { operationId: crypto.randomUUID() }, `Version ${version?.version} is now the timetable in use.`);
    if (r) await loadOverview(versionId);
  }

  const lessonsFor = (filter: (l: Lesson) => boolean) => { const map = new Map<string, Lesson>(); items.filter(filter).forEach(l => map.set(`${l.weekday}:${l.period}`, l)); return map; };
  const subject = view === 'class' ? classes.find(c => c.id === chosen.class)?.name : view === 'teacher' ? (head ? teachers.find(t => t.id === chosen.teacher)?.name : 'My') : rooms.find(r => r.id === chosen.room)?.name;
  const current = view === 'class' ? lessonsFor(l => l.class_id === chosen.class) : view === 'teacher' ? lessonsFor(l => l.teacher_membership_id === (head ? chosen.teacher : me)) : lessonsFor(l => l.room_id === chosen.room);
  const cellText = (l: Lesson, forView: View) => <><strong>{what(l)}</strong>{forView !== 'class' && <span>{l.class_name}</span>}{forView !== 'teacher' && l.teacher_name && <span>{l.teacher_name}</span>}{forView !== 'room' && l.room_name && <span>{l.room_name}</span>}</>;

  // One week as a table (screen and print); on phones the screen shows one day at a time instead.
  const week = (map: Map<string, Lesson>, forView: View, classId?: string) => <table className="tt-grid"><thead><tr><th>Time</th>{DAYS.map((d, i) => <th key={d} title={DAY_NAMES[i]}>{d}</th>)}</tr></thead><tbody>
    {periods.map((p, i) => p.kind === 'break' ? <tr key={i} className="tt-break"><th>{p.starts}<span>{p.ends}</span></th><td colSpan={5}>{p.label}</td></tr>
      : <tr key={i}><th>{p.starts}<span>{p.ends}</span></th>{DAYS.map((_, d) => { const l = map.get(`${d + 1}:${i + 1}`);
        const content = l ? <div className={`tt-cell ${hue(l.subject_id)}`}>{cellText(l, forView)}</div> : null;
        return <td key={d}>{editable && forView === 'class' && classId ? <button type="button" className="tt-edit" aria-label={`${DAY_NAMES[d]} ${p.starts}: ${l ? what(l) : 'empty'}`} onClick={() => { setError(''); setCell({ classId, weekday: d + 1, period: i + 1 }); }}>{content ?? <span className="tt-add"><Icon name="add"/></span>}</button> : content}</td>; })}</tr>)}
  </tbody></table>;
  const dayList = (map: Map<string, Lesson>, forView: View, classId?: string) => <ol className="tt-day">{periods.map((p, i) => { const l = map.get(`${day}:${i + 1}`);
    if (p.kind === 'break') return <li key={i} className="tt-break"><span className="tt-time">{p.starts}–{p.ends}</span><span>{p.label}</span></li>;
    const body = l ? <div className={`tt-cell ${hue(l.subject_id)}`}>{cellText(l, forView)}</div> : <span className="muted">Free</span>;
    return <li key={i}><span className="tt-time">{p.starts}–{p.ends}</span>{editable && forView === 'class' && classId ? <button type="button" className="tt-edit" onClick={() => { setError(''); setCell({ classId, weekday: day, period: i + 1 }); }}>{body}</button> : body}</li>; })}</ol>;
  const heading = (title: string) => <header className="doc-head"><SchoolLogo schoolId={schoolId} className="doc-logo"/><div className="doc-school"><h3>{title}</h3><p>{overview?.term?.name} · {overview?.term?.year_name} · Version {grid?.version}{version?.status === 'draft' ? ' (draft)' : ''}</p></div></header>;

  if (!overview) return <section className="page"><PageHeader eyebrow="School" title="Timetable"/>{error ? <p role="alert">{error}</p> : <p role="status">Loading…</p>}</section>;
  const draft = overview.versions.find(v => v.status === 'draft');
  const tabs: { id: View; label: string }[] = head ? [{ id: 'class', label: 'Classes' }, { id: 'teacher', label: 'Teachers' }, { id: 'room', label: 'Rooms' }, { id: 'bell', label: 'Bell and rooms' }] : [{ id: 'teacher', label: 'My week' }, { id: 'class', label: 'My classes' }];
  return <section className="page timetable-page" aria-label="Timetable">
    <PageHeader eyebrow={head ? 'School' : 'My classes'} title="Timetable" blurb={head ? 'Build the week as a draft, then publish it. A teacher or room booked twice in one period is refused.' : 'Your lessons and your classes’ week, from the timetable in use.'}
      actions={<>{overview.terms.length > 0 && <label className="inline-field">Term<select value={overview.term?.id ?? ''} onChange={e => { setTermId(e.target.value); setVersionId(''); }}>{overview.terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>}
        {overview.versions.length > 0 && <label className="inline-field">Version<select value={versionId} onChange={e => setVersionId(e.target.value)}>{overview.versions.map(v => <option key={v.id} value={v.id}>{`Version ${v.version} · ${statusName[v.status]}`}</option>)}</select></label>}
        {head && overview.term && !draft && <button type="button" className="secondary" disabled={busy} onClick={() => void newDraft()}><Icon name="edit_calendar"/>{overview.versions.length ? 'Change the timetable' : 'Start a timetable'}</button>}
        {editable && <button type="button" disabled={busy || !grid?.items.length} onClick={() => void publish()}><Icon name="publish"/>Publish</button>}
        {grid && view !== 'bell' && <button type="button" className="secondary" onClick={() => setPrinting('one')}><Icon name="print"/>Print</button>}
        {grid && head && view === 'class' && <button type="button" className="secondary" onClick={() => setPrinting('all')}><Icon name="print"/>Print all classes</button>}</>}/>
    {!cell && error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {!overview.term ? <Empty title="No terms yet" hint="Add the year's terms under Settings, Subjects, terms and grading."/>
      : !overview.versions.length ? <Empty title={head ? 'No timetable for this term yet' : 'No timetable published for this term yet'} hint={head ? 'Start one: it begins as a draft. A new term starts from the last term’s timetable.' : undefined}/>
      : <>
        {version && <p className="scope-line">{version.status === 'draft' ? <><Pill tone="caution">Draft</Pill> Teachers do not see this version until you publish it.</> : version.status === 'published' ? <><Pill tone="positive">In use</Pill> Published {version.published_at?.slice(0, 10)}.{head && draft ? ' A draft of the next version is waiting.' : ''}</> : <><Pill tone="neutral">Replaced</Pill> An earlier version, kept as a record.</>}</p>}
        <div className="actions"><Tabs label="Timetable views" value={view} onChange={setView} options={tabs}/></div>
        {view === 'bell' ? <BellAndRooms schoolId={schoolId} csrfToken={csrfToken} version={version} periods={periods} rooms={rooms} onSaved={() => { void loadOverview(versionId); void loadGrid(); }}/>
          : !grid ? <p role="status">Loading…</p> : !periods.length ? <Empty title="No bell schedule yet" hint={editable ? 'Set the periods on the Bell and rooms tab first.' : undefined}/>
          : <Card flush>
            <div className="toolbar">
              {view === 'class' && <label>Class<select value={chosen.class} onChange={e => setPick({ ...pick, class: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
              {view === 'teacher' && head && <label>Teacher<select value={chosen.teacher} onChange={e => setPick({ ...pick, teacher: e.target.value })}>{teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
              {view === 'room' && <label>Room<select value={chosen.room} onChange={e => setPick({ ...pick, room: e.target.value })}>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
              <span className="count">{current.size} {current.size === 1 ? 'lesson' : 'lessons'} a week</span>
            </div>
            {(view === 'class' && !classes.length) || (view === 'room' && !rooms.length) || (view === 'teacher' && !current.size)
              ? <Empty title={view === 'class' ? 'No classes to show' : view === 'room' ? 'No rooms yet' : 'No lessons for you in this version'} hint={view === 'room' && head ? 'Add rooms on the Bell and rooms tab. A lesson without a room is in the class’s own room.' : undefined}/>
              : <><div className="tt-wide table-wrap">{week(current, view, view === 'class' ? chosen.class : undefined)}</div>
                <div className="tt-narrow"><div className="segmented" role="group" aria-label="Day">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={day === i + 1} onClick={() => setDay(i + 1)}>{d}</button>)}</div>{dayList(current, view, view === 'class' ? chosen.class : undefined)}</div></>}
          </Card>}
      </>}
    {cell && overview && <LessonDialog schoolId={schoolId} csrfToken={csrfToken} versionId={versionId} cell={cell} periods={periods} overview={overview}
      lesson={items.find(l => l.class_id === cell.classId && l.weekday === cell.weekday && l.period === cell.period) ?? null}
      onClose={() => setCell(null)} onSaved={() => { setCell(null); void loadGrid(); }}/>}
    {printing && grid && <div className="print-sheet tt-print">
      {printing === 'all' ? classes.map(c => <article key={c.id} className="tt-page">{heading(`${c.name} timetable`)}{week(lessonsFor(l => l.class_id === c.id), 'class')}</article>)
        : <article className="tt-page">{heading(`${subject ?? ''} timetable`)}{week(current, view)}</article>}
    </div>}
  </section>;
}

function LessonDialog({ schoolId, csrfToken, versionId, cell, periods, overview, lesson, onClose, onSaved }: { schoolId: string; csrfToken: string; versionId: string; cell: { classId: string; weekday: number; period: number }; periods: Period[]; overview: Overview; lesson: Lesson | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ subjectId: lesson?.subject_id ?? (lesson?.label ? 'other' : ''), label: lesson?.label ?? '', teacher: lesson?.teacher_membership_id ?? '', room: lesson?.room_id ?? '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const p = periods[cell.period - 1]!, className = overview.classes.find(c => c.id === cell.classId)?.name;
  async function save(clear = false) {
    setBusy(true); setError('');
    const body = clear ? { classId: cell.classId, weekday: cell.weekday, period: cell.period } : { classId: cell.classId, weekday: cell.weekday, period: cell.period,
      ...(form.subjectId && form.subjectId !== 'other' ? { subjectId: form.subjectId } : {}), ...(form.subjectId === 'other' && form.label.trim() ? { label: form.label.trim() } : {}),
      ...(form.teacher ? { teacherMembershipId: form.teacher } : {}), ...(form.room ? { roomId: form.room } : {}) };
    try { await request(`/schools/${schoolId}/timetable/${versionId}/lessons`, { method: 'PUT', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog title={`${className} · ${DAY_NAMES[cell.weekday - 1]} ${p.starts}–${p.ends}`} onClose={onClose}>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>Subject<select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} required><option value="">Choose a subject</option>{overview.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="other">Something else (write it)</option></select></label>
      {form.subjectId === 'other' && <label>What happens in this period<input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} required minLength={2} maxLength={40} placeholder="Worship, Library, Games"/></label>}
      <label>Teacher<select value={form.teacher} onChange={e => setForm({ ...form, teacher: e.target.value })}><option value="">No teacher</option>{overview.teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Room<select value={form.room} onChange={e => setForm({ ...form, room: e.target.value })}><option value="">The class&rsquo;s own room</option>{overview.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <div className="actions"><button disabled={busy}>{busy ? 'Saving…' : 'Save lesson'}</button>{lesson && <button type="button" className="secondary" disabled={busy} onClick={() => void save(true)}>Clear this period</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button></div>
    </form>
  </Dialog>;
}

function BellAndRooms({ schoolId, csrfToken, version, periods, rooms, onSaved }: { schoolId: string; csrfToken: string; version?: Version; periods: Period[]; rooms: Named[]; onSaved: () => void }) {
  const editable = version?.status === 'draft';
  const [rows, setRows] = useState<Period[]>(periods.length ? periods : editable ? COMMON_DAY : []);
  const [room, setRoom] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { setRows(periods.length ? periods : editable ? COMMON_DAY : []); }, [periods, editable]);
  const set = (i: number, patch: Partial<Period>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  async function call(method: string, url: string, body: unknown, done: string) {
    setBusy(true); setError(''); setNotice('');
    try { await request(`/schools/${schoolId}/timetable${url}`, { method, headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }); setNotice(done); onSaved(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  return <div className="columns">
    <Card title="Bell schedule" hint={editable ? (periods.length ? 'Every class follows these periods.' : 'A common school day is filled in; change it to your school’s bell, then save.') : 'Start a draft to change the bell.'}>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!rows.length ? <Empty title="No bell schedule"/> : <ol className="bell-rows">{rows.map((r, i) => <li key={i}>
        <label>Starts<input type="time" value={r.starts} disabled={!editable} onChange={e => set(i, { starts: e.target.value })} required/></label>
        <label>Ends<input type="time" value={r.ends} disabled={!editable} onChange={e => set(i, { ends: e.target.value })} required/></label>
        <label>Kind<select value={r.kind} disabled={!editable} onChange={e => set(i, e.target.value === 'break' ? { kind: 'break', label: r.label || 'Break' } : { kind: 'lesson', label: undefined })}><option value="lesson">Lesson</option><option value="break">Break</option></select></label>
        {r.kind === 'break' && <label>Name<input value={r.label ?? ''} disabled={!editable} onChange={e => set(i, { label: e.target.value })} maxLength={30} required/></label>}
        {editable && <button type="button" className="secondary small" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="delete"/></button>}
      </li>)}</ol>}
      {editable && <div className="actions"><button type="button" className="secondary" onClick={() => { const last = rows[rows.length - 1]; setRows([...rows, { starts: last?.ends ?? '08:00', ends: last?.ends ?? '08:40', kind: 'lesson' }]); }}><Icon name="add"/>Add a row</button>
        <button type="button" disabled={busy || !rows.length} onClick={() => void call('PUT', `/${version!.id}/periods`, { periods: rows.map(r => r.kind === 'break' ? r : { starts: r.starts, ends: r.ends, kind: 'lesson' }) }, 'Bell schedule saved.')}>Save bell schedule</button></div>}
    </Card>
    <Card title="Rooms" hint="Only rooms that are not a class&rsquo;s own room: labs, art room, field.">
      {rooms.length ? <ul className="history">{rooms.map(r => <li key={r.id}><strong>{r.name}</strong></li>)}</ul> : <Empty title="No rooms yet"/>}
      <form onSubmit={async e => { e.preventDefault(); if (await call('POST', '/rooms', { operationId: crypto.randomUUID(), name: room.trim() }, 'Room added.')) setRoom(''); }}>
        <label>New room<input value={room} onChange={e => setRoom(e.target.value)} required minLength={2} maxLength={60} placeholder="Art room"/></label>
        <button disabled={busy || room.trim().length < 2}>Add room</button>
      </form>
    </Card>
  </div>;
}

// The teacher's lessons today on the Today page: "08:00 JHS 2 Mathematics · Science lab", with the one running now marked.
export function TodayLessons({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<{ published: boolean; closed: boolean; items: { period: number; class_name: string; subject: string; room_name: string | null; starts: string; ends: string }[] } | null>(null);
  const [now, setNow] = useState(() => new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }));
  useEffect(() => { void request<NonNullable<typeof data>>(`/schools/${schoolId}/timetable/today`).then(setData).catch(() => undefined); }, [schoolId]);
  useEffect(() => { const t = setInterval(() => setNow(new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' })), 60000); return () => clearInterval(t); }, []);
  const weekend = [0, 6].includes(new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' }) + 'T00:00:00Z').getUTCDay());
  if (!data?.published || weekend) return null;
  const next = data.items.find(l => l.starts > now);
  return <Card title="Today's lessons" hint={data.closed ? 'The school is closed today.' : undefined} action={<a className="button secondary" href="#/timetable">My week</a>}>
    {data.closed ? null : !data.items.length ? <p className="muted">No lessons for you on the timetable today.</p>
      : <ol className="today-lessons">{data.items.map(l => { const running = l.starts <= now && now < l.ends; return <li key={l.period} className={running ? 'now' : l.ends <= now ? 'done' : undefined}>
        <span className="tt-time">{l.starts}</span><span><strong>{l.class_name} {l.subject}</strong>{l.room_name && <span className="sub">{l.room_name}</span>}</span>
        {running ? <Pill tone="positive">Now</Pill> : l === next ? <Pill tone="info">Next</Pill> : null}</li>; })}</ol>}
  </Card>;
}
