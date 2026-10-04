import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Term = { id: string; name: string; year_name: string };
type ClassOption = { id: string; name: string; level: string; year_name: string };
type FeeItem = { id: string; name: string; level: string | null; amount_pesewas: number };
type Invoice = { id: string; full_name: string; admission_number: string; class_name: string; total_pesewas: number; paid_pesewas: number; balance_pesewas: number };
type Summary = { invoices: number; billedPesewas: number; collectedPesewas: number; outstandingPesewas: number };
type Receipt = { receipt_number: number; amount_pesewas: number; method: string; reference: string | null; received_on: string; full_name: string; admission_number: string; term_name: string; school_name: string; reversal_reason: string | null };

export const cedis = (pesewas: number) => `GH₵ ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function toPesewas(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter an amount like 450 or 450.50.');
  const [whole, fraction = ''] = text.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function Finance({ schoolId, csrfToken, role, view }: { schoolId: string; csrfToken: string; role: string; view?: 'setup' | 'work' }) {
  const headers = { 'x-csrf-token': csrfToken };
  const [terms, setTerms] = useState<Term[]>([]); const [classes, setClasses] = useState<ClassOption[]>([]);
  const [termId, setTermId] = useState(''); const [classId, setClassId] = useState('');
  const [items, setItems] = useState<FeeItem[]>([]); const [invoices, setInvoices] = useState<Invoice[]>([]); const [summary, setSummary] = useState<Summary | null>(null);
  const [newItem, setNewItem] = useState({ name: '', amount: '', level: '' });
  const [pay, setPay] = useState<{ invoiceId: string; amount: string; method: string; reference: string; receivedOn: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });

  useEffect(() => {
    Promise.all([request<{ items: Term[] }>(`/schools/${schoolId}/finance/terms`), request<{ items: ClassOption[] }>(`/schools/${schoolId}/finance/classes`)])
      .then(([t, c]) => { setTerms(t.items); setClasses(c.items); }).catch(e => setError((e as Error).message));
  }, [schoolId]);
  const load = useCallback(async () => {
    if (!termId) { setItems([]); setInvoices([]); setSummary(null); return; }
    try {
      const [i, inv, s] = await Promise.all([
        request<{ items: FeeItem[] }>(`/schools/${schoolId}/finance/fee-items?termId=${termId}`),
        request<{ items: Invoice[] }>(`/schools/${schoolId}/finance/invoices?termId=${termId}&limit=100${classId ? `&classId=${classId}` : ''}`),
        request<Summary>(`/schools/${schoolId}/finance/summary?termId=${termId}`),
      ]);
      setItems(i.items); setInvoices(inv.items); setSummary(s);
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, termId, classId]);
  useEffect(() => { void load(); }, [load]);

  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const send = <T,>(path: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method: 'POST', headers, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const addItem = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send('/finance/fee-items', { termId, name: newItem.name, amountPesewas: toPesewas(newItem.amount), ...(newItem.level ? { level: newItem.level } : {}) }); setNewItem({ name: '', amount: '', level: '' }); setMessage('Fee item added.'); }); };
  const generate = () => void act(async () => { const r = await send<{ created: number; alreadyInvoiced: number }>('/finance/invoices/generate', { termId, classId }); setMessage(`Created ${r.created} invoice(s); ${r.alreadyInvoiced} already existed.`); });
  const record = (e: FormEvent) => { e.preventDefault(); if (!pay) return; void act(async () => {
    const r = await send<{ id: string; receiptNumber: number }>('/finance/payments', { invoiceId: pay.invoiceId, amountPesewas: toPesewas(pay.amount), method: pay.method, receivedOn: pay.receivedOn, ...(pay.reference.trim() ? { reference: pay.reference } : {}) });
    setPay(null); setMessage(`Payment recorded. Receipt no. ${r.receiptNumber}.`); setReceipt(await request<Receipt>(`/schools/${schoolId}/finance/payments/${r.id}/receipt`));
  }); };

  return <section aria-label="Fees and receipts">
    <h2>{view === 'setup' ? 'Fee items' : 'Fees and receipts'}</h2>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
    {summary && view !== 'setup' && <p>Billed {cedis(summary.billedPesewas)} · collected {cedis(summary.collectedPesewas)} · outstanding <strong>{cedis(summary.outstandingPesewas)}</strong> ({summary.invoices} invoices)</p>}
    {termId && <><h3>Fee items for this term</h3>
      <ul className="history">{items.map(i => <li key={i.id}><strong>{i.name}</strong><span>{cedis(i.amount_pesewas)} · {i.level ?? 'all levels'}</span></li>)}</ul>
      {view !== 'work' && <form onSubmit={addItem}><label>Item name<input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required minLength={2} placeholder="Tuition"/></label>
        <label>Amount (GH₵)<input inputMode="decimal" value={newItem.amount} onChange={e => setNewItem({ ...newItem, amount: e.target.value })} required placeholder="450.00"/></label>
        <label>Applies to<select value={newItem.level} onChange={e => setNewItem({ ...newItem, level: e.target.value })}><option value="">All levels</option>{['Nursery', 'KG', 'Primary', 'JHS'].map(l => <option key={l} value={l}>{l}</option>)}</select></label><button disabled={busy}>Add fee item</button></form>}
      {view !== 'setup' && <><label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">All classes</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
      <button className="secondary" disabled={busy || !classId} onClick={generate}>Generate invoices for this class</button>
      <h3>Invoices</h3>{invoices.length ? <ul className="history">{invoices.map(inv => <li key={inv.id}><strong>{inv.full_name} · {inv.class_name}</strong><span>Total {cedis(inv.total_pesewas)} · paid {cedis(inv.paid_pesewas)} · balance {cedis(inv.balance_pesewas)}</span>
        {inv.balance_pesewas > 0 && <button type="button" className="secondary" onClick={() => setPay({ invoiceId: inv.id, amount: '', method: 'cash', reference: '', receivedOn: today })}>Record payment</button>}
        {pay?.invoiceId === inv.id && <form onSubmit={record}><label>Amount (GH₵)<input inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} required/></label>
          <label>Method<select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank">Bank</option></select></label>
          <label>Reference (optional)<input value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} maxLength={80}/></label>
          <label>Date received<input type="date" value={pay.receivedOn} onChange={e => setPay({ ...pay, receivedOn: e.target.value })} required/></label><button disabled={busy}>Save payment</button></form>}</li>)}</ul> : <p>No invoices yet.</p>}</>}</>}
    {receipt && view !== 'setup' && <div className="print-sheet-inline"><h3>Receipt no. {receipt.receipt_number}</h3><p>{receipt.school_name}<br/>Received from the guardian of {receipt.full_name} ({receipt.admission_number}) for {receipt.term_name}<br/>Amount {cedis(receipt.amount_pesewas)} by {receipt.method.replace('_', ' ')}{receipt.reference ? ` (ref ${receipt.reference})` : ''} on {receipt.received_on}</p>
      <button className="secondary" onClick={() => window.print()}>Print receipt</button> <button className="secondary" onClick={() => setReceipt(null)}>Close</button></div>}
    {role === 'headteacher' && view !== 'setup' && <p className="muted">To correct a wrong payment, a headteacher can reverse it with a reason; nothing is ever deleted.</p>}
  </section>;
}

type Statement = { id: string; term_name: string; total_pesewas: number; paid_pesewas: number; balance_pesewas: number };
export function GuardianStatement({ schoolId }: { schoolId: string }) {
  const [children, setChildren] = useState<{ id: string; full_name: string; billing: boolean }[]>([]);
  const [childId, setChildId] = useState(''); const [rows, setRows] = useState<Statement[]>([]); const [error, setError] = useState('');
  useEffect(() => { request<{ id: string; full_name: string; billing: boolean }[]>(`/schools/${schoolId}/guardian/children`).then(r => setChildren(r.filter(c => c.billing))).catch(e => setError((e as Error).message)); }, [schoolId]);
  useEffect(() => { setRows([]); if (childId) request<{ items: Statement[] }>(`/schools/${schoolId}/guardian/children/${childId}/statement`).then(r => setRows(r.items)).catch(e => setError((e as Error).message)); }, [schoolId, childId]);
  if (!children.length) return null;
  return <section aria-label="School fees statement"><h2>School fees statement</h2>{error && <p role="alert">{error}</p>}
    <label>Child<select value={childId} onChange={e => setChildId(e.target.value)}><option value="">Choose a child</option>{children.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
    {childId && (rows.length ? <ul className="history">{rows.map(r => <li key={r.id}><strong>{r.term_name}</strong><span>Total {cedis(r.total_pesewas)} · paid {cedis(r.paid_pesewas)} · balance {cedis(r.balance_pesewas)}</span></li>)}</ul> : <p>No invoices yet.</p>)}</section>;
}
