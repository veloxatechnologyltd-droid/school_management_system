import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { ProgressService } from '../assessment/progress.service';
import { ReasonDto, WriteLearningNoteDto } from './learning.dto';
import { checkLearningNote } from './notes';
import { accraToday, gradeMatches } from './scope';

// A teacher's learning notes for one student. Staff only: the head, and teachers who teach the student today (the same rule as the learner page).
// Families never see them and nothing here goes to the AI.
const LIVE_NOTES_PER_STUDENT = 30;
const MOST_NOTES_SHOWN = 200;
@Injectable()
export class LearningNotesService {
  constructor(private readonly progress: ProgressService) {}

  // The topics approved this term for the student's class: the ones a note can put first.
  private async topicsFor(client: PoolClient, schoolId: string, learnerId: string, today: string) {
    const klass = (await client.query(`SELECT c.name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id
      WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date) LIMIT 1`,[schoolId,learnerId,today])).rows[0]?.name as string | undefined;
    if (!klass) return [];
    const rows = (await client.query(`SELECT i.id AS indicator_id,a.grade,s.name AS subject,i.description AS topic FROM topic_approvals a
      JOIN curriculum_indicators i ON i.school_id=a.school_id AND i.id=a.indicator_id AND i.retired_at IS NULL JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id AND t.start_date<=$2::date AND t.end_date>=$2::date
      WHERE a.school_id=$1 AND a.retired_at IS NULL ORDER BY s.name,i.description`,[schoolId,today])).rows.filter(r => gradeMatches(klass,r.grade as string));
    return [...new Map(rows.map(r => [r.indicator_id as string,{ indicatorId: r.indicator_id as string, subject: r.subject as string, topic: r.topic as string }])).values()];
  }

  async list(client: PoolClient, actor: Actor, learnerId: string) {
    await this.progress.learnerFor(client,actor,learnerId);
    const today = await accraToday(client);
    const rows = (await client.query(`SELECT n.id,n.note,n.focus_until::text AS until,n.author_membership_id,n.author_name,n.created_at,n.withdrawn_at,n.withdrawal_reason,i.id AS indicator_id,i.description AS topic,s.name AS subject
      FROM learning_notes n LEFT JOIN curriculum_indicators i ON i.school_id=n.school_id AND i.id=n.indicator_id LEFT JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE n.school_id=$1 AND n.learner_id=$2 ORDER BY n.created_at DESC,n.id LIMIT ${MOST_NOTES_SHOWN}`,[actor.schoolId,learnerId])).rows;
    return { items: rows.map(r => ({ id: r.id, note: r.note, until: r.until, authorName: r.author_name, createdAt: r.created_at, mine: r.author_membership_id === actor.membershipId,
        canWithdraw: !r.withdrawn_at && (actor.role === 'headteacher' || r.author_membership_id === actor.membershipId),
        indicator: r.indicator_id ? { id: r.indicator_id, subject: r.subject, topic: r.topic } : null, withdrawn: r.withdrawn_at ? { at: r.withdrawn_at, reason: r.withdrawal_reason } : null })),
      topics: await this.topicsFor(client,actor.schoolId,learnerId,today) };
  }

  write(client: PoolClient, actor: Actor, learnerId: string, body: WriteLearningNoteDto) {
    return command(client,actor,body.operationId,'learning.note.write',{learnerId,...body},async () => {
      const learner = await this.progress.learnerFor(client,actor,learnerId);
      // Characters are counted the way the database counts them, which the form check does not for emoji.
      const length = [...body.note.trim()].length;
      if (length < 5 || length > 240) throw new BadRequestException('A learning note is 5 to 240 characters');
      const problem = checkLearningNote(body.note,learner);
      if (problem) throw new BadRequestException(problem);
      const today = await accraToday(client);
      if (body.until && !body.indicatorId) throw new BadRequestException('An end date goes with a topic to put first');
      if (body.until && body.until < today) throw new BadRequestException('Choose today or a later date');
      if (body.indicatorId) {
        if (!(await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND retired_at IS NULL',[actor.schoolId,body.indicatorId])).rowCount) throw new NotFoundException('Topic unavailable');
        if (!(await this.topicsFor(client,actor.schoolId,learnerId,today)).some(t => t.indicatorId === body.indicatorId)) throw new BadRequestException("That topic is not one the student's class is learning this term");
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`learning-note:${actor.schoolId}:${learnerId}`]);
      if (Number((await client.query('SELECT count(*) FROM learning_notes WHERE school_id=$1 AND learner_id=$2 AND withdrawn_at IS NULL',[actor.schoolId,learnerId])).rows[0].count) >= LIVE_NOTES_PER_STUDENT)
        throw new ConflictException(`This student already has ${LIVE_NOTES_PER_STUDENT} notes. Withdraw one that no longer applies first.`);
      const id = randomUUID();
      await client.query('INSERT INTO learning_notes(id,school_id,learner_id,indicator_id,note,focus_until,author_membership_id,author_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [id,actor.schoolId,learnerId,body.indicatorId ?? null,body.note.trim(),body.until ?? null,actor.membershipId,actor.displayName?.trim() || 'Staff member']);
      await audit(client,actor,'learning.note.written',id,{ learnerId, topic: body.indicatorId ?? null });
      return { id };
    });
  }

  withdraw(client: PoolClient, actor: Actor, noteId: string, body: ReasonDto) {
    return command(client,actor,body.operationId,'learning.note.withdraw',{noteId,...body},async () => {
      const row = (await client.query('SELECT learner_id,author_membership_id,withdrawn_at FROM learning_notes WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,noteId])).rows[0];
      // One answer for a note that is gone, one that is withdrawn and one on a student the person does not teach, so none can be told from another.
      const unavailable = () => new NotFoundException('Note unavailable');
      if (!row || row.withdrawn_at) throw unavailable();
      const learner = await this.progress.learnerFor(client,actor,row.learner_id).catch(e => { throw e instanceof NotFoundException ? unavailable() : e; });
      if (actor.role !== 'headteacher' && row.author_membership_id !== actor.membershipId) throw new ForbiddenException('Only the headteacher or the person who wrote it can withdraw this note');
      const problem = checkLearningNote(body.reason,learner);
      if (problem) throw new BadRequestException(problem);
      await client.query('UPDATE learning_notes SET withdrawn_at=clock_timestamp(),withdrawn_by=$3,withdrawal_reason=$4 WHERE school_id=$1 AND id=$2',[actor.schoolId,noteId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'learning.note.withdrawn',noteId,{ learnerId: row.learner_id });
      return { withdrawn: true };
    });
  }
}
