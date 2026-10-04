import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';

type Role = 'headteacher' | 'guardian' | string;
type GuardianCandidate = { id: string; display_name: string };
type GuardianLink = { id: string; learner_id: string; learner_name: string; guardian_membership_id: string; guardian_name: string; academic: boolean; billing: boolean; pickup: boolean; contact: boolean; verified_at?: string | null; revoked_at?: string | null; version: number; verification_reason?: string | null; revocation_reason?: string | null };
type GuardianLinkPage = { items: GuardianLink[]; total: number; offset: number; limit: number };
type LearnerChoice = { id: string; full_name: string; admission_number: string };
type LearnerPage = { items: LearnerChoice[]; total: number };
type Child = { id: string; full_name: string; admission_number: string; academic: boolean; billing: boolean; pickup: boolean; contact: boolean };
type ChildDetail = Child & { date_of_birth?: string | null; enrolments?: { class_name: string; start_date: string; end_date?: string | null }[] };
type Props = { schoolId: string; csrfToken: string; role: Role };
type Rights = Pick<GuardianLink, 'academic' | 'billing' | 'pickup' | 'contact'>;

const rightNames: [keyof Rights, string][] = [['academic', 'Academic records'], ['billing', 'Billing information'], ['pickup', 'Collection and pickup'], ['contact', 'School contact']];
const enrolmentStatus = (startDate: string, endDate?: string | null) => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
  if (startDate > today) return 'Scheduled';
  if (endDate && endDate <= today) return 'Ended';
  return 'Active today';
};

export function Guardians({ schoolId, csrfToken, role }: Props) {
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
      setSelectedGuardian(''); setRights({ academic: false, billing: false, pickup: false, contact: false });
    }
  }

  async function linkAction(link: GuardianLink, action: 'verify' | 'revoke') {
    const reason = reasons[link.id]?.[action].trim() ?? '';
    const payload = { version: link.version, reason };
    if (await mutate(`guardian-link:${link.id}:${action}`, payload, `/schools/${schoolId}/guardian-links/${link.id}/${action}`, `Guardian link ${action === 'verify' ? 'verified' : 'revoked'}.`)) {
      setReasons(previous => ({ ...previous, [link.id]: { verify: '', revoke: '' } }));
    }
  }

  const pending = (link: GuardianLink) => !link.verified_at && !link.revoked_at;
  const rightsText = (row: Rights) => rightNames.filter(([key]) => row[key]).map(([, name]) => name);

  return <section aria-labelledby="guardians-title">
    <p className="eyebrow">Family access</p>
    <h2 id="guardians-title">{isHeadteacher ? 'Guardian rights' : 'Guardian portal'}</h2>
    <p className="muted">{isHeadteacher ? 'Create a pending link, review each access right, then verify or revoke it with a reason.' : 'See only the children and information permitted by your verified school access.'}</p>
    <div className="actions"><button type="button" className="secondary" disabled={busy || loading} onClick={() => void refresh()}>Refresh guardian records</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {loading ? <p role="status">Loading guardian records…</p> : isHeadteacher ? <>
      <h3>Guardian links</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); const term = linksSearchInput.trim(); setLinksOffset(0); if (linksOffset === 0 && term === linksSearch) void loadLinks(true, 0); setLinksSearch(term); }}>
        <label>Search guardian links<input type="search" value={linksSearchInput} maxLength={120} onChange={event => setLinksSearchInput(event.target.value)} placeholder="Learner or guardian name"/></label>
        <button type="submit" disabled={busy}>Search links</button>
      </form>
      {links.length ? <ul className="history">{links.map(link => <li key={link.id}>
        <strong>{link.learner_name} · {link.guardian_name}</strong>
        <span>Access: {rightsText(link).join(', ') || 'No rights listed'}</span>
        <span>{pending(link) ? 'Pending verification' : link.revoked_at ? `Revoked ${link.revoked_at}` : `Verified ${link.verified_at}`}</span>
        {link.verification_reason && <span>Verification reason: {link.verification_reason}</span>}
        {link.revocation_reason && <span>Revocation reason: {link.revocation_reason}</span>}
        {pending(link) && <form onSubmit={event => { event.preventDefault(); void linkAction(link, 'verify'); }}><label>Reviewed verification reason<input value={reasons[link.id]?.verify ?? ''} onChange={event => setReasons(prev => ({ ...prev, [link.id]: { verify: event.target.value, revoke: prev[link.id]?.revoke ?? '' } }))} minLength={3} maxLength={500} required/></label><button disabled={busy}>Verify guardian link</button></form>}
        {!link.revoked_at && <form onSubmit={event => { event.preventDefault(); void linkAction(link, 'revoke'); }}><label>Revocation reason<input value={reasons[link.id]?.revoke ?? ''} onChange={event => setReasons(prev => ({ ...prev, [link.id]: { verify: prev[link.id]?.verify ?? '', revoke: event.target.value } }))} minLength={3} maxLength={500} required/></label><button className="secondary" disabled={busy}>Revoke guardian link</button></form>}
      </li>)}</ul> : <p>{linksSearch ? 'No guardian links match this search.' : 'No guardian links recorded.'}</p>}
      <div className="actions" aria-label="Guardian link pages"><button type="button" className="secondary" disabled={busy || linksLoading || linksOffset === 0} onClick={() => setLinksOffset(Math.max(0, linksOffset - 25))}>Previous guardian links</button><span className="muted">{linksTotal === 0 ? '0 guardian links' : `Showing ${linksOffset + 1}–${Math.min(linksOffset + links.length, linksTotal)} of ${linksTotal} guardian links`}</span><button type="button" className="secondary" disabled={busy || linksLoading || linksOffset + links.length >= linksTotal} onClick={() => setLinksOffset(linksOffset + 25)}>Next guardian links</button></div>

      <h3>Create guardian link</h3>
      <form onSubmit={createLink}>
        <label>Search learners<input type="search" value={learnerSearchInput} maxLength={120} onChange={event => setLearnerSearchInput(event.target.value)} placeholder="Name or admission number"/></label>
        <div className="actions"><button type="button" className="secondary" disabled={busy || learnerSearchInput.trim() === learnerSearch} onClick={() => { setLearnerOffset(0); setLearnerSearch(learnerSearchInput.trim()); }}>Search learners</button><span className="muted">{learnerTotal === 0 ? '0 learners' : `Showing ${learnerOffset + 1}–${Math.min(learnerOffset + learnerRows.length, learnerTotal)} of ${learnerTotal}`}</span><button type="button" className="secondary" disabled={busy || learnerOffset === 0} onClick={() => setLearnerOffset(Math.max(0, learnerOffset - 25))}>Previous learners</button><button type="button" className="secondary" disabled={busy || learnerOffset + learnerRows.length >= learnerTotal} onClick={() => setLearnerOffset(learnerOffset + 25)}>Next learners</button></div>
        <label>Learner<select value={selectedLearner} onChange={event => { const id = event.target.value; setSelectedLearner(id); setSelectedLearnerChoice(learnerRows.find(learner => learner.id === id) ?? null); }} required><option value="">Choose a learner on this page</option>{selectedLearnerChoice && !learnerRows.some(learner => learner.id === selectedLearner) && <option value={selectedLearnerChoice.id}>{selectedLearnerChoice.full_name} · {selectedLearnerChoice.admission_number} (selected)</option>}{learnerRows.map(learner => <option key={learner.id} value={learner.id}>{learner.full_name} · {learner.admission_number}</option>)}</select></label>
        <label>Existing active guardian<select value={selectedGuardian} onChange={event => setSelectedGuardian(event.target.value)} required><option value="">Choose a guardian account</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>)}</select></label>
        <fieldset><legend>Rights requested for this link</legend>{rightNames.map(([key, label]) => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={rights[key]} onChange={event => setRights(previous => ({ ...previous, [key]: event.target.checked }))}/>{label}</label>)}</fieldset>
        <button disabled={busy || !Object.values(rights).some(Boolean)}>Create pending guardian link</button>
      </form>
    </> : <>
      {children.length ? <>
        <label>Linked child<select value={selectedChild} onChange={event => { if (event.target.value === selectedChild) return; detailEpoch.current++; selectedChildRef.current = event.target.value; setChildDetail(null); setDetailLoading(Boolean(event.target.value)); setSelectedChild(event.target.value); }}><option value="">Choose a child</option>{children.map(child => <option key={child.id} value={child.id}>{child.full_name} · {child.admission_number}</option>)}</select></label>
        {selectedChild && (() => {
          const child = children.find(row => row.id === selectedChild);
          if (!child) return null;
          return <div><h3>{child.full_name}</h3><p className="muted">Admission number {child.admission_number}</p>
            {detailLoading ? <p role="status">Checking current guardian access…</p> : childDetail ? <><h4>Your verified access</h4><ul>{rightsText(childDetail).map(name => <li key={name}>{name}</li>)}</ul>
              {childDetail.academic && <div><h4>Academic information</h4><p>Date of birth: {childDetail.date_of_birth || 'Not recorded'}</p><h4>Enrolment history</h4>{childDetail.enrolments?.length ? <ul className="history">{childDetail.enrolments.map((row, index) => <li key={`${row.class_name}-${row.start_date}-${index}`}><strong>{row.class_name}</strong><span>{enrolmentStatus(row.start_date, row.end_date)} · Starts {row.start_date}{row.end_date ? ` · Ends (exclusive) ${row.end_date}` : ''}</span></li>)}</ul> : <p>No enrolment history is available.</p>}</div>}
            </> : null}
          </div>;
        })()}
      </> : <p>No verified linked children are available for this account.</p>}
    </>}
  </section>;
}
