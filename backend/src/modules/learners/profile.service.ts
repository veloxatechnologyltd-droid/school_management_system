import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { LearnersService } from './learners.service';
import { ProgressService } from '../assessment/progress.service';
import { SupportService } from '../assessment/support.service';
import { MocksService } from '../assessment/mocks.service';
import { FinanceService } from '../finance/finance.service';
import { LearnerDetailsDto, LearnerNoteDto, WithdrawNoteDto } from './profile.dto';
import { cleanPhone, cleanValues, clean, needContactName, storeDetails } from '../../core/details';

type Note = { id: string; author_membership_id: string; author_role: string; author_name: string; category: string; body: string; shared_with_family: boolean; created_at: string;
  withdrawn_at: string | null; withdrawal_reason: string | null };

const detailRules = { nationality: { label: 'Nationality', min: 2, max: 60 }, home_address: { label: 'Home address', min: 3, max: 200 }, previous_school: { label: 'Previous school', min: 2, max: 120 },
  health_notes: { label: 'Health notes', min: 3, max: 500 }, emergency_name: { label: 'Emergency contact name', min: 2, max: 120 }, emergency_relationship: { label: 'Relationship', min: 2, max: 40 } };
// What each role may read. A teacher sees what keeps a child safe in class; religion, nationality and the home address are the head's.
const teacherDetails = ['previousSchool','bloodGroup','healthNotes','emergencyName','emergencyRelationship','emergencyPhone'] as const;

@Injectable()
export class LearnerProfileService {
  constructor(private readonly learners: LearnersService, private readonly progress: ProgressService, private readonly support: SupportService,
    private readonly mocks: MocksService, private readonly finance: FinanceService) {}

  private async today(client: PoolClient) { return (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS d")).rows[0].d as string; }

  // Everything the school knows about one learner, on one page. Teachers see only learners in a class they teach today;
  // guardian phone numbers and fees are for the headteacher.
  async profile(client: PoolClient, actor: Actor, learnerId: string, termId?: string) {
    await this.progress.learnerFor(client,actor,learnerId);
    const head = actor.role === 'headteacher', today = await this.today(client);
    const learner = await this.learners.learner(client,actor.schoolId,learnerId);
    const enrolments = (learner.enrolments as { class_id: string; class_name: string; start_date: string; end_date: string | null; end_reason: string | null; superseded_at: string | null }[])
      .filter(e => !e.superseded_at).sort((a,b) => b.start_date.localeCompare(a.start_date));
    const current = enrolments.find(e => e.start_date <= today && (e.end_date === null || e.end_date > today)) ?? null;
    const level = current ? (await client.query('SELECT level,academic_year_id FROM class_sections WHERE school_id=$1 AND id=$2',[actor.schoolId,current.class_id])).rows[0] : null;

    const terms = (await client.query(`SELECT t.id,t.name,t.start_date::text,t.end_date::text,y.name AS year_name FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id
      WHERE t.school_id=$1 AND t.start_date<=$3::date AND EXISTS (SELECT 1 FROM enrolments e WHERE e.school_id=t.school_id AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<t.end_date AND (e.end_date IS NULL OR e.end_date>t.start_date))
      ORDER BY t.start_date DESC`,[actor.schoolId,learnerId,today])).rows as { id: string; name: string; start_date: string; end_date: string; year_name: string }[];
    if (termId && !terms.some(t => t.id === termId)) throw new NotFoundException('Term unavailable');
    const term = terms.find(t => t.id === termId) ?? terms[0] ?? null;

    const guardians = (await client.query(`SELECT g.id,g.guardian_membership_id,g.guardian_display_name AS name,g.academic,g.billing,g.pickup,g.contact,g.verified_at IS NOT NULL AS verified
      FROM guardian_links g WHERE g.school_id=$1 AND g.learner_id=$2 AND g.revoked_at IS NULL ORDER BY g.verified_at IS NULL,g.created_at,g.id`,[actor.schoolId,learnerId])).rows;
    const phones = head && guardians.length ? new Map((await client.query('SELECT membership_id,phone FROM staff_list() WHERE membership_id=ANY($1::uuid[])',[guardians.map(g => g.guardian_membership_id)])).rows.map(r => [r.membership_id as string,r.phone as string | null])) : null;

    const attendance = term ? (await client.query(`SELECT count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked,count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present,
        count(*) FILTER (WHERE m.mark='late')::int AS late,count(*) FILTER (WHERE m.mark='absent')::int AS absent,count(*) FILTER (WHERE m.mark='excused')::int AS excused,
        array_agg(r.day::text ORDER BY r.day DESC) FILTER (WHERE m.mark='absent') AS absent_days
      FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
      WHERE m.school_id=$1 AND m.learner_id=$2 AND r.day BETWEEN $3::date AND $4::date`,[actor.schoolId,learnerId,term.start_date,term.end_date])).rows[0] : null;

    // The last weeks of marks, one per register day, for the Attendance tab.
    const days = term ? (await client.query(`SELECT r.day::text AS day,m.mark FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
      WHERE m.school_id=$1 AND m.learner_id=$2 AND m.mark<>'unmarked' AND r.day BETWEEN $3::date AND $4::date ORDER BY r.day DESC LIMIT 30`,[actor.schoolId,learnerId,term.start_date,term.end_date])).rows as { day: string; mark: string }[] : [];
    // Teachers currently assigned to the class, and the application this student came from (the head's page only).
    const classTeachers = current ? (await client.query(`SELECT DISTINCT teacher_display_name AS name FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND revoked_at IS NULL AND start_date<=$3::date AND end_date>$3::date ORDER BY 1`,
      [actor.schoolId,current.class_id,today])).rows.map(r => r.name as string) : [];
    const application = head ? (await client.query('SELECT id,created_at,start_date::text FROM admissions WHERE school_id=$1 AND learner_id=$2',[actor.schoolId,learnerId])).rows[0] ?? null : null;

    const detailRow = (await client.query(`SELECT nationality,religion,home_address,previous_school,blood_group,health_notes,emergency_name,emergency_relationship,emergency_phone,version,updated_at
      FROM learner_details WHERE school_id=$1 AND learner_id=$2`,[actor.schoolId,learnerId])).rows[0];
    const allDetails = {nationality:detailRow?.nationality ?? null,religion:detailRow?.religion ?? null,homeAddress:detailRow?.home_address ?? null,previousSchool:detailRow?.previous_school ?? null,
      bloodGroup:detailRow?.blood_group ?? null,healthNotes:detailRow?.health_notes ?? null,emergencyName:detailRow?.emergency_name ?? null,emergencyRelationship:detailRow?.emergency_relationship ?? null,emergencyPhone:detailRow?.emergency_phone ?? null};
    const details = {version:detailRow?.version ?? 0,updatedAt:detailRow?.updated_at ?? null,canEdit:head,
      ...(head ? allDetails : Object.fromEntries(teacherDetails.map(k => [k,allDetails[k]])))};

    const termWork = term ? await this.progress.learnerTerm(client,actor,learnerId,term.id) : null;
    const history = await this.progress.learnerProgress(client,actor,learnerId,'term');
    const reports = (await client.query(`SELECT DISTINCT ON (r.term_id) r.term_id,t.name AS term_name,y.name AS year_name,r.revision,r.published_at,r.snapshot->'class'->>'name' AS class_name,
        (r.snapshot->>'average')::float AS average,(r.snapshot->>'position')::int AS position,(r.snapshot->>'classSize')::int AS class_size,r.snapshot->>'teacherRemark' AS teacher_remark
      FROM terminal_reports r JOIN terms t ON t.school_id=r.school_id AND t.id=r.term_id JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id
      WHERE r.school_id=$1 AND r.learner_id=$2 ORDER BY r.term_id,r.revision DESC`,[actor.schoolId,learnerId])).rows
      .sort((a,b) => String(b.published_at).localeCompare(String(a.published_at)));

    const plans = (await this.support.list(client,actor,{status:'all'})).items.filter(p => p.learners.some((l: { id: string }) => l.id === learnerId))
      .map(p => ({id:p.id,classId:p.class_id,className:p.class_name,subject:p.subject_name,topic:p.indicator_description,concern:p.concern,action:p.action,owner:p.owner_name,
        startDate:p.start_date,closed:p.closed,due:p.due,nextReview:p.review_date ?? null}));

    let mock: unknown = null;
    if (current && level?.level === 'JHS') try {
      const m = await this.mocks.rounds(client,actor,current.class_id), row = m.learners.find(l => l.learnerId === learnerId);
      if (row?.latest) mock = {round:m.rounds.find(r => r.key === row.latest!.key)?.title ?? null,average:row.latest.average,change:row.latest.change,below:row.latest.below,needsSupport:row.latest.atRisk};
    } catch { mock = null; }

    return {today,learner:{id:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number,dateOfBirth:learner.date_of_birth,sex:learner.sex},
      currentClass:current ? {id:current.class_id,name:current.class_name,level:level?.level ?? null,since:current.start_date} : null,
      enrolments:enrolments.map(e => ({classId:e.class_id,className:e.class_name,startDate:e.start_date,endDate:e.end_date,endReason:e.end_reason})),
      guardians:guardians.map(g => ({name:g.name,verified:g.verified,rights:(['academic','billing','pickup','contact'] as const).filter(k => g[k]),...(phones ? {phone:phones.get(g.guardian_membership_id) ?? null} : {})})),
      terms:terms.map(t => ({id:t.id,name:t.name,yearName:t.year_name})),term:term ? {id:term.id,name:term.name,yearName:term.year_name,startDate:term.start_date,endDate:term.end_date} : null,
      attendance:attendance ? {marked:attendance.marked,present:attendance.present,late:attendance.late,absent:attendance.absent,excused:attendance.excused,
        rate:attendance.marked ? Math.round(attendance.present * 1000 / attendance.marked) / 10 : null,absentDays:(attendance.absent_days ?? []).slice(0,10),days} : null,
      details,classTeachers,application:application ? {id:application.id as string,receivedOn:String(new Date(application.created_at).toISOString()).slice(0,10),startDate:application.start_date as string} : null,
      termWork,history:{buckets:history.buckets,subjects:history.subjects},reports,plans,mock,
      fees:head ? await this.finance.learnerFees(client,actor.schoolId,learnerId) : undefined,
      notes:await this.notes(client,actor,learnerId)};
  }

  // The headteacher records a student's optional details, whole: a field left empty is cleared. The audit event names the fields
  // that changed and never their values, because religion and health are sensitive.
  saveDetails(client: PoolClient, actor: Actor, learnerId: string, body: LearnerDetailsDto) {
    return command(client,actor,body.operationId,'learner.details',{learnerId,...body},async () => {
      await this.learners.learner(client,actor.schoolId,learnerId);
      const values = {...cleanValues(detailRules,{nationality:body.nationality,home_address:body.homeAddress,previous_school:body.previousSchool,health_notes:body.healthNotes,
        emergency_name:body.emergencyName,emergency_relationship:body.emergencyRelationship}),religion:clean(body.religion),blood_group:clean(body.bloodGroup),emergency_phone:cleanPhone(body.emergencyPhone)};
      needContactName(values);
      const saved = await storeDetails(client,'learner_details','learner_id',actor.schoolId,learnerId,body.version,values);
      if (saved.changed.length) await audit(client,actor,'learner.details.updated',learnerId,{fields:saved.changed,version:saved.version});
      return {version:saved.version};
    });
  }

  // Staff see every note on the learner; a guardian sees the notes the school shared with the family and their own.
  private async notes(client: PoolClient, actor: Actor, learnerId: string) {
    const rows = (await client.query(`SELECT n.id,n.author_membership_id,n.author_role,n.author_name,n.category,n.body,n.shared_with_family,n.created_at,w.withdrawn_at,w.reason AS withdrawal_reason
      FROM learner_notes n LEFT JOIN learner_note_withdrawals w ON w.school_id=n.school_id AND w.note_id=n.id WHERE n.school_id=$1 AND n.learner_id=$2
      AND ($3::boolean OR (n.shared_with_family AND n.author_role<>'guardian') OR n.author_membership_id=$4) ORDER BY n.created_at DESC,n.id`,
      [actor.schoolId,learnerId,actor.role !== 'guardian',actor.membershipId])).rows as Note[];
    return rows.map(n => ({id:n.id,authorRole:n.author_role,authorName:n.author_name,category:n.category,body:n.body,sharedWithFamily:n.shared_with_family,createdAt:n.created_at,
      mine:n.author_membership_id === actor.membershipId,canWithdraw:!n.withdrawn_at && (n.author_membership_id === actor.membershipId || actor.role === 'headteacher'),
      withdrawn:n.withdrawn_at ? {at:n.withdrawn_at,reason:n.withdrawal_reason} : null}));
  }

  private async guardianChild(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT 1 FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL',[actor.schoolId,learnerId,actor.membershipId])).rowCount;
    if (!link) throw new NotFoundException('Child unavailable');
  }

  async familyNotes(client: PoolClient, actor: Actor, learnerId: string) {
    await this.guardianChild(client,actor,learnerId);
    return {items:await this.notes(client,actor,learnerId)};
  }

  addNote(client: PoolClient, actor: Actor, learnerId: string, body: LearnerNoteDto) {
    return command(client,actor,body.operationId,'learner.note',{learnerId,...body},async () => {
      if (actor.role === 'guardian') await this.guardianChild(client,actor,learnerId);
      else await this.progress.learnerFor(client,actor,learnerId);
      const author = actor.role === 'guardian'
        ? (await client.query('SELECT guardian_display_name AS name FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND revoked_at IS NULL ORDER BY created_at LIMIT 1',[actor.schoolId,learnerId,actor.membershipId])).rows[0]?.name
        : actor.displayName;
      const shared = actor.role === 'guardian' ? true : body.sharedWithFamily === true;
      const id = randomUUID();
      await client.query('INSERT INTO learner_notes(id,school_id,learner_id,author_membership_id,author_role,author_name,category,body,shared_with_family) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id,actor.schoolId,learnerId,actor.membershipId,actor.role,(author ?? 'School staff').trim().slice(0,120),body.category,body.body.trim(),shared]);
      await audit(client,actor,'learner.note.added',learnerId,{noteId:id,category:body.category,sharedWithFamily:shared});
      return {id,sharedWithFamily:shared};
    });
  }

  // The author, or the headteacher, withdraws a note with a reason; the note and the reason stay in the history.
  withdrawNote(client: PoolClient, actor: Actor, noteId: string, body: WithdrawNoteDto) {
    return command(client,actor,body.operationId,'learner.note.withdraw',{noteId,...body},async () => {
      const note = (await client.query('SELECT n.learner_id,n.author_membership_id,w.note_id AS withdrawn FROM learner_notes n LEFT JOIN learner_note_withdrawals w ON w.school_id=n.school_id AND w.note_id=n.id WHERE n.school_id=$1 AND n.id=$2',[actor.schoolId,noteId])).rows[0];
      if (!note) throw new NotFoundException('Note unavailable');
      if (actor.role === 'guardian') await this.guardianChild(client,actor,note.learner_id);
      else if (actor.role === 'teacher' || actor.role === 'headteacher') await this.progress.learnerFor(client,actor,note.learner_id);
      else throw new ForbiddenException('Your role cannot perform this action');
      if (note.author_membership_id !== actor.membershipId && actor.role !== 'headteacher') throw new ForbiddenException('Only the author or the headteacher can withdraw a note');
      if (note.withdrawn) throw new ConflictException('This note is already withdrawn');
      if (body.reason.trim().length < 3) throw new BadRequestException('Give a reason');
      await client.query('INSERT INTO learner_note_withdrawals(note_id,school_id,withdrawn_by,reason) VALUES($1,$2,$3,$4)',[noteId,actor.schoolId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'learner.note.withdrawn',note.learner_id,{noteId});
      return {withdrawn:true};
    }).catch(error => { if ((error as {code?:string}).code === '23505') throw new ConflictException('This note is already withdrawn'); throw error; });
  }
}
