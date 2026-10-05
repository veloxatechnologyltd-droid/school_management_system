import { useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Pill } from '../lib/ui';

type Props = { schoolId: string; csrfToken: string; role: string; view?: 'setup' | 'work' };
type Level = 'Nursery' | 'KG';
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type ClassRow = { id: string; name: string; level: Level; year_name: string; start_date: string; end_date: string };
type Descriptor = { id: string; text: string };
type Indicator = { id: string; code: string; title: string; learning_area: string; strand: string; sub_strand: string; descriptors: Descriptor[] };
type Policy = { id: string; level: Level; title: string; source_kind: 'school_local' | 'official_reference_supplied_by_school'; source_issuer: string; source_reference: string; source_version: string; effective_start: string; effective_end: string | null; specialist_name: string | null; specialist_qualification: string | null; specialist_review_reference: string | null; specialist_reviewed_on: string | null; status: string; version: number; indicators: Indicator[] };
type Learner = { id: string; full_name: string; admission_number: string; enrolment_id: string };
type EntryDraft = { status: '' | 'observed' | 'not_observed'; descriptorId: string; evidence: string };
type Observation = { id: string; learner_id: string; class_id: string; enrolment_id: string; level: Level; observed_on: string; educator_membership_id: string; educator_display_name: string; policy_version: number; version: number; supersedes_id: string | null; correction_reason: string | null; is_current: boolean; policy_snapshot: { title?: string; sourceKind?: string; sourceIssuer?: string; sourceReference?: string; sourceVersion?: string; learnerName?: string; className?: string; yearName?: string; indicators?: Array<Pick<Indicator, 'id' | 'code' | 'title' | 'descriptors'>> }; entries: Array<{ indicatorId: string; code: string; title: string; learningArea: string; strand: string; subStrand: string; status: 'observed' | 'not_observed'; descriptor: Descriptor | null; evidence: string | null }>; created_at: string };

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const newDescriptor = (): Descriptor => ({ id: crypto.randomUUID(), text: '' });
const newIndicator = () => ({ code: '', title: '', learningArea: '', strand: '', subStrand: '', descriptors: [newDescriptor()] });

export function EarlyYears({ schoolId, csrfToken, role, view }: Props) {
  const head = role === 'headteacher';
  const [level, setLevel] = useState<Level>('Nursery');
  const [classPage, setClassPage] = useState<Page<ClassRow>>({ items: [], total: 0, offset: 0, limit: 25 });
  const [classSearch, setClassSearch] = useState('');
  const [classSearchDraft, setClassSearchDraft] = useState('');
  const [classId, setClassId] = useState('');
  const [roster, setRoster] = useState<Page<Learner> | null>(null);
  const [rosterOffset, setRosterOffset] = useState(0);
  const [learnerId, setLearnerId] = useState('');
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyId, setPolicyId] = useState('');
  const [observedOn, setObservedOn] = useState(today());
  const [entries, setEntries] = useState<Record<string, EntryDraft>>({});
  const [history, setHistory] = useState<Page<Observation> | null>(null);
  const [historyScope, setHistoryScope] = useState<'learner' | 'class'>('class');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [correctionId, setCorrectionId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionEntries, setCorrectionEntries] = useState<Record<string, EntryDraft>>({});
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [reference, setReference] = useState('');
  const [sourceVersion, setSourceVersion] = useState('');
  const [sourceKind, setSourceKind] = useState<'school_local' | 'official_reference_supplied_by_school'>('school_local');
  const [effectiveStart, setEffectiveStart] = useState('');
  const [effectiveEnd, setEffectiveEnd] = useState('');
  const [specialistName, setSpecialistName] = useState('');
  const [specialistQualification, setSpecialistQualification] = useState('');
  const [specialistReference, setSpecialistReference] = useState('');
  const [specialistReviewedOn, setSpecialistReviewedOn] = useState('');
  const [indicators, setIndicators] = useState([newIndicator()]);
  const [retireReason, setRetireReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [observing, setObserving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operations = useRef(new Map<string, string>());
  const epoch = useRef(0);
  const classRequestEpoch = useRef(0);
  const historyEpoch = useRef(0);
  const contextEpoch = useRef(0);
  const selectedPolicy = policies.find(item => item.id === policyId);
  const observationIndicators = selectedPolicy?.indicators ?? [];
  const indicatorSignature = useMemo(() => observationIndicators.map(item => item.id).join('|'), [observationIndicators]);

  function clearHistory() {
    historyEpoch.current++;
    setHistory(null); setHistoryOffset(0); setHistoryBusy(false);
    setCorrectionId(''); setCorrectionReason(''); setCorrectionEntries({});
  }
  function changeContext() { contextEpoch.current++; classRequestEpoch.current++; clearHistory(); }
  function clearObservationDraft() {
    setEntries(Object.fromEntries(observationIndicators.map(item => [item.id, { status: '', descriptorId: '', evidence: '' }])));
    setError(''); setNotice('');
  }

  useEffect(() => {
    const current = ++epoch.current;
    const classesCurrent = ++classRequestEpoch.current;
    contextEpoch.current++;
    setClassId(''); setRoster(null); setRosterOffset(0); setLearnerId(''); setPolicies([]); setPolicyId('');
    clearHistory(); clearObservationDraft();
    setError(''); setNotice('');
    const query = new URLSearchParams({ level, offset: '0', limit: '25' });
    if (classSearch) query.set('search', classSearch);
    Promise.all([
      request<Page<ClassRow>>(`/schools/${schoolId}/early-years/classes?${query}`),
      request<{ items: Policy[] }>(`/schools/${schoolId}/early-years/policies?level=${level}`),
    ]).then(([classes, policyList]) => {
      if (epoch.current !== current || classRequestEpoch.current !== classesCurrent) return;
      setClassPage(classes); setPolicies(policyList.items); setClassId(view === 'setup' ? '' : classes.items[0]?.id ?? '');
    }).catch(e => { if (epoch.current === current && classRequestEpoch.current === classesCurrent) setError((e as Error).message); });
    return () => { if (epoch.current === current) epoch.current++; if (classRequestEpoch.current === classesCurrent) classRequestEpoch.current++; };
  }, [schoolId, level, classSearch]);

  useEffect(() => {
    const effective = policies.find(item => item.status === 'approved' && item.effective_start <= observedOn && (!item.effective_end || item.effective_end > observedOn));
    setPolicyId(current => current && effective && policies.some(item => item.id === current && item.status === 'approved' && item.effective_start <= observedOn && (!item.effective_end || item.effective_end > observedOn)) ? current : effective?.id ?? '');
  }, [policies, observedOn]);

  useEffect(() => {
    setEntries(Object.fromEntries(observationIndicators.map(item => [item.id, { status: '', descriptorId: '', evidence: '' }])));
  }, [indicatorSignature]);

  useEffect(() => {
    let live = true;
    contextEpoch.current++;
    setRoster(null); setLearnerId(''); clearHistory(); clearObservationDraft();
    if (!classId) return;
    const query = new URLSearchParams({ date: observedOn, offset: String(rosterOffset), limit: '50' });
    request<Page<Learner>>(`/schools/${schoolId}/teaching/classes/${classId}/roster?${query}`).then(data => { if (live) { setRoster(data); if (view !== 'setup') void loadHistory('class', classId, 0); } }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [schoolId, classId, observedOn, rosterOffset]);

  const operationId = (key: string) => {
    const existing = operations.current.get(key); if (existing) return existing;
    const id = crypto.randomUUID(); operations.current.set(key, id); return id;
  };
  async function post<T>(path: string, payload: Record<string, unknown>, key: string): Promise<T> {
    const result = await request<T>(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key) }) });
    operations.current.delete(key); return result;
  }
  async function loadClasses(offset = 0, search = classSearch) {
    const current = ++classRequestEpoch.current;
    const requestedLevel = level;
    setError('');
    const query = new URLSearchParams({ level, offset: String(offset), limit: '25' }); if (search) query.set('search', search);
    try { const result = await request<Page<ClassRow>>(`/schools/${schoolId}/early-years/classes?${query}`); if (classRequestEpoch.current !== current || level !== requestedLevel) return; setClassPage(result); if (classId && !result.items.some(item => item.id === classId)) { setClassId(''); setRoster(null); setLearnerId(''); changeContext(); clearObservationDraft(); } }
    catch (e) { if (classRequestEpoch.current === current && level === requestedLevel) setError((e as Error).message); }
  }
  async function reloadPolicies() {
    const result = await request<{ items: Policy[] }>(`/schools/${schoolId}/early-years/policies?level=${level}`);
    setPolicies(result.items);
    if (policyId && !result.items.some(item => item.id === policyId)) setPolicyId('');
  }
  async function savePolicy(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const payload = { level, title: title.trim(), sourceKind, sourceIssuer: issuer.trim(), sourceReference: reference.trim(), sourceVersion: sourceVersion.trim(), effectiveStart, ...(effectiveEnd ? { effectiveEnd } : {}), ...(level === 'Nursery' ? { specialistName: specialistName.trim(), specialistQualification: specialistQualification.trim(), specialistReviewReference: specialistReference.trim(), specialistReviewedOn } : {}), indicators: indicators.map(row => ({ ...row, code: row.code.trim(), title: row.title.trim(), learningArea: row.learningArea.trim(), strand: row.strand.trim(), subStrand: row.subStrand.trim(), descriptors: row.descriptors.map(item => ({ ...item, text: item.text.trim() })) })) };
    const key = `policy:${JSON.stringify(payload)}`;
    try { await post(`/schools/${schoolId}/early-years/policies`, payload, key); setNotice('Policy draft saved. Review and approve it before recording observations.'); setTitle(''); setSourceKind('school_local'); setIssuer(''); setReference(''); setSourceVersion(''); setEffectiveStart(''); setEffectiveEnd(''); setSpecialistName(''); setSpecialistQualification(''); setSpecialistReference(''); setSpecialistReviewedOn(''); setIndicators([newIndicator()]); await reloadPolicies(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function transition(policy: Policy, action: 'approve' | 'retire') {
    const reason = retireReason[policy.id]?.trim() ?? '';
    setBusy(true); setError(''); setNotice('');
    try { await post(`/schools/${schoolId}/early-years/policies/${policy.id}/${action}`, { version: policy.version, ...(action === 'retire' ? { reason } : {}) }, `policy:${policy.id}:${action}:${policy.version}:${reason}`); setNotice(action === 'approve' ? 'Policy approved.' : 'Policy retired.'); setRetireReason(current => ({ ...current, [policy.id]: '' })); await reloadPolicies(); }
    catch (e) { setError((e as Error).message); await reloadPolicies().catch(() => undefined); } finally { setBusy(false); }
  }
  async function recordObservation(event: React.FormEvent) {
    event.preventDefault(); if (!classId || !learnerId || !selectedPolicy || !roster) return;
    const selectedLearner = roster.items.find(item => item.id === learnerId); if (!selectedLearner) { setError('Reload the class roster and select a current learner.'); return; }
    const chosen = observationIndicators.flatMap(item => {
      const entry = entries[item.id]; if (!entry?.status) return [];
      return [{ indicatorId: item.id, status: entry.status, ...(entry.status === 'observed' ? { descriptorId: entry.descriptorId, evidence: entry.evidence?.trim() ?? '' } : {}) }];
    });
    if (!chosen.length || chosen.some(row => row.status === 'observed' && (!row.descriptorId || !row.evidence || row.evidence.length < 3))) { setError('For each observed indicator, choose one descriptor and enter factual evidence. Select at least one indicator.'); return; }
    setBusy(true); setError(''); setNotice('');
    const payload = { learnerId, enrolmentId: selectedLearner.enrolment_id, observedOn, policyId: selectedPolicy.id, entries: chosen };
    const currentContext = contextEpoch.current;
    try { await post(`/schools/${schoolId}/early-years/classes/${classId}/observations`, payload, `observation:${JSON.stringify(payload)}`); if (contextEpoch.current !== currentContext) return; setNotice('Observation recorded.'); setObserving(false); setEntries(Object.fromEntries(observationIndicators.map(item => [item.id, { status: '', descriptorId: '', evidence: '' }]))); await loadHistory('learner', learnerId, 0); }
    catch (e) { if (contextEpoch.current === currentContext) setError((e as Error).message); } finally { setBusy(false); }
  }
  function beginCorrection(item: Observation) {
    setCorrectionId(item.id); setCorrectionReason('');
    setCorrectionEntries(Object.fromEntries(item.entries.map(entry => [entry.indicatorId, { status: entry.status, descriptorId: entry.descriptor?.id ?? '', evidence: entry.evidence ?? '' }])));
    setError('');
  }
  async function correctObservation(event: React.FormEvent, item: Observation) {
    event.preventDefault();
    const reason = correctionReason.trim();
    const correctedEntries = item.entries.map(entry => {
      const draft = correctionEntries[entry.indicatorId];
      return { indicatorId: entry.indicatorId, status: draft.status, ...(draft.status === 'observed' ? { descriptorId: draft.descriptorId, evidence: draft.evidence.trim() } : {}) };
    });
    if (reason.length < 3 || correctedEntries.length === 0 || correctedEntries.some(entry => !entry.status || entry.status === 'observed' && (!entry.descriptorId || !entry.evidence || entry.evidence.length < 3))) {
      setError('Add a correction reason and complete each existing indicator entry. Observed entries need a source descriptor and factual evidence.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    const currentContext = contextEpoch.current;
    try {
      await post(`/schools/${schoolId}/early-years/observations/${item.id}/correct`, { version: item.version, correctionReason: reason, entries: correctedEntries }, `correction:${item.id}:${item.version}:${JSON.stringify({ reason, entries: correctedEntries })}`);
      if (contextEpoch.current !== currentContext) return;
      setNotice('Observation correction saved. The prior version remains in history.');
      setCorrectionId(''); setCorrectionReason(''); setCorrectionEntries({});
      const selectedId = historyScope === 'learner' ? learnerId : classId;
      await loadHistory(historyScope, selectedId, 0);
    } catch (e) { if (contextEpoch.current === currentContext) { await loadHistory(historyScope, undefined, historyOffset); setError((e as Error).message); } }
    finally { setBusy(false); }
  }
  async function loadHistory(scope = historyScope, id?: string, offset = historyOffset) {
    const selectedId = id ?? (scope === 'learner' ? learnerId : classId);
    if (!selectedId) { setError(scope === 'learner' ? 'Select a learner to inspect history.' : 'Select a class to inspect history.'); return; }
    const query = new URLSearchParams({ [scope === 'learner' ? 'learnerId' : 'classId']: selectedId, offset: String(offset), limit: '25' });
    const current = ++historyEpoch.current;
    setHistoryBusy(true); setError(''); setCorrectionId(''); setCorrectionReason(''); setCorrectionEntries({});
    try { const result = await request<Page<Observation>>(`/schools/${schoolId}/early-years/observations?${query}`); if (historyEpoch.current !== current) return; setHistory(result); setHistoryScope(scope); setHistoryOffset(offset); }
    catch (e) { if (historyEpoch.current === current) setError((e as Error).message); } finally { if (historyEpoch.current === current) setHistoryBusy(false); }
  }

  const historyList = history && <>{history.items.length ? <ul className="history">{history.items.map(item => <li key={item.id}><strong>{item.policy_snapshot.learnerName ?? item.learner_id} · {item.observed_on}</strong><span>{item.is_current ? 'Current version' : 'Superseded by a later correction'} · Version {item.version}</span><span>{item.policy_snapshot.className ?? ''} · {item.educator_display_name} · {item.policy_snapshot.title} ({item.policy_snapshot.sourceIssuer} {item.policy_snapshot.sourceVersion})</span>{item.correction_reason && <span>Correction reason: {item.correction_reason}</span>}{item.policy_snapshot.sourceKind === 'official_reference_supplied_by_school' && <span>Official reference supplied by the school; not independently verified.</span>}<span>{item.entries.map(entry => `${entry.code} ${entry.status}${entry.descriptor ? `: ${entry.descriptor.text}` : ''}${entry.evidence ? ` — ${entry.evidence}` : ''}`).join(' · ')}</span>{item.is_current && <><button type="button" className="secondary" disabled={busy || historyBusy} onClick={() => beginCorrection(item)}>Correct this observation</button>{correctionId === item.id && <form onSubmit={event => void correctObservation(event, item)}><p className="muted">Corrections keep this version in the history. Teachers can correct only their own observation when they still have a valid class grant; the server checks access.</p>{item.entries.map(entry => { const draft = correctionEntries[entry.indicatorId] ?? { status: entry.status, descriptorId: entry.descriptor?.id ?? '', evidence: entry.evidence ?? '' }; const descriptors = item.policy_snapshot.indicators?.find(indicator => indicator.id === entry.indicatorId)?.descriptors ?? []; return <fieldset key={entry.indicatorId}><legend>{entry.code} · {entry.title}</legend><label>Observation<select value={draft.status} onChange={e => setCorrectionEntries(current => ({ ...current, [entry.indicatorId]: { ...draft, status: e.target.value as EntryDraft['status'], ...(e.target.value === 'not_observed' ? { descriptorId: '', evidence: '' } : {}) } }))}><option value="">Choose status</option><option value="observed">Observed</option><option value="not_observed">Not observed</option></select></label>{draft.status === 'observed' && <><label>Descriptor<select required value={draft.descriptorId} onChange={e => setCorrectionEntries(current => ({ ...current, [entry.indicatorId]: { ...draft, descriptorId: e.target.value } }))}><option value="">Choose a source descriptor</option>{descriptors.map(descriptor => <option key={descriptor.id} value={descriptor.id}>{descriptor.text}</option>)}</select></label><label>Factual evidence<textarea required minLength={3} maxLength={500} value={draft.evidence} onChange={e => setCorrectionEntries(current => ({ ...current, [entry.indicatorId]: { ...draft, evidence: e.target.value } }))} /></label></>}</fieldset>; })}<label>Correction reason<textarea required minLength={3} maxLength={500} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} /></label><div className="actions"><button disabled={busy || correctionReason.trim().length < 3}>Save correction</button><button type="button" className="secondary" disabled={busy} onClick={() => { setCorrectionId(''); setCorrectionReason(''); setCorrectionEntries({}); }}>Cancel</button></div></form>}</>}</li>)}</ul> : <Empty title="No observations recorded yet" hint={historyScope === 'class' ? 'Record one from the class roster.' : undefined}/>}
    <div className="pager"><span>{history.total} record(s)</span><div><button type="button" className="secondary" disabled={busy || historyOffset === 0 || historyBusy} onClick={() => void loadHistory(historyScope, undefined, Math.max(0, historyOffset - 25))}>Previous history</button><button type="button" className="secondary" disabled={busy || !history || historyOffset + history.limit >= history.total || historyBusy} onClick={() => void loadHistory(historyScope, undefined, historyOffset + 25)}>More history</button></div></div></>;
  const historyLearner = historyScope === 'learner' && roster?.items.find(item => item.id === learnerId);
  const observingLearner = roster?.items.find(item => item.id === learnerId);

  if (view !== 'setup') return <section aria-labelledby="early-years-title" className="page">
    <h2 id="early-years-title" className="sr-only">Early years observations</h2>
    {!observing && <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>}
    <Card flush>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Early years level">{(['Nursery', 'KG'] as Level[]).map(item => <button type="button" key={item} disabled={busy} aria-pressed={level === item} onClick={() => { changeContext(); clearObservationDraft(); setLevel(item); }}>{item}</button>)}</div>
        <label>Class<select value={classId} disabled={busy} onChange={e => { setClassId(e.target.value); setRosterOffset(0); setLearnerId(''); changeContext(); clearObservationDraft(); }}><option value="">Choose class</option>{classPage.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.year_name}</option>)}</select></label>
        <label>Observed on<input type="date" value={observedOn} disabled={busy} max={today()} onChange={e => { setObservedOn(e.target.value); setLearnerId(''); setPolicyId(''); changeContext(); clearObservationDraft(); }} /></label>
        {classPage.total > classPage.limit && <form onSubmit={e => { e.preventDefault(); setClassSearch(classSearchDraft.trim()); setClassId(''); setRoster(null); setRosterOffset(0); setLearnerId(''); changeContext(); clearObservationDraft(); }}><label className="search"><span className="sr-only">Find a {level} class</span><input type="search" aria-label={`Find a ${level} class`} value={classSearchDraft} disabled={busy} onChange={e => setClassSearchDraft(e.target.value)} placeholder={`Find a ${level} class`}/></label><button className="secondary" disabled={busy}>Search</button><button type="button" className="secondary" disabled={busy || classPage.offset === 0} onClick={() => void loadClasses(Math.max(0, classPage.offset - classPage.limit))}>Previous classes</button><button type="button" className="secondary" disabled={busy || classPage.offset + classPage.limit >= classPage.total} onClick={() => void loadClasses(classPage.offset + classPage.limit)}>More classes</button></form>}
      </div>
      <div className="policy-line">{selectedPolicy ? <><Pill tone="positive">Policy</Pill><span>{selectedPolicy.title} · {selectedPolicy.source_issuer} {selectedPolicy.source_version} · effective {selectedPolicy.effective_start}{selectedPolicy.effective_end ? ` to ${selectedPolicy.effective_end}` : ''}</span></> : <><Pill tone="caution">No policy</Pill><span>An approved {level} policy effective on {observedOn} is needed before observations can be recorded. The headteacher adds it in Settings.</span></>}</div>
      {selectedPolicy?.source_kind === 'official_reference_supplied_by_school' && <p className="muted">The official reference was supplied by the school; this system does not independently verify it.</p>}
      {level === 'Nursery' && selectedPolicy?.specialist_name && <p className="muted">School-supplied specialist review: {selectedPolicy.specialist_name}, {selectedPolicy.specialist_qualification}; reference {selectedPolicy.specialist_review_reference}, dated {selectedPolicy.specialist_reviewed_on}. Not system-verified.</p>}
    </Card>
    {!classPage.items.length ? <Card><Empty title={`No ${level} classes`} hint="Classes appear here when the school has them and you are assigned to them."/></Card> : !classId ? <Card><Empty title="Choose a class"/></Card> : <div className="columns">
      <Card title="Class roster" hint={roster ? `${roster.total} learner(s) on ${observedOn}` : 'Loading…'} flush>
        {roster?.items.length ? <div className="table-wrap"><table><tbody>{roster.items.map(item => <tr key={item.id} className={item.id === learnerId ? 'selected' : undefined}>
          <td>{item.full_name}<span className="sub">{item.admission_number}</span></td>
          <td className="num"><div className="row-actions"><button type="button" className="secondary" disabled={busy || historyBusy} aria-label={`History for ${item.full_name}`} onClick={() => { setLearnerId(item.id); void loadHistory('learner', item.id, 0); }}>History</button><button type="button" disabled={busy || !selectedPolicy} aria-label={`Observe ${item.full_name}`} onClick={() => { setLearnerId(item.id); changeContext(); clearObservationDraft(); setObserving(true); }}>Observe</button></div></td>
        </tr>)}</tbody></table></div> : roster && <Empty title="No learners in this class on that date"/>}
        {roster && roster.total > roster.limit && <div className="pager"><span>Showing {roster.offset + 1}–{Math.min(roster.offset + roster.limit, roster.total)} of {roster.total}</span><div><button type="button" className="secondary" disabled={busy || roster.offset === 0} onClick={() => { setLearnerId(''); changeContext(); setRosterOffset(Math.max(0, rosterOffset - 50)); }}>Previous learners</button><button type="button" className="secondary" disabled={busy || rosterOffset + roster.limit >= roster.total} onClick={() => { setLearnerId(''); changeContext(); setRosterOffset(rosterOffset + 50); }}>More learners</button></div></div>}
      </Card>
      <Card title={historyLearner ? `Observations · ${historyLearner.full_name}` : 'Recent class observations'} hint="Newest first. Corrections keep every earlier version." action={historyScope === 'learner' && <button type="button" className="secondary" disabled={busy || historyBusy} onClick={() => void loadHistory('class', classId, 0)}>View class history</button>} flush>
        {historyBusy && !history ? <p role="status">Loading observations…</p> : historyList}
      </Card>
    </div>}
    {observing && observingLearner && selectedPolicy && <Dialog title={`Observation · ${observingLearner.full_name}`} wide onClose={() => setObserving(false)}>
      {error && <p role="alert">{error}</p>}
      <p className="muted">{observedOn} · {selectedPolicy.title}. Record only what you saw; leave an indicator as “Not recorded” if you did not observe it.</p>
      <form onSubmit={recordObservation}>
        {observationIndicators.map(item => { const entry = entries[item.id] ?? { status: '', descriptorId: '', evidence: '' }; return <fieldset key={item.id}><legend>{item.code} · {item.title}</legend><p className="muted">{item.learning_area} · {item.strand} / {item.sub_strand}</p><label>Observation<select value={entry.status} onChange={e => setEntries(current => ({ ...current, [item.id]: { ...entry, status: e.target.value as EntryDraft['status'] } }))}><option value="">Not recorded</option><option value="observed">Observed</option><option value="not_observed">Not observed</option></select></label>{entry.status === 'observed' && <><label>Descriptor<select required value={entry.descriptorId} onChange={e => setEntries(current => ({ ...current, [item.id]: { ...entry, descriptorId: e.target.value } }))}><option value="">Choose a source descriptor</option>{item.descriptors.map(descriptor => <option key={descriptor.id} value={descriptor.id}>{descriptor.text}</option>)}</select></label><label>Factual evidence<textarea required minLength={3} maxLength={500} value={entry.evidence} onChange={e => setEntries(current => ({ ...current, [item.id]: { ...entry, evidence: e.target.value } }))} /></label></>}</fieldset>; })}
        <div className="actions"><button disabled={busy || !learnerId || !selectedPolicy || !observedOn || !observationIndicators.length}>Record observation</button><button type="button" className="secondary" onClick={() => setObserving(false)}>Cancel</button></div>
      </form>
    </Dialog>}
  </section>;

  return <section aria-labelledby="early-years-title">
    <h2 id="early-years-title">Early years policies</h2>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    <div className="actions" role="group" aria-label="Early years level">
      {(['Nursery', 'KG'] as Level[]).map(item => <button type="button" className={level === item ? '' : 'secondary'} key={item} disabled={busy} aria-pressed={level === item} onClick={() => { changeContext(); clearObservationDraft(); setLevel(item); }}>{item}</button>)}
    </div>
    {head && <>
      <h3>School policy configuration · {level}</h3><p className="muted">Enter the school’s own curriculum source and indicators. This screen does not supply or assert official curriculum content.</p>
      <form onSubmit={savePolicy}>
        <div className="actions"><label>Policy title<input value={title} minLength={3} maxLength={120} required onChange={e => setTitle(e.target.value)} /></label><label>Source type<select value={sourceKind} onChange={e => setSourceKind(e.target.value as typeof sourceKind)}><option value="school_local">School-local content</option><option value="official_reference_supplied_by_school">Official reference supplied by the school (not independently verified)</option></select></label><label>Source issuer<input value={issuer} minLength={3} maxLength={120} required onChange={e => setIssuer(e.target.value)} /></label><label>{sourceKind === 'school_local' ? 'School source reference' : 'Reference supplied by the school'}<input value={reference} minLength={3} maxLength={500} required onChange={e => setReference(e.target.value)} /></label><label>Source version<input value={sourceVersion} minLength={1} maxLength={80} required onChange={e => setSourceVersion(e.target.value)} /></label><label>Effective from<input type="date" value={effectiveStart} required onChange={e => setEffectiveStart(e.target.value)} /></label><label>Effective until (optional)<input type="date" value={effectiveEnd} onChange={e => setEffectiveEnd(e.target.value)} /></label></div>
        {sourceKind === 'official_reference_supplied_by_school' && <p className="muted">This is a reference the school supplied. The system does not independently verify its official status or content.</p>}
        {level === 'Nursery' && <fieldset><legend>School-supplied specialist review evidence</legend><p className="muted">These references are recorded as supplied by the school; they are not verified by this system.</p><div className="actions"><label>Specialist name<input value={specialistName} minLength={3} maxLength={120} required onChange={e => setSpecialistName(e.target.value)} /></label><label>Qualification<input value={specialistQualification} minLength={3} maxLength={300} required onChange={e => setSpecialistQualification(e.target.value)} /></label><label>Review reference<input value={specialistReference} minLength={3} maxLength={500} required onChange={e => setSpecialistReference(e.target.value)} /></label><label>Reviewed on<input type="date" value={specialistReviewedOn} required onChange={e => setSpecialistReviewedOn(e.target.value)} /></label></div></fieldset>}
        <h4>Indicators supplied by the school</h4>
        {indicators.map((item, index) => <fieldset key={index}><legend>Indicator {index + 1}</legend><div className="actions"><label>Code<input value={item.code} required maxLength={40} onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, code: e.target.value } : row))} /></label><label>Title<input value={item.title} minLength={3} maxLength={160} required onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, title: e.target.value } : row))} /></label><label>Learning area<input value={item.learningArea} minLength={2} maxLength={120} required onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, learningArea: e.target.value } : row))} /></label><label>Strand<input value={item.strand} minLength={2} maxLength={160} required onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, strand: e.target.value } : row))} /></label><label>Sub-strand<input value={item.subStrand} minLength={2} maxLength={160} required onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, subStrand: e.target.value } : row))} /></label></div>{item.descriptors.map((descriptor, descriptorIndex) => <div className="actions" key={descriptor.id}><label>Descriptor {descriptorIndex + 1}<input value={descriptor.text} minLength={3} maxLength={240} required onChange={e => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, descriptors: row.descriptors.map((entry, j) => j === descriptorIndex ? { ...entry, text: e.target.value } : entry) } : row))} /></label><button type="button" className="secondary" disabled={item.descriptors.length <= 1} onClick={() => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, descriptors: row.descriptors.filter((_, j) => j !== descriptorIndex) } : row))}>Remove descriptor</button></div>)}<button type="button" className="secondary" onClick={() => setIndicators(rows => rows.map((row, i) => i === index ? { ...row, descriptors: [...row.descriptors, newDescriptor()] } : row))}>Add descriptor</button><button type="button" className="secondary" disabled={indicators.length <= 1} onClick={() => setIndicators(rows => rows.filter((_, i) => i !== index))}>Remove indicator</button></fieldset>)}
        <details open><summary>Preview school-entered indicators and descriptor text</summary><ol>{indicators.map((item, index) => <li key={index}><strong>{item.code || 'Code not entered'} · {item.title || 'Title not entered'}</strong><span>{[item.learningArea, item.strand, item.subStrand].filter(Boolean).join(' · ')}</span><ul>{item.descriptors.map(descriptor => <li key={descriptor.id}>{descriptor.text || 'Descriptor text not entered'}</li>)}</ul></li>)}</ol></details>
        <button type="button" className="secondary" disabled={indicators.length >= 40} onClick={() => setIndicators(rows => [...rows, newIndicator()])}>Add indicator</button><button disabled={busy || indicators.length === 0}>Save policy draft</button>
      </form>
      <h3>Policy history · {level}</h3>
      {policies.length ? <ul className="history">{policies.map(policy => <li key={policy.id}><strong>{policy.title} · {policy.status} · version {policy.version}</strong><span>{policy.source_issuer} · {policy.source_reference} · {policy.source_version} · {policy.effective_start}{policy.effective_end ? ` to ${policy.effective_end}` : ''} · {policy.indicators.length} indicators</span>{policy.source_kind === 'official_reference_supplied_by_school' && <span>Official reference supplied by the school; not independently verified by this system.</span>}{policy.specialist_name && <span>School-supplied Nursery specialist evidence: {policy.specialist_name}, {policy.specialist_qualification}; {policy.specialist_review_reference}, {policy.specialist_reviewed_on}. Not system-verified.</span>}<details open={policy.status === 'draft'}><summary>Review indicators and rubric descriptors before approval</summary><ol>{policy.indicators.map(indicator => <li key={indicator.id}><strong>{indicator.code} · {indicator.title}</strong><span>{indicator.learning_area} · {indicator.strand} / {indicator.sub_strand}</span><ul>{indicator.descriptors.map(descriptor => <li key={descriptor.id}>{descriptor.text}</li>)}</ul></li>)}</ol></details>{policy.status === 'draft' && <button type="button" className="secondary" disabled={busy} onClick={() => void transition(policy, 'approve')}>Approve policy</button>}{policy.status === 'approved' && <div className="actions"><label>Retirement reason<input minLength={3} maxLength={500} value={retireReason[policy.id] ?? ''} onChange={e => setRetireReason(current => ({ ...current, [policy.id]: e.target.value }))} /></label><button type="button" className="secondary" disabled={busy || (retireReason[policy.id]?.trim().length ?? 0) < 3} onClick={() => void transition(policy, 'retire')}>Retire policy</button></div>}</li>)}</ul> : <p>No school policies recorded for {level}.</p>}
    </>}
  </section>;
}
