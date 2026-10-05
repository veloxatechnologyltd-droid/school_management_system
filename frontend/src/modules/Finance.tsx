import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, currentTerm } from '../lib/ui';

type Term = { id: string; name: string; year_name: string; start_date?: string; end_date?: string };
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
      .then(([t, c]) => { setTerms(t.items); setClasses(c.items); const term = currentTerm(t.items); if (term) setTermId(prior => prior || term.id); }).catch(e => setError((e as Error).message));
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

  const termPicker = <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>;
  const itemList = items.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Applies to</th><th className="num">Amount</th></tr></thead><tbody>{items.map(i => <tr key={i.id}><td>{i.name}</td><td>{i.level ?? 'All levels'}</td><td className="num">{cedis(i.amount_pesewas)}</td></tr>)}</tbody></table></div> : <Empty title="No fee items for this term"/>;
  const messages = <>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</>;

  if (view === 'setup') return <section aria-label="Fees and receipts" className="page">
    {messages}
    <Card title="Fee items" hint="What each learner is billed for in a term." action={termPicker} flush>
      {!terms.length ? <Empty title="No terms yet" hint="Add terms under Subjects, terms & grading first."/> : termId && <>{itemList}
        <form onSubmit={addItem} className="card-body"><h4>Add a fee item</h4><div className="grid"><label>Item name<input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required minLength={2} placeholder="Tuition"/></label>
          <label>Amount (GH₵)<input inputMode="decimal" value={newItem.amount} onChange={e => setNewItem({ ...newItem, amount: e.target.value })} required placeholder="450.00"/></label>
          <label>Applies to<select value={newItem.level} onChange={e => setNewItem({ ...newItem, level: e.target.value })}><option value="">All levels</option>{['Nursery', 'KG', 'Primary', 'JHS'].map(l => <option key={l} value={l}>{l}</option>)}</select></label></div><button disabled={busy}>Add fee item</button></form></>}
    </Card>
  </section>;

  const paidShare = summary && summary.billedPesewas ? Math.round(summary.collectedPesewas / summary.billedPesewas * 100) : 0;
  const payingFor = pay && invoices.find(inv => inv.id === pay.invoiceId);
  return <section aria-label="Fees and receipts" className="page">
    <PageHeader eyebrow="Money" title="Fees" blurb="Bills, payments and receipts for each term. Nothing is ever deleted." actions={termPicker}/>
    {!pay && !receipt && messages}
    {!terms.length ? <Card><Empty title="No terms yet" hint="The headteacher adds terms and fee items in Settings."/></Card> : !termId ? <Card><Empty title="Choose a term"/></Card> : <>
      {summary && <div className="stats">
        <Stat label="Billed" value={cedis(summary.billedPesewas)} caption={`${summary.invoices} invoices`} icon="request_quote"/>
        <Stat label="Collected" value={cedis(summary.collectedPesewas)} caption={`${paidShare}% of what was billed`} tone="positive" icon="payments"/>
        <Stat label="Outstanding" value={cedis(summary.outstandingPesewas)} caption="Still owed this term" tone={summary.outstandingPesewas ? 'critical' : 'neutral'} icon="pending_actions"/>
      </div>}
      <div>
        <Card flush>
          <div className="toolbar">
            <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">All classes</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
            <button className="secondary" disabled={busy || !classId} onClick={generate}>Generate invoices for this class</button>
            <span className="count">{invoices.length === 100 ? 'First 100 invoices · choose a class to see all' : `${invoices.length} invoices`}</span>
          </div>
          {invoices.length ? <div className="table-wrap"><table><thead><tr><th>Learner</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance</th><th></th></tr></thead><tbody>{invoices.map(inv => <tr key={inv.id}>
            <td>{inv.full_name}<span className="sub">{inv.admission_number} · {inv.class_name}</span></td>
            <td className="num">{cedis(inv.total_pesewas)}</td><td className="num">{cedis(inv.paid_pesewas)}</td>
            <td className="num">{inv.balance_pesewas > 0 ? <strong className="tone-critical">{cedis(inv.balance_pesewas)}</strong> : <Pill tone="positive">Settled</Pill>}</td>
            <td className="num">{inv.balance_pesewas > 0 && <button type="button" className="secondary" onClick={() => { setError(''); setMessage(''); setPay({ invoiceId: inv.id, amount: '', method: 'cash', reference: '', receivedOn: today }); }}>Record payment</button>}</td>
          </tr>)}</tbody></table></div> : <Empty title="No invoices yet" hint={classId ? 'Generate this class’s invoices from the fee items.' : 'Choose a class, then generate its invoices.'}/>}
        </Card>
        <Card title="Fee items" hint="Set by the headteacher in Settings." flush>{itemList}</Card>
        {role === 'headteacher' && <p className="muted">To correct a wrong payment, a headteacher can reverse it with a reason; nothing is ever deleted.</p>}
      </div>
    </>}
    {pay && <Dialog title={payingFor ? `Payment from ${payingFor.full_name}` : 'Record payment'} onClose={() => setPay(null)}>
      {messages}
      {payingFor && <p className="muted">Balance {cedis(payingFor.balance_pesewas)} · {payingFor.class_name}</p>}
      <form onSubmit={record}><div className="grid"><label>Amount (GH₵)<input inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} required/></label>
        <label>Method<select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank">Bank</option></select></label>
        <label>Reference (optional)<input value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} maxLength={80}/></label>
        <label>Date received<input type="date" value={pay.receivedOn} onChange={e => setPay({ ...pay, receivedOn: e.target.value })} required/></label></div>
        <div className="actions"><button disabled={busy}>Save payment</button><button type="button" className="secondary" onClick={() => setPay(null)}>Cancel</button></div></form>
    </Dialog>}
    {receipt && <Dialog title={`Receipt no. ${receipt.receipt_number}`} onClose={() => setReceipt(null)}>
      {messages}
      <div className="receipt"><h3>Receipt no. {receipt.receipt_number}</h3><p>{receipt.school_name}<br/>Received from the guardian of {receipt.full_name} ({receipt.admission_number}) for {receipt.term_name}<br/>Amount <strong>{cedis(receipt.amount_pesewas)}</strong> by {receipt.method.replace('_', ' ')}{receipt.reference ? ` (ref ${receipt.reference})` : ''} on {receipt.received_on}</p></div>
      <div className="actions"><button onClick={() => window.print()}><Icon name="print"/>Print receipt</button><button className="secondary" onClick={() => setReceipt(null)}>Close</button></div>
    </Dialog>}
  </section>;
}

type Statement = { id: string; term_name: string; total_pesewas: number; paid_pesewas: number; balance_pesewas: number };
export function GuardianStatement({ schoolId }: { schoolId: string }) {
  const [children, setChildren] = useState<{ id: string; full_name: string; billing: boolean }[]>([]);
  const [childId, setChildId] = useState(''); const [rows, setRows] = useState<Statement[]>([]); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  useEffect(() => { request<{ id: string; full_name: string; billing: boolean }[]>(`/schools/${schoolId}/guardian/children`).then(r => { const billing = r.filter(c => c.billing); setChildren(billing); setChildId(prior => prior || billing[0]?.id || ''); }).catch(e => setError((e as Error).message)).finally(() => setLoaded(true)); }, [schoolId]);
  useEffect(() => { setRows([]); if (childId) request<{ items: Statement[] }>(`/schools/${schoolId}/guardian/children/${childId}/statement`).then(r => setRows(r.items)).catch(e => setError((e as Error).message)); }, [schoolId, childId]);
  const totals = rows.reduce((sum, r) => ({ billed: sum.billed + r.total_pesewas, paid: sum.paid + r.paid_pesewas, balance: sum.balance + r.balance_pesewas }), { billed: 0, paid: 0, balance: 0 });
  return <section aria-label="School fees statement" className="page">
    <PageHeader eyebrow="My family" title="Fees" blurb="What the school has billed for each term and what has been paid."
      actions={children.length > 0 && <label className="inline-field">Child<select value={childId} onChange={e => setChildId(e.target.value)}><option value="">Choose a child</option>{children.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>}/>
    {error && <p role="alert">{error}</p>}
    {!children.length ? (loaded && <Card><Empty title="No fee statements" hint="Statements appear for children whose fees the school has linked to your account."/></Card>) : !childId ? <Card><Empty title="Choose a child"/></Card> : <>
      <div className="stats">
        <Stat label="Billed" value={cedis(totals.billed)} caption={`${rows.length} term${rows.length === 1 ? '' : 's'}`} icon="request_quote"/>
        <Stat label="Paid" value={cedis(totals.paid)} caption="Receipts issued by the school" tone="positive" icon="payments"/>
        <Stat label="Balance" value={cedis(totals.balance)} caption={totals.balance > 0 ? 'Still owed' : 'Nothing owed'} tone={totals.balance > 0 ? 'critical' : 'positive'} icon="pending_actions"/>
      </div>
      <Card title="School fees statement" flush>
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Term</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.term_name}</td><td className="num">{cedis(r.total_pesewas)}</td><td className="num">{cedis(r.paid_pesewas)}</td><td className="num">{r.balance_pesewas > 0 ? <strong className="tone-critical">{cedis(r.balance_pesewas)}</strong> : <Pill tone="positive">Settled</Pill>}</td></tr>)}</tbody></table></div> : <Empty title="No invoices yet"/>}
      </Card>
    </>}
  </section>;
}
