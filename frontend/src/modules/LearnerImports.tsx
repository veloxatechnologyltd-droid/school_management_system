import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';

type Props = { schoolId: string; csrfToken: string; role: string; onCommitted: () => Promise<unknown>; inDialog?: boolean };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type ImportClass = { id: string; name: string; year_name: string; start_date: string; end_date: string; capacity: number };
type ImportRow = {
  row_number: number;
  input: { admissionNumber: string; fullName: string; dateOfBirth?: string | null; columnCount: number };
  validation: { issues: string[]; possibleMatches: { id: string; kind: 'learner' | 'admission'; full_name: string; admission_number: string; date_of_birth?: string | null }[]; batchMatches: number[] };
  learner_id: string | null;
  duplicate_review_reason?: string | null;
};
type ImportBatch = {
  id: string; class_id: string; class_name: string; start_date: string; source_name: string; source_digest: string;
  status: 'staged' | 'committed'; version: number; row_count: number; approval_reason?: string | null; approved_by?: string | null; approved_at?: string | null; rows: ImportRow[];
};
type BatchSummary = Pick<ImportBatch, 'id' | 'status' | 'source_name' | 'class_name' | 'start_date' | 'row_count' | 'version'>;

const CSV_HEADER = 'Admission No.,Full Name,Date of Birth';
type DateFormat = '' | 'iso' | 'dmy' | 'mdy';
// A date such as 03/04/2015 is ambiguous, so the school must say how to read it; ISO (2015-04-03) needs no choice.
const looseDate = /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?![\d])/;
function readAs(sample: RegExpExecArray, format: 'dmy' | 'mdy') {
  const [, a, b, year] = sample; const day = format === 'dmy' ? a : b, month = format === 'dmy' ? b : a;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(day)} ${months[Number(month) - 1] ?? '(invalid month)'} ${year}`;
}

export function LearnerImports({ schoolId, csrfToken, role, onCommitted, inDialog = false }: Props) {
  const headteacher = role === 'headteacher';
  const [open, setOpen] = useState(inDialog);
  const [classes, setClasses] = useState<ImportClass[]>([]);
  const [classSearchInput, setClassSearchInput] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [classOffset, setClassOffset] = useState(0);
  const [classTotal, setClassTotal] = useState(0);
  const [classLoading, setClassLoading] = useState(false);
  const [classId, setClassId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' }));
  const [sourceName, setSourceName] = useState('');
  const [csv, setCsv] = useState('');
  const [dateFormat, setDateFormat] = useState<DateFormat>('');
  const [batchRows, setBatchRows] = useState<BatchSummary[]>([]);
  const [batchSearchInput, setBatchSearchInput] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [batchOffset, setBatchOffset] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [validatedBatchId, setValidatedBatchId] = useState('');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<number, string>>({});
  const [approvalReason, setApprovalReason] = useState('');
  const [capacityOverrideReason, setCapacityOverrideReason] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const classesEpoch = useRef(0);
  const batchesEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const fileInput = useRef<HTMLInputElement | null>(null);

  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const existing = operations.current.get(key);
    if (existing?.payload === serialized) return existing.id;
    const next = { payload: serialized, id: crypto.randomUUID() };
    operations.current.set(key, next);
    return next.id;
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; classesEpoch.current++; batchesEpoch.current++; detailEpoch.current++; };
  }, []);

  async function loadClasses(offset = classOffset, search = classSearch) {
    const epoch = ++classesEpoch.current;
    setClassLoading(true);
    const query = new URLSearchParams({ offset: String(offset), limit: '25' });
    if (search.trim()) query.set('search', search.trim());
    try {
      const page = await request<Page<ImportClass>>(`/schools/${schoolId}/learner-imports/classes?${query.toString()}`);
      if (alive.current && classesEpoch.current === epoch) {
        setClasses(page.items); setClassTotal(page.total);
        setClassId(current => current && !page.items.some(row => row.id === current) ? '' : current);
      }
    } catch (e) { if (alive.current && classesEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && classesEpoch.current === epoch) setClassLoading(false); }
  }

  async function loadBatches(offset = batchOffset, search = batchSearch) {
    const epoch = ++batchesEpoch.current;
    setBatchLoading(true);
    const query = new URLSearchParams({ offset: String(offset), limit: '25' });
    if (search.trim()) query.set('search', search.trim());
    try {
      const page = await request<Page<BatchSummary>>(`/schools/${schoolId}/learner-imports?${query.toString()}`);
      if (alive.current && batchesEpoch.current === epoch) { setBatchRows(page.items); setBatchTotal(page.total); }
    } catch (e) { if (alive.current && batchesEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && batchesEpoch.current === epoch) setBatchLoading(false); }
  }

  useEffect(() => {
    if (!open) return;
    void loadClasses(); void loadBatches();
  }, [open, classOffset, classSearch, batchOffset, batchSearch, schoolId]);

  async function selectBatch(id: string) {
    const epoch = ++detailEpoch.current;
    setError(''); setNotice(''); setBatch(null); setValidatedBatchId(''); setSelectedRows([]); setReviewReasons({}); setReviewConfirmed(false);
    if (!id) return;
    try {
      const row = await request<ImportBatch>(`/schools/${schoolId}/learner-imports/${id}`);
      if (alive.current && detailEpoch.current === epoch) { setBatch(row); setApprovalReason(''); setCapacityOverrideReason(''); }
    } catch (e) { if (alive.current && detailEpoch.current === epoch) setError((e as Error).message); }
  }

  async function readCsv(file?: File) {
    setCsv(''); setSourceName(''); setError(''); setNotice(''); setBatch(null);
    if (!file) return;
    if (file.size > 40000) { setError('CSV files must be 40,000 characters or fewer.'); return; }
    try {
      const text = await file.text();
      if (text.length > 40000) throw new Error('CSV files must be 40,000 characters or fewer.');
      const cleanText = text.replace(/^\uFEFF/, '');
      const dataRows = cleanText.trimEnd().split(/\r?\n/).length - 1;
      if (dataRows < 1 || dataRows > 200) throw new Error('CSV must contain between 1 and 200 learner rows.');
      setDateFormat(looseDate.test(cleanText) ? '' : 'iso');
      setCsv(cleanText); setSourceName(file.name);
      if (fileInput.current) fileInput.current.value = '';
    } catch (e) { setError((e as Error).message); }
  }

  async function stage(event: React.FormEvent) {
    event.preventDefault();
    if (!classId || !startDate || !sourceName.trim() || !csv || !dateFormat) return;
    const payload = { sourceName: sourceName.trim(), classId, startDate, csv, dateFormat: dateFormat || 'iso' };
    setBusy(true); setError(''); setNotice('');
    try {
      const key = 'learner-import:stage';
      const result = await request<ImportBatch>(`/schools/${schoolId}/learner-imports`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key, payload) }) });
      operations.current.delete(key);
      if (!alive.current) return;
      setBatch(result); setValidatedBatchId(''); setSelectedRows([]); setReviewReasons({}); setReviewConfirmed(false); setApprovalReason(''); setCapacityOverrideReason('');
      setNotice('CSV staged. Validate it before reviewing rows for import.'); setCsv(''); setSourceName(''); setDateFormat('');
      setBatchOffset(0); await loadBatches(0, batchSearch);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }

  async function validate() {
    if (!batch || batch.status !== 'staged') return;
    const payload = { version: batch.version };
    const key = `learner-import:${batch.id}:validate`;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<ImportBatch>(`/schools/${schoolId}/learner-imports/${batch.id}/validate`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key, payload) }) });
      operations.current.delete(key);
      if (!alive.current) return;
      setBatch(result); setValidatedBatchId(result.id); setSelectedRows([]); setReviewReasons({}); setReviewConfirmed(false); setNotice('Validation refreshed. Review each row before selecting records to import.');
      await loadBatches(batchOffset, batchSearch);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }

  function selectable(row: ImportRow) { return Boolean(batch && validatedBatchId === batch.id && row.validation.issues.length === 0); }
  function needsDuplicateReview(row: ImportRow) { return row.validation.possibleMatches.length > 0 || row.validation.batchMatches.length > 0; }
  function canSelect(row: ImportRow) { return selectable(row) && (!needsDuplicateReview(row) || (reviewReasons[row.row_number]?.trim().length ?? 0) >= 3); }

  async function commit() {
    if (!batch || !headteacher || batch.status !== 'staged') return;
    const rows = batch.rows.filter(row => selectedRows.includes(row.row_number) && canSelect(row));
    if (!rows.length || !approvalReason.trim() || !reviewConfirmed) return;
    const payload = {
      version: batch.version,
      approvalReason: approvalReason.trim(),
      selectedRows: rows.map(row => ({ rowNumber: row.row_number, ...(needsDuplicateReview(row) ? { duplicateReviewReason: reviewReasons[row.row_number].trim() } : {}) })),
      ...(capacityOverrideReason.trim() ? { capacityOverrideReason: capacityOverrideReason.trim() } : {}),
    };
    const key = `learner-import:${batch.id}:commit`;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<ImportBatch>(`/schools/${schoolId}/learner-imports/${batch.id}/commit`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key, payload) }) });
      operations.current.delete(key);
      if (!alive.current) return;
      setBatch(result); setValidatedBatchId(result.id); setSelectedRows([]); setReviewConfirmed(false); setNotice(`Import committed. ${payload.selectedRows.length} learner rows were processed.`);
      setBatchOffset(0); await Promise.all([loadBatches(0, batchSearch), onCommitted()]);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([`${CSV_HEADER}\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'learner-import-template.csv'; link.click(); URL.revokeObjectURL(url);
  }

  const selectableCount = batch?.rows.filter(selectable).length ?? 0;
  const selectedValidCount = batch?.rows.filter(row => selectedRows.includes(row.row_number) && canSelect(row)).length ?? 0;

  return <div className="learner-imports">
    {!inDialog && <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>Import existing learners</button>}
    {open && <div>
      <p className="muted">Stage a CSV, validate identities, review duplicate matches, and approve selected rows. Imports create learners and dated class enrolments only; they do not merge identities or create logins or invoices.</p>
      <div className="actions"><button type="button" className="secondary" onClick={downloadTemplate}>Download CSV header template</button></div>
      <p className="muted">Save your class list from Excel or Google Sheets as CSV. The first row must name the columns, for example <code>{CSV_HEADER}</code> (other names such as “Name”, “Student ID” or “DOB” are recognised, column order does not matter and extra columns are ignored). Date of birth may be blank. Maximum 200 learner rows and 40,000 characters.</p>
      {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}

      <h3>Stage a learner CSV</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); setClassId(''); setClassOffset(0); setClassSearch(classSearchInput.trim()); }}>
        <label>Search import classes<input type="search" maxLength={120} value={classSearchInput} onChange={event => setClassSearchInput(event.target.value)} placeholder="Class name or academic year" /></label>
        <button type="submit" className="secondary" disabled={classLoading}>Search classes</button>
      </form>
      <div className="actions" aria-label="Import class pages"><span>{classTotal === 0 ? '0 classes' : `Showing ${classOffset + 1}–${Math.min(classOffset + classes.length, classTotal)} of ${classTotal} classes`}</span><button type="button" className="secondary" disabled={classLoading || classOffset === 0} onClick={() => { setClassId(''); setClassOffset(Math.max(0, classOffset - 25)); }}>Previous import classes</button><button type="button" className="secondary" disabled={classLoading || classOffset + classes.length >= classTotal} onClick={() => { setClassId(''); setClassOffset(classOffset + 25); }}>Next import classes</button></div>
      <form onSubmit={stage}>
        <label>Target class<select value={classId} disabled={classLoading} onChange={event => setClassId(event.target.value)} required><option value="">Choose a class</option>{classes.map(row => <option key={row.id} value={row.id}>{row.name} · {row.year_name} · Capacity {row.capacity}</option>)}</select></label>
        <label>Enrolment start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required /></label>
        <label>CSV file<input ref={fileInput} type="file" accept=".csv,text/csv" onChange={event => void readCsv(event.target.files?.[0])} required={!csv} /></label>
        {sourceName && <p className="muted">{sourceName} · {csv.length.toLocaleString()} characters</p>}
        {csv && dateFormat !== 'iso' && (() => { const sample = looseDate.exec(csv)!; return <label>How are dates written in this file?<select value={dateFormat} onChange={event => setDateFormat(event.target.value as DateFormat)} required>
          <option value="">Choose how to read {sample[0]}</option><option value="dmy">Day first: {sample[0]} is {readAs(sample, 'dmy')}</option><option value="mdy">Month first: {sample[0]} is {readAs(sample, 'mdy')}</option></select></label>; })()}
        <button disabled={busy || classLoading || !classes.length || !csv || !dateFormat}>{busy ? 'Working…' : 'Stage CSV for validation'}</button>
      </form>

      <h3>Import history</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); setBatchOffset(0); setBatchSearch(batchSearchInput.trim()); }}>
        <label>Search import batches<input type="search" maxLength={120} value={batchSearchInput} onChange={event => setBatchSearchInput(event.target.value)} placeholder="Source file name" /></label>
        <button type="submit" className="secondary" disabled={batchLoading}>Search batches</button>
      </form>
      {batchRows.length ? <ul className="history">{batchRows.map(row => <li key={row.id}>
        <strong>{row.source_name} · {row.class_name}</strong><span>{row.status} · Starts {row.start_date} · {row.row_count} rows</span>
        <button type="button" className="secondary" disabled={batchLoading || busy} onClick={() => void selectBatch(row.id)}>Open import preview</button>
      </li>)}</ul> : <p>{batchSearch ? 'No import batches match this search.' : 'No learner imports staged yet.'}</p>}
      <div className="actions" aria-label="Import batch pages"><button type="button" className="secondary" disabled={batchLoading || batchOffset === 0} onClick={() => setBatchOffset(Math.max(0, batchOffset - 25))}>Previous import batches</button><span>{batchTotal === 0 ? '0 batches' : `Showing ${batchOffset + 1}–${Math.min(batchOffset + batchRows.length, batchTotal)} of ${batchTotal} batches`}</span><button type="button" className="secondary" disabled={batchLoading || batchOffset + batchRows.length >= batchTotal} onClick={() => setBatchOffset(batchOffset + 25)}>Next import batches</button></div>

      {batch && <div>
        <h3>Preview: {batch.source_name}</h3>
        <p className="muted">{batch.class_name} · Starts {batch.start_date} · {batch.row_count} rows · Status: {batch.status} · Version {batch.version}</p>
        <p className="muted">Source digest: {batch.source_digest}</p>
        {batch.status === 'staged' && <button type="button" className="secondary" disabled={busy} onClick={() => void validate()}>Revalidate this preview</button>}
        {batch.status === 'committed' && <div><p>Approval reason: {batch.approval_reason}</p><p>Approved at: {batch.approved_at} · Reviewer membership: {batch.approved_by}</p></div>}
        {batch.rows.length ? <><p>{validatedBatchId === batch.id ? `${selectableCount} rows have no validation issues.` : 'Revalidate this saved preview before selecting any rows.'} Possible identity matches require a reasoned duplicate review before selection.</p><ul className="history">{batch.rows.map(row => {
          const duplicateReview = needsDuplicateReview(row);
          const chosen = selectedRows.includes(row.row_number);
          return <li key={row.row_number}>
            <label><input type="checkbox" checked={chosen} disabled={!headteacher || batch.status !== 'staged' || !canSelect(row)} onChange={event => { setReviewConfirmed(false); setSelectedRows(current => event.target.checked ? [...current, row.row_number] : current.filter(number => number !== row.row_number)); }} /> Row {row.row_number}: {row.input.fullName} · {row.input.admissionNumber}{row.input.dateOfBirth ? ` · Born ${row.input.dateOfBirth}` : ''}</label>
            {row.validation.issues.length > 0 && <span>Validation issues: {row.validation.issues.join('; ')}</span>}
            {duplicateReview && <div><span>Possible identity matches — do not merge automatically:</span>{row.validation.possibleMatches.map(match => <span key={`${match.kind}:${match.id}`}>{match.kind}: {match.full_name} · {match.admission_number}{match.date_of_birth ? ` · Born ${match.date_of_birth}` : ''}</span>)}{row.validation.batchMatches.length > 0 && <span>Matches rows in this CSV: {row.validation.batchMatches.join(', ')}</span>}
              {batch.status === 'committed' ? row.duplicate_review_reason && <span>Duplicate review reason: {row.duplicate_review_reason}</span> : <label>Duplicate review reason for row {row.row_number}<input minLength={3} maxLength={500} value={reviewReasons[row.row_number] ?? ''} disabled={!headteacher} onChange={event => { const reason = event.target.value; setReviewConfirmed(false); setReviewReasons(current => ({ ...current, [row.row_number]: reason })); if (selectedRows.includes(row.row_number) && reason.trim().length < 3) setSelectedRows(current => current.filter(number => number !== row.row_number)); }} /></label>}
            </div>}
            {row.learner_id && <span>Created learner record: {row.learner_id}</span>}
          </li>;
        })}</ul></> : <p>This batch has no parsed rows.</p>}
        {headteacher && batch.status === 'staged' && <div>
          <p>{selectedValidCount} eligible rows selected.</p>
          <label>Import approval reason<input minLength={3} maxLength={500} value={approvalReason} onChange={event => { setReviewConfirmed(false); setApprovalReason(event.target.value); }} /></label>
          <label><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /> I reviewed the validation results and selected learner identities for this import.</label>
          <details><summary>Capacity override (only if required)</summary><label>Reason for exceeding class capacity<input minLength={3} maxLength={500} value={capacityOverrideReason} onChange={event => { setReviewConfirmed(false); setCapacityOverrideReason(event.target.value); }} /></label></details>
          <button type="button" disabled={busy || selectedValidCount === 0 || approvalReason.trim().length < 3 || !reviewConfirmed || selectedRows.some(number => { const row = batch.rows.find(item => item.row_number === number); return Boolean(row && !canSelect(row)); })} onClick={() => void commit()}>{busy ? 'Committing…' : `Commit ${selectedValidCount} selected rows`}</button>
        </div>}
        {batch.status === 'committed' && <p role="status">This import is committed and cannot be changed.</p>}
      </div>}
    </div>}
  </div>;
}
