import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { AdjustmentDto, BulkAdjustmentDto, FeeItemDto, GenerateInvoicesDto, InvoiceQueryDto, PaymentDto, ReverseDto } from './finance.dto';

// Paid = payments that have not been reversed. bigint sums come back as strings; they stay whole pesewas.
const paidSql = `coalesce((SELECT sum(p.amount_pesewas) FROM payments p WHERE p.school_id=i.school_id AND p.invoice_id=i.id
  AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.school_id=p.school_id AND r.payment_id=p.id)),0)`;
// Due = billed fee items plus charges minus discounts recorded against the invoice.
const adjustedSql = `coalesce((SELECT sum(CASE a.kind WHEN 'charge' THEN a.amount_pesewas ELSE -a.amount_pesewas END) FROM invoice_adjustments a WHERE a.school_id=i.school_id AND a.invoice_id=i.id),0)`;
const dueSql = `(i.total_pesewas+${adjustedSql})`;
const adjustmentsJson = `coalesce((SELECT json_agg(json_build_object('id',a.id,'kind',a.kind,'label',a.label,'amountPesewas',a.amount_pesewas::float8,'reason',a.reason,'recordedAt',a.recorded_at) ORDER BY a.recorded_at) FROM invoice_adjustments a WHERE a.school_id=i.school_id AND a.invoice_id=i.id),'[]')`;
// Arrears: what the learner still owes on invoices of earlier terms. Shown on the new bill; never moved between invoices.
const arrearsSql = `coalesce((SELECT sum(${dueSql.replace(/\bi\./g,'o.')}-${paidSql.replace(/\bi\./g,'o.')}) FROM invoices o JOIN terms ot ON ot.school_id=o.school_id AND ot.id=o.term_id
  WHERE o.school_id=i.school_id AND o.learner_id=i.learner_id AND ot.start_date<(SELECT t.start_date FROM terms t WHERE t.school_id=i.school_id AND t.id=i.term_id)),0)`;

@Injectable()
export class FinanceService {
  private async term(client: PoolClient, schoolId: string, termId: string) {
    const row = (await client.query('SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 AND id=$2',[schoolId,termId])).rows[0];
    if (!row) throw new NotFoundException('Term unavailable');
    return row;
  }
  createFeeItem(client: PoolClient, actor: Actor, body: FeeItemDto) {
    return command(client,actor,body.operationId,'finance.fee-item',body,async () => {
      await this.term(client,actor.schoolId,body.termId);
      if (body.level && body.classId) throw new BadRequestException('Choose a level or one class, not both');
      if (body.classId && !(await client.query('SELECT 1 FROM class_sections WHERE school_id=$1 AND id=$2',[actor.schoolId,body.classId])).rowCount) throw new NotFoundException('Class unavailable');
      const row = (await client.query('INSERT INTO fee_items(id,school_id,term_id,name,level,class_id,amount_pesewas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,term_id,name,level,class_id,amount_pesewas::float8 AS amount_pesewas',[randomUUID(),actor.schoolId,body.termId,body.name.trim(),body.level ?? null,body.classId ?? null,body.amountPesewas,actor.membershipId])).rows[0];
      await audit(client,actor,'finance.fee-item.created',row.id,{amountPesewas:body.amountPesewas});
      return row;
    });
  }
  async feeItems(client: PoolClient, schoolId: string, termId?: string) {
    return (await client.query('SELECT f.id,f.term_id,f.name,f.level,f.class_id,c.name AS class_name,f.amount_pesewas::float8 AS amount_pesewas FROM fee_items f LEFT JOIN class_sections c ON c.school_id=f.school_id AND c.id=f.class_id WHERE f.school_id=$1 AND ($2::uuid IS NULL OR f.term_id=$2) ORDER BY f.name,f.id',[schoolId,termId ?? null])).rows;
  }
  generate(client: PoolClient, actor: Actor, body: GenerateInvoicesDto) {
    return command(client,actor,body.operationId,'finance.invoices.generate',body,async () => {
      const term = await this.term(client,actor.schoolId,body.termId);
      const section = (await client.query('SELECT id,level FROM class_sections WHERE school_id=$1 AND id=$2',[actor.schoolId,body.classId])).rows[0];
      if (!section) throw new NotFoundException('Class unavailable');
      const items = (await client.query('SELECT name,amount_pesewas::float8 AS amount FROM fee_items WHERE school_id=$1 AND term_id=$2 AND ((level IS NULL AND class_id IS NULL) OR level=$3 OR class_id=$4) ORDER BY name,id',[actor.schoolId,body.termId,section.level,section.id])).rows;
      if (!items.length) throw new ConflictException('Add fee items for this term and class level first');
      const lines = items.map(item => ({name:item.name,amountPesewas:item.amount})), total = lines.reduce((sum,line) => sum + line.amountPesewas,0);
      const learners = (await client.query('SELECT DISTINCT e.learner_id FROM enrolments e WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<$4 AND (e.end_date IS NULL OR e.end_date>$3)',[actor.schoolId,body.classId,term.start_date,term.end_date])).rows;
      let created = 0;
      for (const learner of learners) {
        const made = await client.query('INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,learner_id,term_id) DO NOTHING',[randomUUID(),actor.schoolId,learner.learner_id,body.termId,body.classId,JSON.stringify(lines),total,actor.membershipId]);
        created += made.rowCount ?? 0;
      }
      await audit(client,actor,'finance.invoices.generated',body.classId,{termId:body.termId,created,totalPerLearnerPesewas:total});
      return {created,alreadyInvoiced:learners.length - created,totalPerLearnerPesewas:total};
    });
  }
  async invoices(client: PoolClient, schoolId: string, query: InvoiceQueryDto) {
    const search = `%${(query.search ?? '').trim().replace(/[\\%_]/g,'\\$&')}%`;
    const filter = `i.school_id=$1 AND i.term_id=$2 AND ($3::uuid IS NULL OR i.class_id=$3) AND (l.full_name ILIKE $4 ESCAPE '\\' OR l.admission_number ILIKE $4 ESCAPE '\\')`;
    const values = [schoolId,query.termId,query.classId ?? null,search];
    const from = `FROM invoices i JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id JOIN class_sections c ON c.school_id=i.school_id AND c.id=i.class_id`;
    const having = query.outstandingOnly ? ` AND ${dueSql} > ${paidSql}` : '';
    const total = (await client.query(`SELECT count(*) ${from} WHERE ${filter}${having}`,values)).rows[0].count;
    const items = (await client.query(`SELECT i.id,i.learner_id,l.full_name,l.admission_number,c.name AS class_name,i.total_pesewas::float8 AS total_pesewas,${dueSql}::float8 AS due_pesewas,${paidSql}::float8 AS paid_pesewas,${arrearsSql}::float8 AS arrears_pesewas,i.lines,${adjustmentsJson} AS adjustments ${from} WHERE ${filter}${having} ORDER BY l.full_name,i.id LIMIT $5 OFFSET $6`,[...values,query.limit,query.offset])).rows
      .map(row => ({...row,balance_pesewas:row.due_pesewas - row.paid_pesewas}));
    return {items,total:Number(total),limit:query.limit,offset:query.offset};
  }
  payment(client: PoolClient, actor: Actor, body: PaymentDto) {
    return command(client,actor,body.operationId,'finance.payment',body,async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invoice:${actor.schoolId}:${body.invoiceId}`]);
      const invoice = (await client.query(`SELECT i.id,i.learner_id,${dueSql}::float8 AS total,${paidSql}::float8 AS paid FROM invoices i WHERE i.school_id=$1 AND i.id=$2`,[actor.schoolId,body.invoiceId])).rows[0];
      if (!invoice) throw new NotFoundException('Invoice unavailable');
      const balance = invoice.total - invoice.paid;
      if (body.amountPesewas > balance) throw new ConflictException(`Payment is more than the balance of ${balance} pesewas`);
      const receipt = (await client.query('INSERT INTO receipt_counters(school_id,next_number) VALUES($1,2) ON CONFLICT(school_id) DO UPDATE SET next_number=receipt_counters.next_number+1 RETURNING next_number-1 AS number',[actor.schoolId])).rows[0].number as number;
      const row = (await client.query('INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,reference,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,receipt_number',[randomUUID(),actor.schoolId,body.invoiceId,body.amountPesewas,body.method,body.reference?.trim() ?? null,body.receivedOn,receipt,actor.membershipId])).rows[0];
      await audit(client,actor,'finance.payment.recorded',row.id,{amountPesewas:body.amountPesewas,method:body.method,receiptNumber:receipt});
      return {id:row.id,receiptNumber:row.receipt_number,balancePesewas:balance - body.amountPesewas};
    });
  }
  // Discounts are the headteacher's decision; charges may be recorded by the accountant.
  adjust(client: PoolClient, actor: Actor, invoiceId: string, body: AdjustmentDto) {
    return command(client,actor,body.operationId,'finance.invoice.adjust',{invoiceId,...body},async () => {
      if (body.kind === 'discount' && actor.role !== 'headteacher') throw new ForbiddenException('Only the headteacher can grant a discount');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invoice:${actor.schoolId}:${invoiceId}`]);
      const invoice = (await client.query(`SELECT i.id,${dueSql}::float8 AS due,${paidSql}::float8 AS paid FROM invoices i WHERE i.school_id=$1 AND i.id=$2`,[actor.schoolId,invoiceId])).rows[0];
      if (!invoice) throw new NotFoundException('Invoice unavailable');
      // A bill can be discounted down to zero. Anything already paid beyond the new amount becomes a credit, shown on later bills.
      if (body.kind === 'discount' && body.amountPesewas > invoice.due) throw new ConflictException(`A discount cannot be more than the bill of ${invoice.due} pesewas`);
      const id = randomUUID();
      await client.query('INSERT INTO invoice_adjustments(id,school_id,invoice_id,kind,label,amount_pesewas,reason,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.schoolId,invoiceId,body.kind,body.label.trim(),body.amountPesewas,body.reason.trim(),actor.membershipId]);
      await audit(client,actor,`finance.invoice.${body.kind}`,invoiceId,{adjustmentId:id,amountPesewas:body.amountPesewas,label:body.label.trim()});
      const balance = invoice.due + (body.kind === 'charge' ? body.amountPesewas : -body.amountPesewas) - invoice.paid;
      return {id,balancePesewas:balance};
    });
  }
  // All or nothing: every bill must exist and no discount may exceed a bill; each bill gets its own adjustment row and audit event.
  adjustMany(client: PoolClient, actor: Actor, body: BulkAdjustmentDto) {
    return command(client,actor,body.operationId,'finance.invoice.adjust.many',body,async () => {
      if (body.kind === 'discount' && actor.role !== 'headteacher') throw new ForbiddenException('Only the headteacher can grant a discount');
      const ids = [...body.invoiceIds].sort();
      // Same per-invoice locks as single adjustments and payments, taken in a fixed order.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended(k,0)) FROM unnest($1::text[]) k',[ids.map(id => `invoice:${actor.schoolId}:${id}`)]);
      const bills = (await client.query(`SELECT i.id,l.full_name,${dueSql}::float8 AS due,${paidSql}::float8 AS paid FROM invoices i JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id
        WHERE i.school_id=$1 AND i.id=ANY($2::uuid[]) ORDER BY i.id`,[actor.schoolId,ids])).rows;
      if (bills.length !== ids.length) throw new NotFoundException('A selected bill is unavailable');
      const over = bills.filter(bill => body.kind === 'discount' && body.amountPesewas > bill.due);
      if (over.length) throw new ConflictException(`A discount cannot be more than the bill. Too large for: ${over.slice(0,5).map(bill => bill.full_name).join(', ')}${over.length > 5 ? ` and ${over.length - 5} more` : ''}`);
      const adjustmentIds = bills.map(() => randomUUID()), label = body.label.trim(), reason = body.reason.trim();
      await client.query(`INSERT INTO invoice_adjustments(id,school_id,invoice_id,kind,label,amount_pesewas,reason,recorded_by)
        SELECT x.id,$1,x.invoice_id,$4,$5,$6,$7,$8 FROM unnest($2::uuid[],$3::uuid[]) x(id,invoice_id)`,[actor.schoolId,adjustmentIds,bills.map(bill => bill.id),body.kind,label,body.amountPesewas,reason,actor.membershipId]);
      await client.query(`INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
        SELECT gen_random_uuid(),$1,$2,$3,x.invoice_id,jsonb_build_object('adjustmentId',x.id,'amountPesewas',$4::bigint,'label',$5::text,'batch',$6::text,'bills',$7::int)
        FROM unnest($8::uuid[],$9::uuid[]) x(id,invoice_id)`,[actor.schoolId,actor.membershipId,`finance.invoice.${body.kind}`,body.amountPesewas,label,body.operationId,bills.length,adjustmentIds,bills.map(bill => bill.id)]);
      const sign = body.kind === 'charge' ? 1 : -1;
      return {count:bills.length,totalPesewas:bills.length * body.amountPesewas,items:bills.map((bill,index) => ({invoiceId:bill.id,id:adjustmentIds[index],balancePesewas:bill.due + sign*body.amountPesewas - bill.paid}))};
    });
  }
  reverse(client: PoolClient, actor: Actor, paymentId: string, body: ReverseDto) {
    return command(client,actor,body.operationId,'finance.payment.reverse',{paymentId,...body},async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payment:${actor.schoolId}:${paymentId}`]);
      const payment = (await client.query('SELECT id FROM payments WHERE school_id=$1 AND id=$2',[actor.schoolId,paymentId])).rows[0];
      if (!payment) throw new NotFoundException('Payment unavailable');
      if ((await client.query('SELECT 1 FROM payment_reversals WHERE school_id=$1 AND payment_id=$2',[actor.schoolId,paymentId])).rowCount) throw new ConflictException('This payment was already reversed');
      await client.query('INSERT INTO payment_reversals(id,school_id,payment_id,reason,reversed_by) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.schoolId,paymentId,body.reason.trim(),actor.membershipId]);
      await audit(client,actor,'finance.payment.reversed',paymentId,{reason:body.reason.trim()});
      return {reversed:true};
    });
  }
  async receipt(client: PoolClient, schoolId: string, paymentId: string) {
    const row = (await client.query(`SELECT p.id,p.receipt_number,p.amount_pesewas::float8 AS amount_pesewas,p.method,p.reference,p.received_on::text,p.recorded_at,
        l.full_name,l.admission_number,t.name AS term_name,s.name AS school_name,s.address AS school_address,s.phone AS school_phone,${dueSql}::float8 AS invoice_total,r.reason AS reversal_reason
      FROM payments p JOIN invoices i ON i.school_id=p.school_id AND i.id=p.invoice_id JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id
      JOIN terms t ON t.school_id=i.school_id AND t.id=i.term_id JOIN schools s ON s.id=p.school_id
      LEFT JOIN payment_reversals r ON r.school_id=p.school_id AND r.payment_id=p.id WHERE p.school_id=$1 AND p.id=$2`,[schoolId,paymentId])).rows[0];
    if (!row) throw new NotFoundException('Payment unavailable');
    return row;
  }
  async summary(client: PoolClient, schoolId: string, termId: string) {
    await this.term(client,schoolId,termId);
    const row = (await client.query(`SELECT count(*)::int AS invoices,coalesce(sum(${dueSql}),0)::float8 AS billed,coalesce(sum(${adjustedSql}),0)::float8 AS adjusted,coalesce(sum(${paidSql}),0)::float8 AS collected FROM invoices i WHERE i.school_id=$1 AND i.term_id=$2`,[schoolId,termId])).rows[0];
    return {invoices:row.invoices,billedPesewas:row.billed,adjustmentsPesewas:row.adjusted,collectedPesewas:row.collected,outstandingPesewas:row.billed - row.collected};
  }
  // The same figures per class, so a class that is slow to pay shows up without opening each class.
  async summaryByClass(client: PoolClient, schoolId: string, termId: string) {
    await this.term(client,schoolId,termId);
    const rows = (await client.query(`SELECT c.id,c.name,count(*)::int AS invoices,coalesce(sum(${dueSql}),0)::float8 AS billed,coalesce(sum(${paidSql}),0)::float8 AS collected FROM invoices i JOIN class_sections c ON c.school_id=i.school_id AND c.id=i.class_id WHERE i.school_id=$1 AND i.term_id=$2 GROUP BY c.id,c.name ORDER BY c.name,c.id`,[schoolId,termId])).rows;
    return {items:rows.map(row => ({classId:row.id as string,className:row.name as string,invoices:row.invoices as number,billedPesewas:row.billed as number,collectedPesewas:row.collected as number,outstandingPesewas:(row.billed as number) - (row.collected as number)}))};
  }
  // One learner's bills, newest term first, for the headteacher's learner page.
  async learnerFees(client: PoolClient, schoolId: string, learnerId: string) {
    const rows = (await client.query(`SELECT i.id,t.name AS term_name,ay.name AS year_name,${dueSql}::float8 AS total_pesewas,${paidSql}::float8 AS paid_pesewas FROM invoices i JOIN terms t ON t.school_id=i.school_id AND t.id=i.term_id JOIN academic_years ay ON ay.school_id=t.school_id AND ay.id=t.academic_year_id
      WHERE i.school_id=$1 AND i.learner_id=$2 ORDER BY t.start_date DESC,i.id`,[schoolId,learnerId])).rows;
    return rows.map(row => ({...row,balance_pesewas:row.total_pesewas - row.paid_pesewas}));
  }
  async statement(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT id FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND billing=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rows[0];
    if (!link) throw new NotFoundException('Child unavailable');
    const invoices = (await client.query(`SELECT i.id,t.name AS term_name,ay.name AS year_name,${dueSql}::float8 AS total_pesewas,${paidSql}::float8 AS paid_pesewas,i.lines,${adjustmentsJson} AS adjustments FROM invoices i JOIN terms t ON t.school_id=i.school_id AND t.id=i.term_id JOIN academic_years ay ON ay.school_id=t.school_id AND ay.id=t.academic_year_id WHERE i.school_id=$1 AND i.learner_id=$2 ORDER BY t.start_date DESC,i.id`,[actor.schoolId,learnerId])).rows;
    return {items:invoices.map(row => ({...row,balance_pesewas:row.total_pesewas - row.paid_pesewas}))};
  }
}
