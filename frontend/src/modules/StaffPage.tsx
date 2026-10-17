import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pager, Pill, Stat, Tabs, Tone, when } from '../lib/ui';
import { DetailGroup, DetailsDialog, ProfileCard, QuickAction, QuickActions, SummaryCard, notRecorded } from '../lib/profile';
import { localPhone } from '../lib/dates';

type ClassRow = { id: string; classId: string; className: string; level: string; yearName: string; startDate: string; endDate: string; status: 'current' | 'upcoming' | 'finished' | 'ended'; students: number; reason: string; endedReason: string | null };
type Feed = { items: { id: string; at: string; text: string }[]; total: number; offset: number; limit: number };
type Details = { version: number; updatedAt: string | null; staffNumber: string | null; jobTitle: string | null; qualification: string | null; licenceNumber: string | null; dateJoined: string | null; employmentType: string | null;
  subjects: string | null; homeAddress: string | null; emergencyName: string | null; emergencyRelationship: string | null; emergencyPhone: string | null };
type Staff = {
  today: string;
  details: Details;
  member: { userId: string; membershipId: string; name: string; login: string; role: string; phone: string | null; revokedAt: string | null; mustChangePassword: boolean };
  classes: ClassRow[];
  summary: { classes: number; students: number; highlights: { label: string; value: number }[]; moneyPesewas: number | null };
  account: { at: string; by: string | null; text: string }[];
  activity: Feed;
};
type Credentials = { label: string; email: string; temporaryPassword: string };
type TabId = 'overview' | 'classes' | 'activity';

// The optional details the head records for a staff member; every field may stay empty.
const staffGroups: DetailGroup[] = [
  { title: 'Job', fields: [{ key: 'jobTitle', label: 'Job title', maxLength: 60, placeholder: 'Class teacher' }, { key: 'staffNumber', label: 'Staff number', maxLength: 30 },
    { key: 'employmentType', label: 'Employment type', kind: 'select', options: ['Full time', 'Part time', 'Contract', 'Volunteer'] }, { key: 'dateJoined', label: 'Date joined', kind: 'date' },
    { key: 'qualification', label: 'Qualification', maxLength: 120, placeholder: 'B.Ed. Basic Education' }, { key: 'licenceNumber', label: 'Teaching licence number', maxLength: 40 },
    { key: 'subjects', label: 'Subjects taught or duties', maxLength: 200, wide: true }] },
  { title: 'Contact and emergency', fields: [{ key: 'homeAddress', label: 'Home address', maxLength: 200, wide: true }, { key: 'emergencyName', label: 'Emergency contact name', maxLength: 120 },
    { key: 'emergencyRelationship', label: 'Relationship', maxLength: 40 }, { key: 'emergencyPhone', label: 'Emergency contact mobile', kind: 'tel', maxLength: 40, placeholder: '024 123 4567' }] },
];
const roleNames: Record<string, string> = { teacher: 'Teacher', frontdesk: 'Front desk', accountant: 'Accountant', headteacher: 'Headteacher' };
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const accraDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const cedis = (pesewas: number) => `GH₵ ${(pesewas / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusTone: Record<ClassRow['status'], Tone> = { current: 'positive', upcoming: 'info', finished: 'neutral', ended: 'neutral' };
const statusText: Record<ClassRow['status'], string> = { current: 'Teaching now', upcoming: 'Starts later', finished: 'Finished', ended: 'Ended early' };

// Five "Made lessons…" lines a second apart read as one line, "Made lessons… (5 times)".
function grouped(items: Feed['items']) {
  const out: { id: string; at: string; text: string; times: number }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.text === item.text && accraDay(last.at) === accraDay(item.at)) last.times += 1; else out.push({ ...item, times: 1 });
  }
  return out;
}
function FeedList({ items }: { items: Feed['items'] }) {
  return <ol className="timeline">{grouped(items).map(i => <li key={i.id}><strong>{i.text}{i.times > 1 ? ` (${i.times} times)` : ''}</strong><span>{when(i.at)}</span></li>)}</ol>;
}

// One staff member on one page: who they are in a card, a summary and the head's account actions down the side, and tabs for
// what they do (classes they teach, what they have done lately). Only the headteacher sees it; it reads records the school keeps.
export function StaffPage({ schoolId, csrfToken, role, membershipId }: { schoolId: string; csrfToken: string; role: string; membershipId: string }) {
  const [data, setData] = useState<Staff | null>(null); const [error, setError] = useState(''); const [tab, setTab] = useState<TabId>('overview');
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [dialog, setDialog] = useState<'phone' | 'remove' | 'details' | null>(null); const [phone, setPhone] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null); const [offset, setOffset] = useState(0);
  const headers = { 'x-csrf-token': csrfToken };
  const load = useCallback(async () => {
    try { setData(await request<Staff>(`/schools/${schoolId}/accounts/${membershipId}`)); } catch (e) { setError((e as Error).message); }
  }, [schoolId, membershipId]);
  useEffect(() => { void load(); }, [load]);
  // The Activity tab reads 25 at a time.
  useEffect(() => {
    if (tab !== 'activity') return;
    let live = true;
    request<Feed>(`/schools/${schoolId}/accounts/${membershipId}/activity?offset=${offset}`).then(r => { if (live) setFeed(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [tab, offset, schoolId, membershipId, data]);
  const back = () => history.length > 1 ? history.back() : (location.hash = data?.member.role === 'teacher' ? '#/teachers' : '#/staff');
  const act = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); await load(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); } };
  if (error && !data) return <section className="page"><PageHeader eyebrow="Staff" title="Staff member unavailable" blurb={error} actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/></section>;
  if (!data) return <p role="status">Loading…</p>;

  const m = data.member, isTeacher = m.role === 'teacher', manage = role === 'headteacher' && m.role !== 'headteacher' && !m.revokedAt;
  const kind = roleNames[m.role] ?? m.role;
  const status = m.revokedAt ? <Pill tone="neutral">Access removed</Pill> : m.mustChangePassword ? <Pill tone="caution">No password chosen yet</Pill> : <Pill tone="positive">Active</Pill>;
  const statusLabel = m.revokedAt ? 'Access removed' : m.mustChangePassword ? 'No password chosen yet' : 'Active';
  const current = data.classes.filter(c => c.status === 'current');
  const created = data.account.find(a => a.text === 'Sign-in created');
  const phoneLink = m.phone ? <a href={`tel:${m.phone}`}>{localPhone(m.phone)}</a> : 'Not recorded';
  const d = data.details, contact = d.emergencyName ? `${d.emergencyName}${d.emergencyRelationship ? ` · ${d.emergencyRelationship}` : ''}` : null;
  const row = (label: string, value?: React.ReactNode, wide = false) => <div key={label} className={wide ? 'wide' : undefined}><dt>{label}</dt><dd>{value || notRecorded}</dd></div>;
  const saveDetails = async (values: Record<string, string>, operationId: string) => {
    await request(`/schools/${schoolId}/accounts/${m.membershipId}/details`, { method: 'PUT', headers, body: JSON.stringify({ operationId, version: d.version, ...values }) });
    setDialog(null); setNotice('Details saved.'); await load();
  };

  const reset = () => void act(async () => {
    const result = await request<{ temporaryPassword: string }>(`/schools/${schoolId}/accounts/${m.userId}/reset-password`, { method: 'POST', headers, body: '{}' });
    setCredentials({ label: `New password for ${m.name}`, email: m.login, temporaryPassword: result.temporaryPassword });
  });
  const savePhone = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    await request(`/schools/${schoolId}/accounts/${m.userId}/phone`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
    setNotice(phone.trim() ? `Phone number saved for ${m.name}.` : `Phone number removed for ${m.name}.`); setDialog(null);
  }); };
  const remove = () => void act(async () => {
    await request(`/schools/${schoolId}/accounts/${m.userId}/revoke`, { method: 'POST', headers, body: '{}' });
    setNotice(`${m.name} can no longer sign in to this school.`); setDialog(null);
  });
  const actions: QuickAction[] = [
    ...(manage ? [{ icon: 'lock_reset', label: 'Reset password', onClick: reset, disabled: busy }, { icon: 'call', label: m.phone ? 'Change phone number' : 'Add a phone number', onClick: () => { setError(''); setPhone(m.phone ?? ''); setDialog('phone'); }, disabled: busy }] : []),
    ...(role === 'headteacher' ? [{ icon: 'edit', label: 'Edit details', onClick: () => { setError(''); setNotice(''); setDialog('details'); }, disabled: busy }] : []),
    ...(isTeacher && !m.revokedAt ? [{ icon: 'assignment_ind', label: 'Class assignments', href: '#/teachers/assignments' }] : []),
    ...(manage ? [{ icon: 'person_off', label: 'Remove access', onClick: () => { setError(''); setDialog('remove'); }, disabled: busy, tone: 'danger' as const }] : []),
  ];
  const tabs: { id: TabId; label: string }[] = [{ id: 'overview', label: 'Overview' }, ...(isTeacher ? [{ id: 'classes' as const, label: 'Classes' }] : []), { id: 'activity', label: 'Activity' }];
  const classTable = (rows: ClassRow[]) => <div className="table-wrap"><table><thead><tr><th>Class</th><th className="hide-sm">Year</th><th className="num">Students</th><th>Period</th><th>Status</th></tr></thead><tbody>
    {rows.map(c => <tr key={c.id}><td>{c.className}<span className="sub">{c.level}</span></td><td className="hide-sm">{c.yearName}</td><td className="num">{c.status === 'current' ? c.students : '–'}</td>
      <td>{day(c.startDate)} – {day(c.endDate)}<span className="sub">{c.endedReason ? `Ended: ${c.endedReason}` : c.reason}</span></td><td><Pill tone={statusTone[c.status]}>{statusText[c.status]}</Pill></td></tr>)}</tbody></table></div>;

  return <section className="page staff-page" aria-label={`${kind} ${m.name}`}>
    <PageHeader eyebrow={isTeacher ? 'Teacher' : 'Staff'} title={isTeacher ? 'Teacher details' : 'Staff details'} blurb={`${kind} · ${m.login}`}
      actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/>
    {error && !dialog && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {credentials && <div role="status" className="credentials"><strong>{credentials.label}</strong><p>Sign in with: {credentials.email}<br/>Temporary password: <code>{credentials.temporaryPassword}</code></p><p className="muted">Shown once. Share it privately.</p><button type="button" className="secondary" onClick={() => setCredentials(null)}>I have copied it</button></div>}
    <ProfileCard name={m.name} kind={kind} pills={status}
      facts={[{ label: 'Sign-in', value: m.login, wide: true }, { label: 'Phone', value: phoneLink },
        ...(d.jobTitle ? [{ label: 'Job title', value: d.jobTitle }] : []), ...(d.staffNumber ? [{ label: 'Staff number', value: d.staffNumber }] : []),
        ...(isTeacher ? [{ label: 'Classes now', value: current.length ? current.map(c => c.className).join(', ') : 'None' }, { label: 'Students', value: String(data.summary.students) }] : [{ label: 'Role', value: kind }])]}/>
    <div className="profile-layout">
      <div className="profile-main">
        <div className="profile-tabs"><Tabs label="Staff member" value={tab} onChange={setTab} options={tabs}/></div>

        {tab === 'overview' && <>
          <div className="stats">{data.summary.highlights.map(h => <Stat key={h.label} label={h.label} value={h.value} caption="Last 30 days" tone={h.value ? 'positive' : 'neutral'}/>)}
            {data.summary.moneyPesewas !== null && <Stat label="Money recorded" value={cedis(data.summary.moneyPesewas)} caption="Last 30 days" tone={data.summary.moneyPesewas ? 'positive' : 'neutral'}/>}</div>
          <div className="cards-2">
            <Card title="Account information">
              <dl className="facts-grid">
                <div><dt>Full name</dt><dd>{m.name}</dd></div><div><dt>Role</dt><dd>{kind}</dd></div>
                <div className="wide"><dt>Sign-in</dt><dd>{m.login}</dd></div><div><dt>Phone</dt><dd>{phoneLink}</dd></div>
                <div><dt>Status</dt><dd>{statusLabel}</dd></div>
                {created && <div><dt>Sign-in created</dt><dd>{day(created.at)}{created.by ? ` by ${created.by}` : ''}</dd></div>}
              </dl>
            </Card>
            {isTeacher ? <Card title="Teaching" action={<button type="button" className="secondary small" onClick={() => setTab('classes')}>All classes</button>}>
              {!current.length ? <p className="muted">Not teaching any class today. Assign one on the Class assignments tab of Teachers.</p>
                : <ul className="plain-list">{current.map(c => <li key={c.id}><strong>{c.className}</strong><span className="sub">{c.students} student{c.students === 1 ? '' : 's'} · until {day(c.endDate)}</span></li>)}</ul>}
            </Card> : <Card title="What this role does"><p className="muted">{({ frontdesk: 'Records applications and admissions, links parents to students, and releases students at pick-up.', accountant: 'Records payments, bills students and prints receipts.', headteacher: 'Runs the school: people, classes, assessment, reports and settings.' } as Record<string, string>)[m.role] ?? ''}</p></Card>}
          </div>
          <div className="cards-2">
            <Card title="Professional details" action={role === 'headteacher' ? <button type="button" className="secondary small" onClick={() => { setError(''); setNotice(''); setDialog('details'); }}><Icon name="edit"/>Edit</button> : undefined}>
              <dl className="facts-grid">
                {row('Job title', d.jobTitle)}{row('Staff number', d.staffNumber)}{row('Employment', d.employmentType)}{row('Date joined', d.dateJoined ? day(d.dateJoined) : null)}
                {row('Qualification', d.qualification)}{row('Teaching licence', d.licenceNumber)}{row('Subjects or duties', d.subjects, true)}
              </dl>
            </Card>
            <Card title="Contact and emergency" hint="All optional.">
              <dl className="facts-grid">
                {row('Home address', d.homeAddress, true)}{row('Emergency contact', contact)}
                {d.emergencyPhone ? <div><dt>Contact phone</dt><dd><a href={`tel:${d.emergencyPhone}`}>{localPhone(d.emergencyPhone)}</a></dd></div> : row('Contact phone', null)}
              </dl>
            </Card>
          </div>
          <Card title="Recent activity" action={data.activity.total > data.activity.items.length ? <button type="button" className="secondary small" onClick={() => setTab('activity')}>View all</button> : undefined}>
            {!data.activity.items.length ? <Empty title="Nothing recorded yet" hint="What this person does in the app appears here."/> : <FeedList items={data.activity.items}/>}
          </Card>
        </>}

        {tab === 'classes' && <Card title="Classes" hint="Every class this teacher has been assigned to, current first." flush action={role === 'headteacher' ? <a className="button secondary" href="#/teachers/assignments">Manage assignments</a> : undefined}>
          {!data.classes.length ? <Empty title="Not assigned to any class yet" hint="Assign this teacher on the Class assignments tab of Teachers."/> : classTable([...current, ...data.classes.filter(c => c.status !== 'current')])}
        </Card>}

        {tab === 'activity' && <>
          <Card title="What they have done" hint="Newest first. Only the main things people do are listed." flush>
            {!feed ? <p role="status" className="muted card-body">Loading…</p> : !feed.items.length ? <Empty title="Nothing recorded yet"/> : <div className="card-body"><FeedList items={feed.items}/></div>}
            {feed && <Pager offset={feed.offset} shown={feed.items.length} total={feed.total} noun="entries" onMove={setOffset}/>}
          </Card>
          <Card title="History of this sign-in" hint="Who created it and what was changed since.">
            {!data.account.length ? <p className="muted">No changes recorded for this sign-in.</p>
              : <ol className="timeline">{data.account.map((a, i) => <li key={i}><strong>{a.text}</strong><span>{when(a.at)}{a.by ? ` · ${a.by}` : ''}</span></li>)}</ol>}
          </Card>
        </>}
      </div>

      <aside className="profile-rail" aria-label="Summary and account actions">
        <SummaryCard title="Summary" rows={[
          { icon: 'badge', label: 'Role', value: kind },
          { icon: 'mail', label: 'Sign-in', value: m.login },
          { icon: 'call', label: 'Phone', value: phoneLink },
          ...(d.jobTitle ? [{ icon: 'work', label: 'Job title', value: d.jobTitle }] : []),
          { icon: 'verified_user', label: 'Status', value: statusLabel },
          ...(d.dateJoined ? [{ icon: 'event', label: 'Joined', value: day(d.dateJoined) }] : []),
          ...(isTeacher ? [{ icon: 'school', label: 'Classes now', value: String(data.summary.classes) }, { icon: 'groups', label: 'Students', value: String(data.summary.students) }] : []),
          ...(created ? [{ icon: 'calendar_month', label: 'Sign-in created', value: day(created.at) }] : []),
        ]}/>
        {actions.length > 0 && <QuickActions actions={actions}/>}
      </aside>
    </div>

    {dialog === 'phone' && <Dialog title={`Phone number for ${m.name}`} onClose={() => setDialog(null)}>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={savePhone}>
        <label>Mobile number (for SMS notices; leave empty to remove)<input value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} placeholder="024 123 4567"/></label>
        <div className="actions"><button disabled={busy}>Save phone number</button><button type="button" className="secondary" onClick={() => setDialog(null)}>Cancel</button></div>
      </form>
    </Dialog>}
    {dialog === 'details' && <DetailsDialog title={`Details for ${m.name}`} intro="Everything here is optional. A field left empty is cleared." groups={staffGroups} onSave={saveDetails} onClose={() => setDialog(null)}
      values={{ jobTitle: d.jobTitle, staffNumber: d.staffNumber, employmentType: d.employmentType, dateJoined: d.dateJoined, qualification: d.qualification, licenceNumber: d.licenceNumber, subjects: d.subjects,
        homeAddress: d.homeAddress, emergencyName: d.emergencyName, emergencyRelationship: d.emergencyRelationship, emergencyPhone: d.emergencyPhone ? localPhone(d.emergencyPhone) : '' }}/>}
    {dialog === 'remove' && <Dialog title={`Remove ${m.name}'s access`} onClose={() => setDialog(null)}>
      {error && <p role="alert">{error}</p>}
      <p>{m.name} will no longer be able to sign in to this school. What they recorded stays as it was.</p>
      <div className="actions"><button type="button" disabled={busy} onClick={remove}>Yes, remove access</button><button type="button" className="secondary" onClick={() => setDialog(null)}>Keep access</button></div>
    </Dialog>}
  </section>;
}
