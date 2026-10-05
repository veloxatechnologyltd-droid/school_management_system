import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, when } from '../lib/ui';

type Role = 'headteacher' | 'guardian' | string;
type GuardianCandidate = { id: string; display_name: string };
type GuardianLink = { id: string; learner_id: string; learner_name: string; guardian_membership_id: string; guardian_name: string; academic: boolean; billing: boolean; pickup: boolean; contact: boolean; verified_at?: string | null; revoked_at?: string | null; version: number; verification_reason?: string | null; revocation_reason?: string | null };
type GuardianLinkPage = { items: GuardianLink[]; total: number; offset: number; limit: number };
type LearnerChoice = { id: string; full_name: string; admission_number: string };
type LearnerPage = { items: LearnerChoice[]; total: number };
type Child = { id: string; full_name: string; admission_number: string; academic: boolean; billing: boolean; pickup: boolean; contact: boolean };
type ChildDetail = Child & { date_of_birth?: string | null; enrolments?: { class_name: string; start_date: string; end_date?: string | null }[] };
type Props = { schoolId: string; csrfToken: string; role: Role; onChildChange?: (childId: string) => void };
type Rights = Pick<GuardianLink, 'academic' | 'billing' | 'pickup' | 'contact'>;

const rightNames: [keyof Rights, string][] = [['academic', 'Academic records'], ['billing', 'Billing information'], ['pickup', 'Collection and pickup'], ['contact', 'School contact']];
const enrolmentStatus = (startDate: string, endDate?: string | null) => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
  if (startDate > today) return 'Scheduled';
  if (endDate && endDate <= today) return 'Ended';
  return 'Active today';
};

export function Guardians({ schoolId, csrfToken, role, onChildChange }: Props) {
  const isHeadteacher = role === 'headteacher';
  const [candidates, setCandidates] = useState<GuardianCandidate[]>([]);
  const [links, setLinks] = useState<GuardianLink[]>([]);
  const [linksTotal, setLinksTotal] = useState(0);
  const [linksOffset, setLinksOffset] = useState(0);
  const [linksSearchInput, setLinksSearchInput] = useState('');
  const [linksSearch, setLinksSearch] = useState('');
  const [learnerRows, setLearnerRows] = useState<LearnerChoice[]>([]);
  const [learnerTotal, setLearnerTotal] = useState(0);
  const [learnerSearchInput, setLearnerSearchInput] = useState('');
  const [learnerSearch, setLearnerSearch] = useState('');
  const [learnerOffset, setLearnerOffset] = useState(0);
  const [selectedLearner, setSelectedLearner] = useState('');
  const [selectedLearnerChoice, setSelectedLearnerChoice] = useState<LearnerChoice | null>(null);
  const [selectedGuardian, setSelectedGuardian] = useState('');
  const [rights, setRights] = useState<Rights>({ academic: false, billing: false, pickup: false, contact: false });
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [childDetail, setChildDetail] = useState<ChildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reasons, setReasons] = useState<Record<string, { verify: string; revoke: string }>>({});
  const [baseLoading, setBaseLoading] = useState(true);
  const [linksLoading, setLinksLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [linking, setLinking] = useState(false);
  const [reviewing, setReviewing] = useState('');
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const alive = useRef(true);
  const baseEpoch = useRef(0);
  const linksEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const selectedChildRef = useRef('');

  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const previous = operations.current.get(key);
    if (previous?.payload === serialized) return previous.id;
    const next = { payload: serialized, id: crypto.randomUUID() };
    operations.current.set(key, next);
    return next.id;
  };

  const loadBase = useCallback(async (initial = false, learnerOffsetOverride?: number) => {
    const epoch = ++baseEpoch.current;
    if (initial) setBaseLoading(true);
    setError('');
    try {
      if (isHeadteacher) {
        const query = new URLSearchParams({ offset: String(learnerOffsetOverride ?? learnerOffset), limit: '25' });
        if (learnerSearch.trim()) query.set('search', learnerSearch.trim());
        const [candidateRows, learnerPage] = await Promise.all([
          request<GuardianCandidate[]>(`/schools/${schoolId}/guardian-candidates`),
          request<LearnerPage>(`/schools/${schoolId}/learners?${query.toString()}`),
        ]);
        if (!alive.current || baseEpoch.current !== epoch) return;
        setCandidates(candidateRows); setLearnerRows(learnerPage.items); setLearnerTotal(learnerPage.total);
      } else {
        const childRows = await request<Child[]>(`/schools/${schoolId}/guardian/children`);
        if (!alive.current || baseEpoch.current !== epoch) return;
        setChildren(childRows); setSelectedChild(prior => prior || childRows[0]?.id || '');
      }
    } catch (e) { if (alive.current && baseEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && baseEpoch.current === epoch && initial) setBaseLoading(false); }
  }, [isHeadteacher, learnerOffset, learnerSearch, schoolId]);

  const loadLinks = useCallback(async (initial = false, offsetOverride?: number) => {
    const epoch = ++linksEpoch.current;
    if (initial) { setLinksLoading(true); setLinks([]); setLinksTotal(0); }
    setError('');
    try {
      const query = new URLSearchParams({ offset: String(offsetOverride ?? linksOffset), limit: '25' });
      if (linksSearch.trim()) query.set('search', linksSearch.trim());
      const page = await request<GuardianLinkPage>(`/schools/${schoolId}/guardian-links?${query.toString()}`);
      if (!alive.current || linksEpoch.current !== epoch) return;
      setLinks(page.items); setLinksTotal(page.total);
    } catch (e) { if (alive.current && linksEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && linksEpoch.current === epoch && initial) setLinksLoading(false); }
  }, [linksOffset, linksSearch, schoolId]);

  const loading = baseLoading || (isHeadteacher && linksLoading);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; baseEpoch.current++; linksEpoch.current++; detailEpoch.current++; };
  }, []);

  useEffect(() => {
    void loadBase(true);
  }, [loadBase]);

  useEffect(() => {
    if (isHeadteacher) void loadLinks(true);
  }, [isHeadteacher, loadLinks]);

  useEffect(() => { onChildChange?.(selectedChild); }, [onChildChange, selectedChild]);

  useEffect(() => {
    selectedChildRef.current = selectedChild;
    const epoch = ++detailEpoch.current;
    setChildDetail(null);
    if (!selectedChild) { setDetailLoading(false); return; }
    setDetailLoading(true);
    setError('');
    void request<ChildDetail>(`/schools/${schoolId}/guardian/children/${selectedChild}`).then(row => {
      if (alive.current && detailEpoch.current === epoch && selectedChildRef.current === selectedChild) { setChildDetail(row); setDetailLoading(false); }
    }).catch(e => {
      if (alive.current && detailEpoch.current === epoch && selectedChildRef.current === selectedChild) {
        setChildDetail(null); setSelectedChild(''); selectedChildRef.current = ''; setDetailLoading(false);
        setError(`Child access could not be refreshed: ${(e as Error).message}`);
      }
    });
  }, [children, schoolId, selectedChild]);

  async function refresh() {
    if (!isHeadteacher) { setSelectedChild(''); selectedChildRef.current = ''; setChildDetail(null); setDetailLoading(false); detailEpoch.current++; }
    if (isHeadteacher) await Promise.all([loadBase(true), loadLinks(true)]);
    else {
      await loadBase(true);
      window.dispatchEvent(new Event('guardian-records-refreshed'));
    }
  }

  async function mutate(key: string, payload: Record<string, unknown>, path: string, successMessage: string) {
    setBusy(true); setError(''); setNotice('');
    const body = { ...payload, operationId: operationId(key, payload) };
    try {
      await request(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) });
      if (!alive.current) return false;
      operations.current.delete(key);
      setNotice(successMessage);
      setLinksOffset(0); setLearnerOffset(0);
      await Promise.all([loadBase(false, 0), loadLinks(false, 0)]);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { if (alive.current) setBusy(false); }
  }

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLearner || !selectedGuardian || !Object.values(rights).some(Boolean)) return;
    const payload = { learnerId: selectedLearner, guardianMembershipId: selectedGuardian, ...rights };
    if (await mutate('guardian-link:create', payload, `/schools/${schoolId}/guardian-links`, 'Guardian link created as pending verification.')) {
      setSelectedGuardian(''); setRights({ academic: false, billing: false, pickup: false, contact: false }); setLinking(false);
    }
  }

  async function linkAction(link: GuardianLink, action: 'verify' | 'revoke') {
    const reason = reasons[link.id]?.[action].trim() ?? '';
    const payload = { version: link.version, reason };
    if (await mutate(`guardian-link:${link.id}:${action}`, payload, `/schools/${schoolId}/guardian-links/${link.id}/${action}`, `Guardian link ${action === 'verify' ? 'verified' : 'revoked'}.`)) {
      setReasons(previous => ({ ...previous, [link.id]: { verify: '', revoke: '' } })); setReviewing('');
    }
  }


  const pending = (link: GuardianLink) => !link.verified_at && !link.revoked_at;
  const rightsText = (row: Rights) => rightNames.filter(([key]) => row[key]).map(([, name]) => name);
  const statusPill = (link: GuardianLink) => pending(link) ? <Pill tone="caution">Pending verification</Pill> : link.revoked_at ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="positive">Verified</Pill>;
  const messages = <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>;
  const reviewed = links.find(link => link.id === reviewing);

  if (!isHeadteacher) {
    const child = children.find(row => row.id === selectedChild);
    const current = childDetail?.enrolments?.find(row => enrolmentStatus(row.start_date, row.end_date) === 'Active today');
    return <section aria-label="Guardian portal" className="page">
      <PageHeader id="guardians-title" eyebrow="My family" title="Guardian portal" blurb="School records and reports for the children linked to your account."
        actions={<>{children.length > 0 && <label className="inline-field">Linked child<select value={selectedChild} onChange={event => { if (event.target.value === selectedChild) return; detailEpoch.current++; selectedChildRef.current = event.target.value; setChildDetail(null); setDetailLoading(Boolean(event.target.value)); setSelectedChild(event.target.value); }}><option value="">Choose a child</option>{children.map(row => <option key={row.id} value={row.id}>{row.full_name} · {row.admission_number}</option>)}</select></label>}
          <button type="button" className="secondary" disabled={busy || loading} onClick={() => void refresh()}><Icon name="refresh"/>Refresh guardian records</button></>}/>
      {messages}
      {loading ? <p role="status">Loading guardian records…</p> : !children.length ? <Card><Empty title="No children linked yet" hint="Once the school verifies your link to a child, their records appear here."/></Card> : !child ? <Card><Empty title="Choose a child" hint="Pick a child above to see their records."/></Card> : <>
        <div className="profile-card">
          <span className="avatar large" aria-hidden="true">{child.full_name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>
          <div><h3>{child.full_name}</h3><p className="muted">Admission number {child.admission_number}{current ? ` · ${current.class_name}` : ''}</p></div>
        </div>
        {detailLoading ? <p role="status">Checking current guardian access…</p> : childDetail && <div className="columns">
          {childDetail.academic ? <Card title="Academic information">
            <p>Date of birth: {childDetail.date_of_birth || 'Not recorded'}</p>
            <h4>Enrolment history</h4>
            {childDetail.enrolments?.length ? <ul className="history">{childDetail.enrolments.map((row, index) => <li key={`${row.class_name}-${row.start_date}-${index}`}><strong>{row.class_name}</strong><span>{enrolmentStatus(row.start_date, row.end_date)} · Starts {row.start_date}{row.end_date ? ` · Ends (exclusive) ${row.end_date}` : ''}</span></li>)}</ul> : <p>No enrolment history is available.</p>}
          </Card> : <Card><Empty title="Academic records are not shared with you" hint="Ask the school if you should have academic access for this child."/></Card>}
          <Card title="Your verified access" hint="What the school has confirmed you may see and do.">
            <ul className="rights">{rightNames.map(([key, name]) => <li key={key}>{childDetail[key] ? <Pill tone="positive"><Icon name="check"/>{name}</Pill> : <Pill tone="neutral">{name}: not granted</Pill>}</li>)}</ul>
          </Card>
        </div>}
      </>}
    </section>;
  }

  return <section aria-label="Guardians" className="page">
    <PageHeader id="guardians-title" eyebrow="People" title="Guardians" blurb="Who may see each child’s records, pay fees, collect them and receive notices."
      actions={<><button type="button" disabled={loading} onClick={() => { setError(''); setNotice(''); setLinking(true); }}><Icon name="person_add"/>Link a guardian</button><button type="button" className="secondary" disabled={busy || loading} onClick={() => void refresh()}>Refresh guardian records</button></>}/>
    {!linking && !reviewing && messages}
    {loading ? <p role="status">Loading guardian records…</p> : <>
      <div className="stats">
        <Stat label="Guardian links" value={linksTotal} caption={linksSearch ? 'Matching this search' : 'Every link ever recorded'} icon="family_restroom"/>
        <Stat label="Awaiting verification" value={links.filter(pending).length} caption="In the list below" tone={links.some(pending) ? 'caution' : 'neutral'} icon="pending_actions"/>
        <Stat label="Guardian accounts" value={candidates.length} caption="Active sign-ins you can link" icon="badge"/>
      </div>
      <Card title="Guardian rights" hint="Each right is granted separately and only counts once you verify it." flush>
        <div className="toolbar">
          <form onSubmit={event => { event.preventDefault(); const term = linksSearchInput.trim(); setLinksOffset(0); if (linksOffset === 0 && term === linksSearch) void loadLinks(true, 0); setLinksSearch(term); }}>
            <label className="search"><span className="sr-only">Search guardian links</span><Icon name="search"/><input type="search" aria-label="Search guardian links" value={linksSearchInput} maxLength={120} onChange={event => setLinksSearchInput(event.target.value)} placeholder="Learner or guardian name"/></label>
            <button type="submit" className="secondary" disabled={busy}>Search links</button>
          </form>
        </div>
        {links.length ? <div className="table-wrap"><table><thead><tr><th>Learner</th><th className="hide-sm">Guardian</th><th className="hide-sm">Rights</th><th>Status</th><th></th></tr></thead><tbody>{links.map(link => <tr key={link.id}>
          <td>{link.learner_name}<span className="sub show-sm">{link.guardian_name}</span></td>
          <td className="hide-sm">{link.guardian_name}</td>
          <td className="hide-sm"><div className="pill-row">{rightsText(link).map(name => <Pill key={name} tone="info">{name}</Pill>)}</div></td>
          <td>{statusPill(link)}<span className="sub hide-sm">{link.revocation_reason ?? link.verification_reason ?? ''}</span></td>
          <td className="num"><button type="button" className="secondary" aria-label={`Review ${link.learner_name} – ${link.guardian_name}`} onClick={() => { setError(''); setNotice(''); setReviewing(link.id); }}>Review</button></td>
        </tr>)}</tbody></table></div> : <Empty title={linksSearch ? 'No guardian links match this search' : 'No guardian links yet'} hint={linksSearch ? undefined : 'Link a guardian’s sign-in to a learner, then verify it.'}/>}
        <div className="pager" aria-label="Guardian link pages"><span>{linksTotal === 0 ? '0 guardian links' : `Showing ${linksOffset + 1}–${Math.min(linksOffset + links.length, linksTotal)} of ${linksTotal} guardian links`}</span><div><button type="button" className="secondary" disabled={busy || linksLoading || linksOffset === 0} onClick={() => setLinksOffset(Math.max(0, linksOffset - 25))}>Previous guardian links</button><button type="button" className="secondary" disabled={busy || linksLoading || linksOffset + links.length >= linksTotal} onClick={() => setLinksOffset(linksOffset + 25)}>Next guardian links</button></div></div>
      </Card>
    </>}

    {linking && <Dialog title="Link a guardian" onClose={() => setLinking(false)}>
      {messages}
      <form onSubmit={createLink}>
        <div className="actions"><label>Search learners<input type="search" value={learnerSearchInput} maxLength={120} onChange={event => setLearnerSearchInput(event.target.value)} placeholder="Name or admission number"/></label><button type="button" className="secondary" disabled={busy || learnerSearchInput.trim() === learnerSearch} onClick={() => { setLearnerOffset(0); setLearnerSearch(learnerSearchInput.trim()); }}>Search learners</button></div>
        <label>Learner<select value={selectedLearner} onChange={event => { const id = event.target.value; setSelectedLearner(id); setSelectedLearnerChoice(learnerRows.find(learner => learner.id === id) ?? null); }} required><option value="">Choose a learner on this page</option>{selectedLearnerChoice && !learnerRows.some(learner => learner.id === selectedLearner) && <option value={selectedLearnerChoice.id}>{selectedLearnerChoice.full_name} · {selectedLearnerChoice.admission_number} (selected)</option>}{learnerRows.map(learner => <option key={learner.id} value={learner.id}>{learner.full_name} · {learner.admission_number}</option>)}</select></label>
        <div className="actions"><span className="muted">{learnerTotal === 0 ? '0 learners' : `Showing ${learnerOffset + 1}–${Math.min(learnerOffset + learnerRows.length, learnerTotal)} of ${learnerTotal}`}</span><button type="button" className="secondary" disabled={busy || learnerOffset === 0} onClick={() => setLearnerOffset(Math.max(0, learnerOffset - 25))}>Previous learners</button><button type="button" className="secondary" disabled={busy || learnerOffset + learnerRows.length >= learnerTotal} onClick={() => setLearnerOffset(learnerOffset + 25)}>Next learners</button></div>
        <label>Existing active guardian<select value={selectedGuardian} onChange={event => setSelectedGuardian(event.target.value)} required><option value="">Choose a guardian account</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>)}</select></label>
        <fieldset><legend>Rights requested for this link</legend>{rightNames.map(([key, label]) => <label key={key}><input type="checkbox" checked={rights[key]} onChange={event => setRights(previous => ({ ...previous, [key]: event.target.checked }))}/>{label}</label>)}</fieldset>
        <p className="muted">The link starts as pending. Nothing is visible to the guardian until you verify it.</p>
        <div className="actions"><button disabled={busy || !Object.values(rights).some(Boolean)}>Create pending guardian link</button><button type="button" className="secondary" onClick={() => setLinking(false)}>Cancel</button></div>
      </form>
    </Dialog>}

    {reviewed && <Dialog title={`${reviewed.learner_name} · ${reviewed.guardian_name}`} drawer onClose={() => setReviewing('')}>
      {messages}
      <p>{statusPill(reviewed)}</p>
      <h4>Rights on this link</h4>
      <div className="pill-row">{rightsText(reviewed).map(name => <Pill key={name} tone="info">{name}</Pill>)}</div>
      <h4>History</h4>
      <ul className="history">
        <li><strong>{pending(reviewed) ? 'Pending verification' : `Verified ${when(reviewed.verified_at)}`}</strong>{reviewed.verification_reason && <span>Verification reason: {reviewed.verification_reason}</span>}</li>
        {reviewed.revoked_at && <li><strong>Revoked {when(reviewed.revoked_at)}</strong>{reviewed.revocation_reason && <span>Revocation reason: {reviewed.revocation_reason}</span>}</li>}
      </ul>
      {pending(reviewed) && <form onSubmit={event => { event.preventDefault(); void linkAction(reviewed, 'verify'); }}><h4>Verify</h4><label>Reviewed verification reason<input value={reasons[reviewed.id]?.verify ?? ''} onChange={event => setReasons(prev => ({ ...prev, [reviewed.id]: { verify: event.target.value, revoke: prev[reviewed.id]?.revoke ?? '' } }))} minLength={3} maxLength={500} required placeholder="How you confirmed this person"/></label><button disabled={busy}>Verify guardian link</button></form>}
      {!reviewed.revoked_at && <form onSubmit={event => { event.preventDefault(); void linkAction(reviewed, 'revoke'); }}><h4>Revoke</h4><p className="muted">To change rights, revoke this link and create a new one. The history stays.</p><label>Revocation reason<input value={reasons[reviewed.id]?.revoke ?? ''} onChange={event => setReasons(prev => ({ ...prev, [reviewed.id]: { verify: prev[reviewed.id]?.verify ?? '', revoke: event.target.value } }))} minLength={3} maxLength={500} required/></label><button className="secondary" disabled={busy}>Revoke guardian link</button></form>}
    </Dialog>}
  </section>;
}
