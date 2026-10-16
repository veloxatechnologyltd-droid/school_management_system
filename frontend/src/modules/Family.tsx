import React, { Suspense, lazy, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { dayLabel, lastDayBefore } from '../lib/dates';
import { recallChild, rememberChild } from '../lib/familyChild';
import { Card, Empty, Icon, PageHeader, Pill } from '../lib/ui';

const lazyModule = <T extends Record<string, React.ComponentType<any>>, K extends keyof T>(load: () => Promise<T>, name: K) => lazy(() => load().then(m => ({ default: m[name] })));
const HomePractice = lazyModule(() => import('./HomePractice'), 'HomePractice');
const FamilyProgress = lazyModule(() => import('./FamilyProgress'), 'FamilyProgress');
const FamilyNotes = lazyModule(() => import('./LearnerNotes'), 'FamilyNotes');
const EarlyYearsReports = lazyModule(() => import('./EarlyYearsReports'), 'EarlyYearsReports');
const GuardianTerminalReports = lazyModule(() => import('./Assessment'), 'GuardianTerminalReports');

type Child = { id: string; full_name: string; admission_number: string; academic: boolean; billing: boolean; pickup: boolean; contact: boolean };
type Detail = Child & { date_of_birth?: string | null; enrolments?: { class_name: string; start_date: string; end_date?: string | null }[] };
export type FamilySection = 'children' | 'practice' | 'my-progress' | 'reports' | 'notes';

const rightNames: [keyof Pick<Child, 'academic' | 'billing' | 'pickup' | 'contact'>, string][] = [['academic', 'Academic records'], ['billing', 'Billing information'], ['pickup', 'Collection and pickup'], ['contact', 'School contact']];
const enrolmentStatus = (startDate: string, endDate?: string | null) => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
  if (startDate > today) return 'Scheduled';
  if (endDate && endDate <= today) return 'Ended';
  return 'Active today';
};
const pages: Record<FamilySection, { title: string; blurb: (first: string) => string }> = {
  children: { title: 'Home', blurb: first => `Everything for ${first || 'your child'} in one place. Pick a page to look at.` },
  practice: { title: 'Learn at home', blurb: first => `Short lessons and practice for ${first}, from the topics the school is teaching. Class marks never change.` },
  'my-progress': { title: 'Progress', blurb: () => 'How each subject is going, from class exercises, homework and tests, and how terms compare.' },
  reports: { title: 'Report cards', blurb: () => 'Reports the school has published, newest first.' },
  notes: { title: 'Notes', blurb: first => `Write to ${first}'s teachers and read what the school shares with you.` },
};

// The family area: one child at a time, one page for each job. The child chosen here stays chosen as the parent moves between pages.
export function Family({ schoolId, csrfToken, section }: { schoolId: string; csrfToken: string; section: FamilySection }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [childId, setChildId] = useState(() => recallChild(schoolId));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(''); const [detailError, setDetailError] = useState(''); const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true; setError('');
    request<Child[]>(`/schools/${schoolId}/guardian/children`).then(rows => {
      if (!live) return;
      setChildren(rows); setChildId(prior => rows.some(row => row.id === prior) ? prior : rows[0]?.id ?? '');
    }).catch(e => { if (live) { setError((e as Error).message); setChildren(prior => prior ?? []); } });
    return () => { live = false; };
  }, [schoolId, rev]);

  // Rights and class history are read live, and only once the child is known to belong to this account.
  useEffect(() => {
    setDetail(null); setDetailError('');
    if (!childId || !children?.some(row => row.id === childId)) return;
    rememberChild(schoolId, childId);
    let live = true;
    request<Detail>(`/schools/${schoolId}/guardian/children/${childId}`).then(row => { if (live) setDetail(row); })
      .catch(e => { if (live) setDetailError(`Child access could not be refreshed: ${(e as Error).message}`); });
    return () => { live = false; };
  }, [schoolId, childId, children]);

  const child = children?.find(row => row.id === childId);
  const first = child?.full_name.split(/\s+/)[0] ?? '';
  const classNow = detail?.enrolments?.find(row => enrolmentStatus(row.start_date, row.end_date) === 'Active today')?.class_name;
  const page = pages[section];
  const switcher = children && children.length > 1 && <label className="inline-field">Linked child<select value={childId} onChange={event => setChildId(event.target.value)}>{children.map(row => <option key={row.id} value={row.id}>{row.full_name} · {row.admission_number}</option>)}</select></label>;
  const header = <PageHeader id="family-title" eyebrow={child ? `${first}${classNow ? ` · ${classNow}` : ''}` : 'My family'} title={page.title} blurb={page.blurb(first)}
    actions={switcher}/>;

  if (!children) return <>{header}<p role="status">Loading…</p></>;
  // A parent whose link is still being verified waits here, so the way to look again is on this screen.
  const refresh = <button type="button" className="secondary" aria-label="Refresh guardian records" onClick={() => setRev(n => n + 1)}><Icon name="refresh"/>Refresh</button>;
  if (!child) return <>{header}{error && <p role="alert">{error}</p>}<Card><Empty title="No children linked yet" hint="Once the school verifies your link to a child, their records appear here.">{refresh}</Empty></Card></>;

  const fallback = <p role="status">Loading…</p>;
  const noAcademic = <Card><Empty title="Academic records are not shared with you" hint="Ask the school if you should have academic access for this child."/></Card>;
  let body: React.ReactNode;
  if (detailError) body = <p role="alert">{detailError}</p>;
  else if (section === 'children') body = <Home child={child} detail={detail} first={first} schoolId={schoolId} refresh={refresh}/>;
  else if (!child.academic) body = noAcademic;
  else body = <Suspense fallback={fallback}>
    {section === 'practice' && <HomePractice key={`practice:${childId}`} schoolId={schoolId} csrfToken={csrfToken} childId={childId}/>}
    {section === 'my-progress' && <FamilyProgress key={`progress:${childId}`} schoolId={schoolId} childId={childId} view="tables"/>}
    {section === 'reports' && <><EarlyYearsReports key={`early:${childId}`} schoolId={schoolId} csrfToken={csrfToken} role="guardian" childId={childId}/><GuardianTerminalReports key={`terminal:${childId}`} schoolId={schoolId} childId={childId}/></>}
    {section === 'notes' && <FamilyNotes key={`notes:${childId}`} schoolId={schoolId} csrfToken={csrfToken} childId={childId}/>}
  </Suspense>;
  return <>{header}{error && <p role="alert">{error}</p>}{body}</>;
}

// Home: who the child is, a door to every page the parent may use, what teachers suggest at home, and what the school has confirmed.
function Home({ child, detail, first, schoolId, refresh }: { child: Child; detail: Detail | null; first: string; schoolId: string; refresh: React.ReactNode }) {
  const doors: [string, string, string, string][] = [
    ...(child.academic ? [
      ['practice', 'menu_book', 'Learn at home', `Short lessons and practice for ${first}.`],
      ['my-progress', 'insights', 'Progress', 'How each subject is going this term.'],
      ['reports', 'description', 'Report cards', 'Published terminal and progress reports.'],
      ['notes', 'forum', 'Notes', `Write to ${first}'s teachers.`]] as [string, string, string, string][] : []),
    ...(child.billing ? [['fees', 'receipt_long', 'Fees', 'What has been billed and paid.'] as [string, string, string, string]] : []),
    ['notices', 'campaign', 'Notices', 'Messages from the school.'],
  ];
  return <>
    <div className="profile-card">
      <span className="avatar large" aria-hidden="true">{child.full_name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>
      <div><h3>{child.full_name}</h3><p className="muted">Admission number {child.admission_number}</p></div>
    </div>
    <nav className="shortcuts" aria-label={`Pages for ${first}`}>{doors.map(([id, icon, title, text]) => <a key={id} href={`#/${id}`} className="shortcut">
      <span className="shortcut-icon"><Icon name={icon}/></span><span className="shortcut-text"><strong>{title}</strong><span>{text}</span></span><Icon name="chevron_right"/></a>)}</nav>
    <div className="columns">
      <div>{child.academic
        ? <Suspense fallback={<p role="status">Loading…</p>}><FamilyProgress key={`help:${child.id}`} schoolId={schoolId} childId={child.id} view="help"/></Suspense>
        : <Card><Empty title="Academic records are not shared with you" hint="Ask the school if you should have academic access for this child."/></Card>}</div>
      <div>
        {child.academic && <Card title={`About ${first}`}>
          {!detail ? <p role="status">Loading…</p> : <>
            <p>Date of birth: {detail.date_of_birth ? dayLabel(detail.date_of_birth) : 'Not recorded'}</p>
            <h4>Class history</h4>
            {detail.enrolments?.length ? <ul className="history">{detail.enrolments.map((row, index) => <li key={`${row.class_name}-${row.start_date}-${index}`}><strong>{row.class_name}</strong><span>{enrolmentStatus(row.start_date, row.end_date)} · {row.end_date ? `${dayLabel(row.start_date)} to ${dayLabel(lastDayBefore(row.end_date))}` : `from ${dayLabel(row.start_date)}`}</span></li>)}</ul> : <p>No class history is available.</p>}
          </>}
        </Card>}
        <Card title="Your verified access" hint="What the school has confirmed you may see and do." action={refresh}>
          {!detail ? <p role="status">Loading…</p> : <ul className="rights">{rightNames.map(([key, name]) => <li key={key}>{detail[key] ? <Pill tone="positive"><Icon name="check"/>{name}</Pill> : <Pill tone="neutral">{name}: not granted</Pill>}</li>)}</ul>}
        </Card>
      </div>
    </div>
  </>;
}
