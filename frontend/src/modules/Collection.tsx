import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, PageHeader, Pill, when } from '../lib/ui';

type Props = { schoolId: string; csrfToken: string; role: string };
type Page<T> = { date: string; items: T[]; total: number; offset: number; limit: number };
type LearnerRow = { id: string; version: number; full_name: string; admission_number: string; class_name: string | null };
type Collector = { id: string; version: number; collector_name: string };
type EventRow = { id: string; date: string; released_at: string; collector_name: string; verification_reason: string; learner_name: string; admission_number: string; class_name: string | null; voided_at?: string | null; void_reason?: string | null; version: number; exception_id?: string | null };
type CaseRow = { id: string; date: string; collector_name: string; request_reason: string; status: 'pending' | 'approved' | 'declined' | 'used' | 'cancelled'; version: number; decision_reason?: string | null; review_verification?: string | null; reviewed_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null };
type LearnerDetail = { date: string; learner: LearnerRow; collectors: Collector[]; events: EventRow[]; cases: CaseRow[]; history: { offset: number; limit: number; eventTotal: number; caseTotal: number }; activeEvent: { id: string } | null };
type ReviewInput = { reason: string; verificationReason: string };

export function Collection({ schoolId, csrfToken, role }: Props) {
  const headteacher = role === 'headteacher';
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [date, setDate] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const [collectorSource, setCollectorSource] = useState('');
  const [verificationReason, setVerificationReason] = useState('');
  const [releaseConfirmed, setReleaseConfirmed] = useState(false);
  const [requestCollector, setRequestCollector] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [reviewInputs, setReviewInputs] = useState<Record<string, ReviewInput>>({});
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const listEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const selectedRef = useRef('');
  const operations = useRef(new Map<string, { payload: string; id: string }>());

  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const previous = operations.current.get(key);
    if (previous?.payload === serialized) return previous.id;
    const next = { payload: serialized, id: crypto.randomUUID() };
    operations.current.set(key, next);
    return next.id;
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; listEpoch.current++; detailEpoch.current++; };
  }, []);

  async function loadLearners(nextOffset = offset, nextSearch = search) {
    const epoch = ++listEpoch.current;
    setLoading(true); setError('');
    const query = new URLSearchParams({ offset: String(nextOffset), limit: '25' });
    if (nextSearch.trim()) query.set('search', nextSearch.trim());
    if (includeHistory) query.set('history', 'true');
    try {
      const page = await request<Page<LearnerRow>>(`/schools/${schoolId}/collection/learners?${query.toString()}`);
      if (!alive.current || listEpoch.current !== epoch) return;
      setLearners(page.items); setTotal(page.total); setDate(page.date);
    } catch (e) { if (alive.current && listEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && listEpoch.current === epoch) setLoading(false); }
  }

  useEffect(() => { void loadLearners(); }, [schoolId, offset, search, includeHistory]);

  function clearSelection() {
    selectedRef.current = ''; setSelectedId(''); setDetail(null); setDetailLoading(false); detailEpoch.current++;
    setCollectorSource(''); setVerificationReason(''); setReleaseConfirmed(false);
    setRequestCollector(''); setRequestReason(''); setReviewInputs({}); setVoidReasons({});
  }

  async function selectLearner(id: string, requestedOffset = 0) {
    selectedRef.current = id; setSelectedId(id); setDetail(null); setError(''); setNotice(''); setDetailLoading(Boolean(id));
    setCollectorSource(''); setVerificationReason(''); setReleaseConfirmed(false);
    setRequestCollector(''); setRequestReason(''); setReviewInputs({}); setVoidReasons({});
    const epoch = ++detailEpoch.current;
    if (!id) return;
    try {
      const query = new URLSearchParams({ offset: String(requestedOffset), limit: '25' });
      const row = await request<LearnerDetail>(`/schools/${schoolId}/collection/learners/${id}?${query.toString()}`);
      if (alive.current && detailEpoch.current === epoch && selectedRef.current === id) { setDetail(row); setDetailOffset(row.history.offset); setDate(row.date); }
    } catch (e) { if (alive.current && detailEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && detailEpoch.current === epoch) setDetailLoading(false); }
  }

  useEffect(() => {
    if (selectedRef.current) void selectLearner(selectedRef.current, detailOffset);
    else clearSelection();
  }, [role, schoolId]);

  async function refresh() {
    clearSelection(); setOffset(0); setSearch(''); setSearchInput('');
    await loadLearners(0, '');
  }

  async function write(key: string, payload: Record<string, unknown>, path: string, success: string) {
    if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<LearnerDetail>(path, {
        method: 'POST', headers: { 'x-csrf-token': csrfToken },
        body: JSON.stringify({ ...payload, operationId: operationId(key, payload) }),
      });
      operations.current.delete(key);
      if (!alive.current || selectedRef.current !== selectedId) return;
      setDetail(result); setDetailOffset(result.history.offset); setDate(result.date); setNotice(success);
      setCollectorSource(''); setVerificationReason(''); setReleaseConfirmed(false);
      setRequestCollector(''); setRequestReason(''); setReviewInputs({}); setVoidReasons({});
      await loadLearners(offset, search);
    } catch (e) {
      if (!alive.current) return;
      const failure = e as Error & { status?: number };
      if (failure.status === 409) {
        await selectLearner(selectedId, detailOffset);
        if (alive.current) setNotice('This record changed elsewhere. The current detail was reloaded; review it before trying again.');
      } else setError(failure.message);
    } finally { if (alive.current) setBusy(false); }
  }

  const liveRelease = Boolean(detail?.activeEvent);
  const approvedCases = detail?.cases.filter(row => row.status === 'approved' && row.date === detail.date) ?? [];
  const currentCases = detail?.cases.filter(row => row.date === detail.date) ?? [];
  const olderCases = detail?.cases.filter(row => row.date < detail.date) ?? [];
  const currentEvents = detail?.events.filter(row => row.date === detail.date) ?? [];
  const olderEvents = detail?.events.filter(row => row.date < detail.date) ?? [];
  const historyTotal = Math.max(detail?.history.eventTotal ?? 0, detail?.history.caseTotal ?? 0);
  const selectedCollector = detail?.collectors.find(row => `guardian:${row.id}` === collectorSource);
  const selectedException = approvedCases.find(row => `case:${row.id}` === collectorSource);
  const releasePayload = detail && {
    learnerVersion: detail.learner.version,
    ...(selectedCollector ? { guardianLinkId: selectedCollector.id, guardianLinkVersion: selectedCollector.version } : {}),
    ...(selectedException ? { exceptionId: selectedException.id, exceptionVersion: selectedException.version } : {}),
    verificationReason: verificationReason.trim(),
  };

  async function release() {
    if (!detail || !releasePayload || (!selectedCollector && !selectedException)) return;
    const label = selectedCollector?.collector_name ?? selectedException?.collector_name ?? 'collector';
    await write(`collection:${detail.learner.id}:release`, releasePayload, `/schools/${schoolId}/collection/learners/${detail.learner.id}/release`, `Collection release recorded for ${label}.`);
  }

  async function requestCase(event: React.FormEvent) {
    event.preventDefault(); if (!detail || requestCollector.trim().length < 3 || requestReason.trim().length < 3) return;
    const payload = { learnerVersion: detail.learner.version, collectorName: requestCollector.trim(), reason: requestReason.trim() };
    await write(`collection:${detail.learner.id}:case`, payload, `/schools/${schoolId}/collection/learners/${detail.learner.id}/cases`, 'Unexpected collector request recorded for headteacher review.');
  }

  async function reviewCase(row: CaseRow, action: 'approve' | 'decline' | 'cancel') {
    const input = reviewInputs[row.id] ?? { reason: '', verificationReason: '' };
    if (input.reason.trim().length < 3 || (action === 'approve' && input.verificationReason.trim().length < 3)) return;
    const payload = { version: row.version, action, reason: input.reason.trim(), ...(action === 'approve' ? { verificationReason: input.verificationReason.trim() } : {}) };
    await write(`collection:case:${row.id}:review`, payload, `/schools/${schoolId}/collection/cases/${row.id}/review`, `Collector request ${action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'cancelled'}.`);
  }

  async function voidEvent(row: EventRow) {
    const reason = voidReasons[row.id]?.trim() ?? '';
    if (reason.length < 3) return;
    await write(`collection:event:${row.id}:void`, { version: row.version, reason }, `/schools/${schoolId}/collection/events/${row.id}/void`, 'Release record voided as a correction. This does not confirm physical return of the learner.');
  }

  function renderCase(row: CaseRow, allowReview: boolean) {
    const input = reviewInputs[row.id] ?? { reason: '', verificationReason: '' };
    const sameDay = row.date === detail?.date;
    return <li key={row.id}>
      <strong>{row.collector_name} · {row.status}{row.status === 'approved' && !sameDay ? ' · Expired' : ''}</strong><span>{row.date} · Request: {row.request_reason}</span>
      {row.decision_reason && <span>Decision reason: {row.decision_reason}</span>}{headteacher && row.review_verification && <span>Identity verification: {row.review_verification}</span>}{row.reviewed_at && <span>Reviewed {when(row.reviewed_at)}</span>}
      {row.cancellation_reason && <span>Cancellation reason: {row.cancellation_reason}{row.cancelled_at ? ` · Cancelled ${when(row.cancelled_at)}` : ''}</span>}
      {allowReview && headteacher && row.status === 'pending' && <div>
        {row.date < (detail?.date ?? '') && <p className="muted">Expired: approval is only available on the recorded school date.</p>}
        <label>Review reason<input minLength={3} maxLength={500} value={input.reason} onChange={event => setReviewInputs(current => ({ ...current, [row.id]: { ...input, reason: event.target.value } }))} /></label>
        <label>In-person identity verification reason (required to approve)<input minLength={3} maxLength={500} value={input.verificationReason} onChange={event => setReviewInputs(current => ({ ...current, [row.id]: { ...input, verificationReason: event.target.value } }))} /></label>
        <div className="actions"><button type="button" disabled={busy || !sameDay || input.reason.trim().length < 3 || input.verificationReason.trim().length < 3} onClick={() => void reviewCase(row, 'approve')}>Approve one-time exception</button><button type="button" className="secondary" disabled={busy || !sameDay || input.reason.trim().length < 3} onClick={() => void reviewCase(row, 'decline')}>Decline request</button></div>
      </div>}
      {allowReview && headteacher && row.status === 'approved' && <div><label>Cancellation reason<input minLength={3} maxLength={500} value={input.reason} onChange={event => setReviewInputs(current => ({ ...current, [row.id]: { ...input, reason: event.target.value } }))} /></label><button type="button" className="secondary" disabled={busy || input.reason.trim().length < 3} onClick={() => void reviewCase(row, 'cancel')}>Cancel unused exception</button></div>}
    </li>;
  }

  function renderEvent(row: EventRow, allowCorrection: boolean) {
    return <li key={row.id}>
      <strong>{row.learner_name} · {row.admission_number} · {row.class_name ?? 'No current class'}</strong><span>{row.collector_name} · {row.date} · Released {when(row.released_at)} · Staff verification: {row.verification_reason}</span>
      {row.exception_id && <span>One-time exception used. It remains consumed if this event is voided.</span>}
      {row.voided_at && <span>Voided {when(row.voided_at)} · Correction reason: {row.void_reason} · This does not confirm physical return.</span>}
      {allowCorrection && headteacher && !row.voided_at && <details><summary>Correct mistaken release record</summary><p className="muted">Voiding corrects the record only. It does not establish that the learner returned to school or that physical custody changed.</p><label>Correction reason<input minLength={3} maxLength={500} value={voidReasons[row.id] ?? ''} onChange={event => setVoidReasons(current => ({ ...current, [row.id]: event.target.value }))} /></label><button type="button" className="secondary" disabled={busy || (voidReasons[row.id]?.trim().length ?? 0) < 3} onClick={() => void voidEvent(row)}>Void mistaken release record</button></details>}
    </li>;
  }

  function searchSubmit(event: React.FormEvent) {
    event.preventDefault(); clearSelection(); setOffset(0); setSearch(searchInput.trim());
  }

  function toggleHistory(checked: boolean) {
    clearSelection(); setOffset(0); setSearch(''); setSearchInput(''); setIncludeHistory(checked);
  }

  const dateLine = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Loading…';
  const messages = <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>;
  return <section className="learner-collection page" aria-labelledby="collection-title">
    <PageHeader eyebrow={`Daily safety · ${dateLine}`} title="Pickup" blurb="Hand each child only to a verified collector or a reviewed one-time exception. Paying fees does not give pickup rights."
      actions={<button type="button" className="secondary" disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh"/>Refresh collection records</button>}/>
    {!selectedId && messages}
    <div className="columns pickup">
    <Card flush>
      <div className="card-head"><div><h3 id="collection-title">Learner collection</h3><p className="card-hint">Today’s roster{total ? ` · ${total} learners` : ''}</p></div></div>
      <div className="toolbar">
        <form onSubmit={searchSubmit}>
          <label className="search"><span className="sr-only">Search learners</span><Icon name="search"/><input type="search" aria-label="Search learners" maxLength={120} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Learner name or admission number" /></label>
          <button type="submit" className="secondary" disabled={loading || busy}>Search collection roster</button>
        </form>
        <label><input type="checkbox" checked={includeHistory} disabled={loading || busy} onChange={event => toggleHistory(event.target.checked)} /> Include learners with collection history</label>
      </div>
      {loading && !learners.length ? <p role="status">Loading today’s roster…</p> : learners.length ? <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th></tr></thead><tbody>{learners.map(row => <tr key={row.id} className={row.id === selectedId ? 'selected' : undefined}>
        <td><button type="button" className="link-button" disabled={busy} onClick={() => { void selectLearner(row.id); setTimeout(() => document.getElementById('collection-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>{row.full_name}</button><span className="sub">{row.admission_number}</span></td>
        <td>{row.class_name ?? <Pill tone="neutral">No current class</Pill>}</td>
      </tr>)}</tbody></table></div> : <Empty title={search ? 'No learners match this search' : 'No learners on today’s roster'}/>}
      <div className="pager" aria-label="Collection roster pages"><span>{total === 0 ? '0 learners' : `Showing ${offset + 1}–${Math.min(offset + learners.length, total)} of ${total}`}</span><div><button type="button" className="secondary" disabled={loading || busy || offset === 0} onClick={() => { clearSelection(); setOffset(Math.max(0, offset - 25)); }}>Previous learners</button><button type="button" className="secondary" disabled={loading || busy || offset + learners.length >= total} onClick={() => { clearSelection(); setOffset(offset + 25); }}>Next learners</button></div></div>
    </Card>
    <div id="collection-detail" className="card"><div className="card-body">
    {!selectedId && <Empty title="Choose a learner" hint="Tap a name to see who may collect them today and record the hand-over."/>}
    {selectedId && messages}
    {detailLoading && <p role="status">Loading current collectors and collection history…</p>}
    {detail && <div>
      <h3 className="detail-title">{detail.learner.full_name}</h3><p className="muted">Admission number {detail.learner.admission_number} · {detail.learner.class_name ?? 'No current class'} · Current school date {detail.date}</p>
      {detail.learner.class_name === null ? <p role="status">This learner has no current class. Collection activity is history-only; a new release or collector request cannot be recorded.</p> : liveRelease ? <p role="status">An active release is already recorded for this learner today. A headteacher may correct a mistaken record; voiding it does not confirm physical return.</p> : <>
        <h4>Record release</h4>
        {detail.collectors.length || approvedCases.length ? <label>Authorized collector / one-time exception<select value={collectorSource} disabled={busy} onChange={event => { setCollectorSource(event.target.value); setReleaseConfirmed(false); }}><option value="">Choose an authorized collector or approved exception</option>{detail.collectors.map(row => <option key={`guardian:${row.id}`} value={`guardian:${row.id}`}>Verified pickup: {row.collector_name}</option>)}{approvedCases.map(row => <option key={`case:${row.id}`} value={`case:${row.id}`}>Approved one-time exception: {row.collector_name}</option>)}</select></label> : <p>No current pickup authorization or approved exception is available.</p>}
        {collectorSource && <>
          <p className="muted">{selectedCollector ? 'The selected collector has a current verified pickup right.' : selectedException ? 'This approved exception is one-use and will remain consumed even if a release record is later voided.' : ''}</p>
          <label>Staff verification reason<input minLength={3} maxLength={500} value={verificationReason} disabled={busy} onChange={event => { setVerificationReason(event.target.value); setReleaseConfirmed(false); }} /></label>
          <label><input type="checkbox" checked={releaseConfirmed} disabled={busy} onChange={event => setReleaseConfirmed(event.target.checked)} /> I confirmed the collector’s identity in person and am handing the learner into their care now.</label>
          <button type="button" disabled={busy || !releasePayload || verificationReason.trim().length < 3 || !releaseConfirmed || Boolean(detail.events.some(event => event.date === detail.date && !event.voided_at))} onClick={() => void release()}>Record learner release</button>
        </>}
      </>}

      {detail.learner.class_name !== null && !liveRelease && <details><summary>Request an unexpected collector review</summary><p className="muted">Use this when the person collecting is not on the current verified pickup list. A headteacher must review the request before it can authorize one release.</p><form onSubmit={requestCase}>
        <label>Unexpected collector name<input minLength={3} maxLength={120} value={requestCollector} onChange={event => setRequestCollector(event.target.value)} required /></label>
        <label>Reason for requesting this exception<input minLength={3} maxLength={500} value={requestReason} onChange={event => setRequestReason(event.target.value)} required /></label>
        <button disabled={busy}>Request headteacher review</button>
      </form></details>}

      <h4>Unexpected collector requests · {detail.date}</h4>
      {currentCases.length ? <ul className="history">{currentCases.map(row => renderCase(row, true))}</ul> : <p>No unexpected collector requests recorded for this learner today.</p>}
      {olderCases.length > 0 && <details><summary>Earlier collector requests on this history page ({olderCases.length})</summary><ul className="history">{olderCases.map(row => renderCase(row, true))}</ul></details>}

      <h4>Release history · {detail.date}</h4>
      {currentEvents.length ? <ul className="history">{currentEvents.map(row => renderEvent(row, true))}</ul> : <p>No collection releases recorded for this learner today.</p>}
      {olderEvents.length > 0 && <details><summary>Earlier release records on this history page ({olderEvents.length})</summary><ul className="history">{olderEvents.map(row => renderEvent(row, true))}</ul></details>}
      <div className="actions" aria-label="Collection history pages"><button type="button" className="secondary" disabled={busy || detailLoading || detailOffset === 0} onClick={() => void selectLearner(detail.learner.id, Math.max(0, detailOffset - 25))}>Previous history</button><span className="muted">{historyTotal === 0 ? '0 historical records' : `History page ${Math.floor(detailOffset / 25) + 1} · ${detail.history.eventTotal} releases and ${detail.history.caseTotal} requests`}</span><button type="button" className="secondary" disabled={busy || detailLoading || detailOffset + detail.history.limit >= historyTotal} onClick={() => void selectLearner(detail.learner.id, detailOffset + 25)}>Next history</button></div>
    </div>}
    </div></div>
    </div>
  </section>;
}
