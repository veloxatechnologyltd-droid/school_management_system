import React from 'react';
import { SchoolLogo } from '../lib/logo';
import { Pill } from '../lib/ui';
import { cedis } from './Finance';

type Line = { name: string; amountPesewas: number };
type Adjustment = { id: string; kind: 'discount' | 'charge'; label: string; amountPesewas: number };
type Paid = { id: string; receipt_number: number; amount_pesewas: number; method: string; received_on: string; reversed: boolean };
export type ReceiptData = {
  receipt_number: number; amount_pesewas: number; method: string; reference: string | null; received_on: string; recorded_at: string; recorded_by_name: string | null;
  full_name: string; admission_number: string; term_name: string; year_name: string; class_name: string;
  school_name: string; school_address: string | null; school_phone: string | null; school_motto: string | null;
  invoice_total: number; lines: Line[]; adjustments: Adjustment[]; arrears_pesewas: number; paid_before_pesewas: number; balance_after_pesewas: number;
  reversal_reason: string | null; history: Paid[];
};

const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function belowThousand(n: number): string {
  const hundred = Math.floor(n / 100), rest = n % 100;
  const restWords = rest < 20 ? ones[rest] : `${tens[Math.floor(rest / 10)]}${rest % 10 ? `-${ones[rest % 10]}` : ''}`;
  return [hundred ? `${ones[hundred]} hundred` : '', restWords].filter(Boolean).join(' and ');
}
export function numberInWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']] as const) {
    const chunk = Math.floor(n / size) % 1000;
    if (chunk) parts.push(`${belowThousand(chunk)}${name ? ` ${name}` : ''}`);
  }
  // "One thousand and five", as written on Ghanaian receipts and cheques.
  if (n > 100 && n % 1000 < 100 && n % 1000 > 0) parts.splice(parts.length - 1, 0, 'and');
  return parts.join(' ');
}
// GH₵ 1,450.50 → "One thousand four hundred and fifty Ghana cedis, fifty pesewas only"
export function amountInWords(pesewas: number) {
  const whole = Math.floor(pesewas / 100), fraction = pesewas % 100;
  const text = `${numberInWords(whole)} Ghana cedi${whole === 1 ? '' : 's'}${fraction ? `, ${numberInWords(fraction)} pesewa${fraction === 1 ? '' : 's'}` : ''} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const methodName = (method: string) => ({ cash: 'Cash', mobile_money: 'Mobile money', bank: 'Bank' } as Record<string, string>)[method] ?? method;
const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// The printed receipt: school heading with logo, the bill it was paid against, the amount in words, earlier payments
// on the same bill and lines for signatures and the school stamp.
export function Receipt({ schoolId, r, onOpen }: { schoolId: string; r: ReceiptData; onOpen?: (paymentId: string) => void }) {
  const discounts = r.adjustments.filter(a => a.kind === 'discount'), charges = r.adjustments.filter(a => a.kind === 'charge');
  return <article className="receipt" aria-label={`Receipt no. ${r.receipt_number}`}>
    <header className="doc-head">
      <SchoolLogo schoolId={schoolId} className="doc-logo"/>
      <div className="doc-school"><h3>{r.school_name}</h3>{r.school_motto && <p className="report-motto">{r.school_motto}</p>}{(r.school_address || r.school_phone) && <p>{[r.school_address, r.school_phone].filter(Boolean).join(' · ')}</p>}</div>
      <div className="doc-title"><strong>Official receipt</strong><span>No. {String(r.receipt_number).padStart(6, '0')}</span><span>{longDate(r.received_on)}</span></div>
    </header>
    {r.reversal_reason && <p className="doc-void" role="note">Reversed: {r.reversal_reason}. This payment no longer counts.</p>}
    <dl className="doc-facts">
      <div><dt>Received from</dt><dd>The parent of {r.full_name}</dd></div>
      <div><dt>Admission no.</dt><dd>{r.admission_number}</dd></div>
      <div><dt>Class</dt><dd>{r.class_name}</dd></div>
      <div><dt>For</dt><dd>{r.term_name} · {r.year_name}</dd></div>
    </dl>
    <div className="doc-body">
      <table className="doc-table"><thead><tr><th>Fees this term</th><th className="num">Amount</th></tr></thead><tbody>
        {r.lines.map((line, i) => <tr key={i}><td>{line.name}</td><td className="num">{cedis(line.amountPesewas)}</td></tr>)}
        {charges.map(a => <tr key={a.id}><td>{a.label}</td><td className="num">{cedis(a.amountPesewas)}</td></tr>)}
        {discounts.map(a => <tr key={a.id}><td>{a.label} (discount)</td><td className="num">− {cedis(a.amountPesewas)}</td></tr>)}
        <tr className="doc-total"><td>Bill for the term</td><td className="num">{cedis(r.invoice_total)}</td></tr>
      </tbody></table>
      <dl className="doc-sum">
        <div><dt>Paid before</dt><dd>{cedis(r.paid_before_pesewas)}</dd></div>
        <div className="doc-paid"><dt>Paid now</dt><dd>{cedis(r.amount_pesewas)}</dd></div>
        <div><dt>Balance left</dt><dd className={r.balance_after_pesewas > 0 ? 'tone-critical' : undefined}>{r.balance_after_pesewas < 0 ? `Credit ${cedis(-r.balance_after_pesewas)}` : cedis(r.balance_after_pesewas)}</dd></div>
        {r.arrears_pesewas > 0 && <div><dt>Owed from earlier terms</dt><dd className="tone-critical">{cedis(r.arrears_pesewas)}</dd></div>}
      </dl>
    </div>
    <p className="doc-words"><span>Amount in words</span>{amountInWords(r.amount_pesewas)}</p>
    <p className="doc-method">Paid by {methodName(r.method).toLowerCase()}{r.reference ? `, reference ${r.reference}` : ''}.</p>
    {r.history.length > 1 && <table className="doc-table doc-history"><caption>Payments on this bill</caption><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="num">Amount</th></tr></thead><tbody>
      {r.history.map(p => <tr key={p.id} className={p.receipt_number === r.receipt_number ? 'doc-current' : undefined}>
        <td>{onOpen && p.receipt_number !== r.receipt_number ? <button type="button" className="link-button" onClick={() => onOpen(p.id)}>No. {p.receipt_number}</button> : `No. ${p.receipt_number}`}{p.reversed && <> <Pill tone="critical">Reversed</Pill></>}</td>
        <td>{new Date(`${p.received_on.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{methodName(p.method)}</td><td className="num">{cedis(p.amount_pesewas)}</td></tr>)}
    </tbody></table>}
    <footer className="doc-sign">
      <div><span className="doc-line">{r.recorded_by_name ?? ''}</span>Received by</div>
      <div><span className="doc-line"/>Parent's signature</div>
      <div className="doc-stamp">School stamp</div>
    </footer>
    <p className="doc-printed">Keep this receipt. Printed {new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.</p>
  </article>;
}
