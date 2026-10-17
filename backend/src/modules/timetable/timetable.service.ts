import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { DraftDto, LessonDto, PeriodDto, RoomDto } from './timetable.dto';

type Period = { starts: string; ends: string; kind: 'lesson' | 'break'; label?: string };
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const TODAY = "(now() AT TIME ZONE 'Africa/Accra')::date";

// The manual timetable: one published version per term, edited as a draft and published with clash checks.
// Clashes (a teacher or a room in two places in one period) are refused when a lesson is saved, never stored.
@Injectable()
export class TimetableService {
  async rooms(client: PoolClient, schoolId: string) {
    return (await client.query('SELECT id,name FROM rooms WHERE school_id=$1 ORDER BY lower(name),id', [schoolId])).rows;
  }
  addRoom(client: PoolClient, actor: Actor, body: RoomDto) {
    return command(client, actor, body.operationId, 'timetable.room', body, async () => {
      const name = body.name.trim();
      if ((await client.query('SELECT 1 FROM rooms WHERE school_id=$1 AND lower(btrim(name))=lower($2)', [actor.schoolId, name])).rowCount) throw new ConflictException('There is already a room with that name');
      const row = (await client.query('INSERT INTO rooms(id,school_id,name) VALUES($1,$2,$3) RETURNING id,name', [randomUUID(), actor.schoolId, name])).rows[0];
      await audit(client, actor, 'timetable.room.added', row.id, { name });
      return row;
    });
  }

  // The term's versions (newest first) and the choices the editor needs. Teachers see published and retired versions only.
  async overview(client: PoolClient, actor: Actor, termId?: string) {
    const terms = (await client.query(`SELECT t.id,t.name,t.start_date::text,t.end_date::text,t.academic_year_id,y.name AS year_name,(t.start_date<=${TODAY} AND t.end_date>=${TODAY}) AS current
      FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date DESC`, [actor.schoolId])).rows;
    const term = terms.find(t => t.id === termId) ?? terms.find(t => t.current) ?? terms.find(t => t.start_date > new Date().toISOString().slice(0, 10)) ?? terms[0];
    if (termId && term?.id !== termId) throw new NotFoundException('Term unavailable');
    if (!term) return { terms, term: null, versions: [], classes: [], subjects: [], teachers: [], rooms: [], me: actor.membershipId };
    const head = actor.role === 'headteacher';
    const versions = (await client.query(`SELECT id,version,status,periods,published_at,retired_at,(SELECT count(*)::int FROM timetable_lessons l WHERE l.school_id=t.school_id AND l.timetable_id=t.id AND (l.subject_id IS NOT NULL OR l.label IS NOT NULL)) AS lessons
      FROM timetables t WHERE school_id=$1 AND term_id=$2 ${head ? '' : "AND status<>'draft'"} ORDER BY version DESC`, [actor.schoolId, term.id])).rows;
    const classes = (await client.query('SELECT id,name,level FROM class_sections WHERE school_id=$1 AND academic_year_id=$2 ORDER BY name', [actor.schoolId, term.academic_year_id])).rows;
    const subjects = (await client.query('SELECT id,name FROM subjects WHERE school_id=$1 ORDER BY name', [actor.schoolId])).rows;
    const teachers = head ? (await client.query("SELECT membership_id AS id,display_name AS name FROM staff_list() WHERE revoked_at IS NULL AND role IN ('teacher','headteacher') ORDER BY display_name")).rows : [];
    return { terms, term, versions, classes, subjects, teachers, rooms: await this.rooms(client, actor.schoolId), me: actor.membershipId };
  }

  async version(client: PoolClient, schoolId: string, id: string, lock = false) {
    const row = (await client.query(`SELECT t.*,s.academic_year_id FROM timetables t JOIN terms s ON s.school_id=t.school_id AND s.id=t.term_id WHERE t.school_id=$1 AND t.id=$2${lock ? ' FOR UPDATE OF t' : ''}`, [schoolId, id])).rows[0];
    if (!row) throw new NotFoundException('Timetable unavailable');
    return row as { id: string; term_id: string; version: number; status: string; periods: Period[]; academic_year_id: string };
  }

  // Every filled lesson of a version, with names. A teacher sees a published or retired version, and only their own
  // lessons and the lessons of classes they teach in it or are assigned to today.
  async lessons(client: PoolClient, actor: Actor, id: string) {
    const t = await this.version(client, actor.schoolId, id);
    if (actor.role !== 'headteacher' && t.status === 'draft') throw new NotFoundException('Timetable unavailable');
    const scope = actor.role === 'headteacher' ? '' : `AND (l.teacher_membership_id=$3 OR l.class_id IN (
        SELECT class_id FROM timetable_lessons WHERE school_id=$1 AND timetable_id=$2 AND teacher_membership_id=$3
        UNION SELECT class_id FROM teaching_assignments WHERE school_id=$1 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=${TODAY} AND end_date>${TODAY}))`;
    const items = (await client.query(`SELECT l.id,l.class_id,c.name AS class_name,l.weekday,l.period,l.subject_id,s.name AS subject_name,l.label,l.teacher_membership_id,l.teacher_name,l.room_id,r.name AS room_name
      FROM timetable_lessons l JOIN class_sections c ON c.school_id=l.school_id AND c.id=l.class_id
      LEFT JOIN subjects s ON s.school_id=l.school_id AND s.id=l.subject_id LEFT JOIN rooms r ON r.school_id=l.school_id AND r.id=l.room_id
      WHERE l.school_id=$1 AND l.timetable_id=$2 AND (l.subject_id IS NOT NULL OR l.label IS NOT NULL) ${scope} ORDER BY c.name,l.weekday,l.period`,
      actor.role === 'headteacher' ? [actor.schoolId, id] : [actor.schoolId, id, actor.membershipId])).rows;
    return { id: t.id, version: t.version, status: t.status, periods: t.periods, items };
  }

  // A new draft starts from the term's newest version; with none, from the newest published version of an earlier
  // term (its bell, plus its lessons when the classes are the same academic year's).
  createDraft(client: PoolClient, actor: Actor, body: DraftDto) {
    return command(client, actor, body.operationId, 'timetable.draft', body, async () => {
      const term = (await client.query('SELECT id,academic_year_id,start_date FROM terms WHERE school_id=$1 AND id=$2', [actor.schoolId, body.termId])).rows[0];
      if (!term) throw new NotFoundException('Term unavailable');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${actor.schoolId}:timetable:${term.id}`]);
      if ((await client.query("SELECT 1 FROM timetables WHERE school_id=$1 AND term_id=$2 AND status='draft'", [actor.schoolId, term.id])).rowCount) throw new ConflictException('This term already has a draft');
      const source = (await client.query('SELECT id,periods FROM timetables WHERE school_id=$1 AND term_id=$2 ORDER BY version DESC LIMIT 1', [actor.schoolId, term.id])).rows[0]
        ?? (await client.query(`SELECT t.id,t.periods FROM timetables t JOIN terms s ON s.school_id=t.school_id AND s.id=t.term_id
          WHERE t.school_id=$1 AND t.status IN ('published','retired') AND s.start_date<$2 ORDER BY s.start_date DESC,t.version DESC LIMIT 1`, [actor.schoolId, term.start_date])).rows[0];
      const version = Number((await client.query('SELECT coalesce(max(version),0)+1 AS v FROM timetables WHERE school_id=$1 AND term_id=$2', [actor.schoolId, term.id])).rows[0].v);
      const id = randomUUID();
      await client.query('INSERT INTO timetables(id,school_id,term_id,version,periods,created_by) VALUES($1,$2,$3,$4,$5,$6)', [id, actor.schoolId, term.id, version, JSON.stringify(source?.periods ?? []), actor.membershipId]);
      if (source) await client.query(`INSERT INTO timetable_lessons(id,school_id,timetable_id,class_id,weekday,period,subject_id,label,teacher_membership_id,teacher_name,room_id)
        SELECT gen_random_uuid(),l.school_id,$3,l.class_id,l.weekday,l.period,l.subject_id,l.label,l.teacher_membership_id,l.teacher_name,l.room_id
        FROM timetable_lessons l JOIN class_sections c ON c.school_id=l.school_id AND c.id=l.class_id
        WHERE l.school_id=$1 AND l.timetable_id=$2 AND c.academic_year_id=$4 AND (l.subject_id IS NOT NULL OR l.label IS NOT NULL)`, [actor.schoolId, source.id, id, term.academic_year_id]);
      await audit(client, actor, 'timetable.draft.created', id, { termId: term.id, version, copiedFrom: source?.id ?? null });
      return { id, version };
    });
  }

  async setPeriods(client: PoolClient, actor: Actor, id: string, periods: PeriodDto[]) {
    const t = await this.version(client, actor.schoolId, id, true);
    if (t.status !== 'draft') throw new ConflictException('Only a draft timetable can change');
    const clean: Period[] = periods.map(p => ({ starts: p.starts, ends: p.ends, kind: p.kind, ...(p.label?.trim() ? { label: p.label.trim() } : {}) }));
    clean.forEach((p, i) => {
      if (p.ends <= p.starts) throw new BadRequestException(`Row ${i + 1} ends before it starts`);
      if (i && p.starts < clean[i - 1]!.ends) throw new BadRequestException(`Row ${i + 1} starts before row ${i} ends`);
      if (p.kind === 'break' && !p.label) throw new BadRequestException(`Name the break in row ${i + 1}, for example Break or Lunch`);
    });
    // A period that already has lessons must stay a lesson period.
    const used = (await client.query('SELECT DISTINCT period FROM timetable_lessons WHERE school_id=$1 AND timetable_id=$2 AND (subject_id IS NOT NULL OR label IS NOT NULL) ORDER BY period', [actor.schoolId, id])).rows.map(r => r.period as number);
    const lost = used.filter(n => clean[n - 1]?.kind !== 'lesson');
    if (lost.length) throw new ConflictException(`Lessons are already placed in row ${lost.join(', ')}; clear them first`);
    await client.query('UPDATE timetables SET periods=$1 WHERE school_id=$2 AND id=$3', [JSON.stringify(clean), actor.schoolId, id]);
    await audit(client, actor, 'timetable.periods.set', id, { periods: clean.length });
    return { id, periods: clean };
  }

  // Saves one cell of the grid; an empty body clears it. Refuses a teacher or a room booked elsewhere in that period.
  async setLesson(client: PoolClient, actor: Actor, id: string, body: LessonDto) {
    const t = await this.version(client, actor.schoolId, id, true);
    if (t.status !== 'draft') throw new ConflictException('Only a draft timetable can change');
    if (t.periods[body.period - 1]?.kind !== 'lesson') throw new BadRequestException('That row of the bell schedule is not a lesson period');
    const section = (await client.query('SELECT name FROM class_sections WHERE school_id=$1 AND id=$2 AND academic_year_id=$3', [actor.schoolId, body.classId, t.academic_year_id])).rows[0];
    if (!section) throw new NotFoundException('Class unavailable for this term');
    const label = body.label?.trim() || null, subjectId = body.subjectId ?? null;
    const empty = !subjectId && !label;
    if (empty && (body.teacherMembershipId || body.roomId)) throw new BadRequestException('Choose a subject or write a label for the lesson');
    if (subjectId && !(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2', [actor.schoolId, subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
    if (body.roomId && !(await client.query('SELECT 1 FROM rooms WHERE school_id=$1 AND id=$2', [actor.schoolId, body.roomId])).rowCount) throw new NotFoundException('Room unavailable');
    let teacherName: string | null = null;
    if (body.teacherMembershipId) {
      teacherName = (await client.query("SELECT display_name FROM staff_list() WHERE membership_id=$1 AND revoked_at IS NULL AND role IN ('teacher','headteacher')", [body.teacherMembershipId])).rows[0]?.display_name ?? null;
      if (!teacherName) throw new NotFoundException('Teacher unavailable');
    }
    const where = `${DAYS[body.weekday]}, ${this.periodName(t.periods, body.period)}`;
    const other = async (column: string, value: string) => (await client.query(`SELECT c.name AS class_name,coalesce(s.name,l.label) AS what,l.teacher_name,r.name AS room_name FROM timetable_lessons l
        JOIN class_sections c ON c.school_id=l.school_id AND c.id=l.class_id LEFT JOIN subjects s ON s.school_id=l.school_id AND s.id=l.subject_id LEFT JOIN rooms r ON r.school_id=l.school_id AND r.id=l.room_id
        WHERE l.school_id=$1 AND l.timetable_id=$2 AND l.${column}=$3 AND l.weekday=$4 AND l.period=$5 AND l.class_id<>$6`, [actor.schoolId, id, value, body.weekday, body.period, body.classId])).rows[0];
    if (body.teacherMembershipId) { const o = await other('teacher_membership_id', body.teacherMembershipId); if (o) throw new ConflictException(`${o.teacher_name} already teaches ${o.class_name} ${o.what} on ${where}`); }
    if (body.roomId) { const o = await other('room_id', body.roomId); if (o) throw new ConflictException(`${o.room_name} is already used by ${o.class_name} ${o.what} on ${where}`); }
    try {
      const row = (await client.query(`INSERT INTO timetable_lessons(id,school_id,timetable_id,class_id,weekday,period,subject_id,label,teacher_membership_id,teacher_name,room_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (timetable_id,class_id,weekday,period) DO UPDATE SET subject_id=EXCLUDED.subject_id,label=EXCLUDED.label,teacher_membership_id=EXCLUDED.teacher_membership_id,teacher_name=EXCLUDED.teacher_name,room_id=EXCLUDED.room_id
        RETURNING id,class_id,weekday,period,subject_id,label,teacher_membership_id,teacher_name,room_id`,
        [randomUUID(), actor.schoolId, id, body.classId, body.weekday, body.period, subjectId, label, body.teacherMembershipId ?? null, teacherName, body.roomId ?? null])).rows[0];
      await audit(client, actor, empty ? 'timetable.lesson.cleared' : 'timetable.lesson.set', id, { classId: body.classId, weekday: body.weekday, period: body.period });
      return row;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException(`That teacher or room was just booked elsewhere on ${where}; reload and try again`);
      throw error;
    }
  }

  // Publishing retires the version in use (kept as history) and makes this one the term's timetable from now on.
  publish(client: PoolClient, actor: Actor, id: string, operationId: string) {
    return command(client, actor, operationId, 'timetable.publish', { id }, async () => {
      const t = await this.version(client, actor.schoolId, id, true);
      if (t.status !== 'draft') throw new ConflictException('This version is already published');
      const lessons = (await client.query('SELECT DISTINCT teacher_membership_id,teacher_name FROM timetable_lessons WHERE school_id=$1 AND timetable_id=$2 AND (subject_id IS NOT NULL OR label IS NOT NULL)', [actor.schoolId, id])).rows;
      if (!lessons.length) throw new BadRequestException('Add lessons before publishing');
      const live = new Set((await client.query("SELECT membership_id FROM staff_list() WHERE revoked_at IS NULL AND role IN ('teacher','headteacher')")).rows.map(r => r.membership_id as string));
      const gone = lessons.filter(l => l.teacher_membership_id && !live.has(l.teacher_membership_id)).map(l => l.teacher_name);
      if (gone.length) throw new ConflictException(`${gone.join(', ')} no longer ${gone.length === 1 ? 'has' : 'have'} a teacher account; give their lessons to someone else first`);
      const previous = (await client.query("UPDATE timetables SET status='retired',retired_at=now() WHERE school_id=$1 AND term_id=$2 AND status='published' RETURNING id", [actor.schoolId, t.term_id])).rows[0];
      await client.query("UPDATE timetables SET status='published',published_at=now(),published_by=$1 WHERE school_id=$2 AND id=$3", [actor.membershipId, actor.schoolId, id]);
      await audit(client, actor, 'timetable.published', id, { version: t.version, replaced: previous?.id ?? null });
      return { id, version: t.version, status: 'published' };
    });
  }

  // The signed-in teacher's lessons today from the published timetable of the term running today. Nothing at weekends,
  // on a day the school has declared closed, or before a timetable is published.
  async today(client: PoolClient, actor: Actor) {
    const day = (await client.query(`SELECT ${TODAY}::text AS today,extract(isodow FROM ${TODAY})::int AS dow,
        EXISTS (SELECT 1 FROM school_days WHERE school_id=$1 AND day=${TODAY} AND NOT is_open) AS closed`, [actor.schoolId])).rows[0];
    const t = (await client.query(`SELECT t.id,t.periods FROM timetables t JOIN terms s ON s.school_id=t.school_id AND s.id=t.term_id
      WHERE t.school_id=$1 AND t.status='published' AND s.start_date<=${TODAY} AND s.end_date>=${TODAY} ORDER BY s.start_date DESC LIMIT 1`, [actor.schoolId])).rows[0];
    if (!t || day.dow > 5 || day.closed) return { today: day.today, published: !!t, closed: day.closed, items: [] };
    const items = (await client.query(`SELECT l.period,l.class_id,c.name AS class_name,coalesce(s.name,l.label) AS subject,r.name AS room_name FROM timetable_lessons l
      JOIN class_sections c ON c.school_id=l.school_id AND c.id=l.class_id LEFT JOIN subjects s ON s.school_id=l.school_id AND s.id=l.subject_id LEFT JOIN rooms r ON r.school_id=l.school_id AND r.id=l.room_id
      WHERE l.school_id=$1 AND l.timetable_id=$2 AND l.teacher_membership_id=$3 AND l.weekday=$4 AND (l.subject_id IS NOT NULL OR l.label IS NOT NULL) ORDER BY l.period`, [actor.schoolId, t.id, actor.membershipId, day.dow])).rows
      .map(l => ({ ...l, starts: (t.periods as Period[])[l.period - 1]?.starts, ends: (t.periods as Period[])[l.period - 1]?.ends }));
    return { today: day.today, published: true, closed: false, items };
  }

  private periodName(periods: Period[], n: number) { const p = periods[n - 1]; return p ? `${p.starts}–${p.ends}` : `period ${n}`; }
}

