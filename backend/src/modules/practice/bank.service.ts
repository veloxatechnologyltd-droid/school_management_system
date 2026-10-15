import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { ApproveQuestionsDto, RetireSetDto } from './practice.dto';
import { checkQuestions, inOrder, questionsProblem } from './questions';

// The school's home-practice question sets, one current set per indicator. Staff see the answers; families never see this service.
@Injectable()
export class PracticeBankService {
  async bank(client: PoolClient, actor: Actor, indicatorId: string) {
    const indicator = (await client.query('SELECT code,description,grade,retired_at FROM curriculum_indicators WHERE school_id=$1 AND id=$2',[actor.schoolId,indicatorId])).rows[0];
    if (!indicator) throw new NotFoundException('Indicator unavailable');
    const sets = (await client.query(`SELECT s.id,s.source,s.approved_by_name,s.approved_at,s.approved_by=$3 AS mine,s.retired_at,s.retirement_reason,
        (SELECT count(*)::int FROM practice_questions q WHERE q.school_id=s.school_id AND q.set_id=s.id) AS questions FROM practice_sets s
      WHERE s.school_id=$1 AND s.indicator_id=$2 ORDER BY s.approved_at DESC,s.id`,[actor.schoolId,indicatorId,actor.membershipId])).rows;
    const current = sets.find(s => !s.retired_at);
    const questions = current ? (await client.query(`SELECT level,position,kind,prompt,options,correct_option,answer_number::float AS answer,explanation FROM practice_questions
      WHERE school_id=$1 AND set_id=$2 ORDER BY level,position`,[actor.schoolId,current.id])).rows.map(q => ({level:q.level as number,kind:q.kind as string,prompt:q.prompt as string,options:q.options as string[] | null,correctOption:q.correct_option as number | null,answer:q.answer as number | null,explanation:q.explanation as string | null})) : [];
    return {indicator,canRetireAny:actor.role === 'headteacher',current:current ? {...current,questions} : null,history:sets.filter(s => s.retired_at)};
  }

  // Approving is the teacher's decision: the set is checked, kept as written, and replaces the indicator's current set.
  approve(client: PoolClient, actor: Actor, indicatorId: string, body: ApproveQuestionsDto) {
    return command(client,actor,body.operationId,'practice.set.approve',{indicatorId,...body},async () => {
      if (!(await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND retired_at IS NULL FOR UPDATE',[actor.schoolId,indicatorId])).rowCount) throw new NotFoundException('Indicator unavailable or retired');
      const checked = checkQuestions(body.questions.map(q => ({...q,correctOption:q.correctOption ?? null})));
      if (!checked.ok) throw new BadRequestException(questionsProblem(checked.reason));
      let aiRun: string | null = null;
      if (body.runId) {
        const run = (await client.query("SELECT source FROM ai_runs WHERE school_id=$1 AND id=$2 AND actor_membership_id=$3 AND feature='practice.questions'",[actor.schoolId,body.runId,actor.membershipId])).rows[0];
        if (!run) throw new BadRequestException('That draft is unavailable');
        if (run.source === 'ai') aiRun = body.runId;
      }
      const replaced = (await client.query("UPDATE practice_sets SET retired_at=clock_timestamp(),retired_by=$3,retirement_reason='Replaced by a newer approved set' WHERE school_id=$1 AND indicator_id=$2 AND retired_at IS NULL RETURNING id",[actor.schoolId,indicatorId,actor.membershipId])).rowCount ?? 0;
      const id = randomUUID();
      await client.query('INSERT INTO practice_sets(id,school_id,indicator_id,source,ai_run_id,approved_by,approved_by_name) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor.schoolId,indicatorId,aiRun ? 'ai' : 'teacher',aiRun,actor.membershipId,actor.displayName?.trim() || 'Staff member']);
      const positions = new Map<number,number>();
      for (const q of inOrder(checked.questions)) {
        const position = (positions.get(q.level) ?? 0) + 1; positions.set(q.level,position);
        await client.query('INSERT INTO practice_questions(id,school_id,set_id,level,position,kind,prompt,options,correct_option,answer_number,explanation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [randomUUID(),actor.schoolId,id,q.level,position,q.kind,q.prompt,q.options ? JSON.stringify(q.options) : null,q.correctOption,q.answer,q.explanation]);
      }
      await audit(client,actor,'practice.set.approved',id,{indicatorId,questions:checked.questions.length,source:aiRun ? 'ai' : 'teacher',replaced:replaced > 0});
      return {id,questions:checked.questions.length,replaced:replaced > 0};
    });
  }

  // The headteacher, or whoever approved the set, may withdraw it. Children mid-session finish the questions they were given.
  retire(client: PoolClient, actor: Actor, setId: string, body: RetireSetDto) {
    return command(client,actor,body.operationId,'practice.set.retire',{setId,...body},async () => {
      const row = (await client.query('SELECT approved_by,retired_at FROM practice_sets WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,setId])).rows[0];
      if (!row || row.retired_at) throw new NotFoundException('Question set unavailable or already retired');
      if (actor.role !== 'headteacher' && row.approved_by !== actor.membershipId) throw new ForbiddenException('Only the headteacher or the person who approved it can retire this set');
      await client.query('UPDATE practice_sets SET retired_at=clock_timestamp(),retired_by=$3,retirement_reason=$4 WHERE school_id=$1 AND id=$2',[actor.schoolId,setId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'practice.set.retired',setId,{reason:body.reason.trim()});
      return {retired:true};
    });
  }
}
