import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AI_LABEL } from '../learning/topics.service';
import { SESSION_SIZE } from './rules';

// What a child has learned at home, to revisit: lessons read to the end and practice sessions finished, newest first, and any one of them in full.
// Families and staff read the same records; only staff are told the minutes a lesson was open. A session or lesson that was started and not finished
// is not here, so a question cannot be read ahead of answering it. Reads only: nothing here changes a record.
const MAX_ITEMS = 40;
const dayOf = (at: Date) => at.toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'});
const minutesOf = 'LEAST(30,round(extract(epoch FROM (st.finished_at-st.started_at))/60))::int';

export async function historyList(client: PoolClient, schoolId: string, learnerId: string, staff: boolean) {
  const practice = (await client.query(`SELECT p.id,p.completed_at AS at,s.name AS subject,i.description AS topic,p.level,p.correct,p.outcome,p.level_after,(p.study_session_id IS NOT NULL) AS after_study
      FROM practice_sessions p JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE p.school_id=$1 AND p.learner_id=$2 AND p.completed_at IS NOT NULL ORDER BY p.completed_at DESC,p.id LIMIT $3`,[schoolId,learnerId,MAX_ITEMS])).rows
    .map(r => ({at:r.at as Date,item:{kind:'practice' as const,id:r.id as string,on:dayOf(r.at),subject:r.subject as string,topic:r.topic as string,level:r.level as number,correct:r.correct as number,total:SESSION_SIZE,
      outcome:r.outcome as string,levelAfter:r.level_after as number,afterStudy:r.after_study as boolean}}));
  const studies = (await client.query(`SELECT st.id,st.finished_at AS at,s.name AS subject,i.description AS topic,${minutesOf} AS minutes,c.id AS check_id,c.correct AS check_correct FROM study_sessions st
      JOIN curriculum_indicators i ON i.school_id=st.school_id AND i.id=st.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      LEFT JOIN LATERAL (SELECT p.id,p.correct FROM practice_sessions p WHERE p.school_id=st.school_id AND p.study_session_id=st.id AND p.completed_at IS NOT NULL ORDER BY p.completed_at DESC LIMIT 1) c ON true
      WHERE st.school_id=$1 AND st.learner_id=$2 AND st.finished_at IS NOT NULL ORDER BY st.finished_at DESC,st.id LIMIT $3`,[schoolId,learnerId,MAX_ITEMS])).rows
    .map(r => ({at:r.at as Date,item:{kind:'study' as const,id:r.id as string,on:dayOf(r.at),subject:r.subject as string,topic:r.topic as string,
      check:r.check_id === null ? null : {correct:r.check_correct as number,total:SESSION_SIZE},...(staff ? {minutes:r.minutes as number} : {})}}));
  return [...practice,...studies].sort((a,b) => b.at.getTime() - a.at.getTime() || a.item.id.localeCompare(b.item.id)).slice(0,MAX_ITEMS).map(x => x.item);
}

export async function historyEntry(client: PoolClient, schoolId: string, learnerId: string, kind: string, id: string, staff: boolean) {
  if (kind === 'practice') {
    const session = (await client.query(`SELECT p.id,p.completed_at,p.level,p.correct,p.outcome,p.level_after,(p.study_session_id IS NOT NULL) AS after_study,s.name AS subject,i.description AS topic
      FROM practice_sessions p JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE p.school_id=$1 AND p.learner_id=$2 AND p.id=$3 AND p.completed_at IS NOT NULL`,[schoolId,learnerId,id])).rows[0];
    if (!session) throw new NotFoundException('That practice is not in the history');
    const questions = (await client.query(`SELECT it.position,it.given,it.correct,q.kind,q.prompt,q.options,q.correct_option,q.answer_number::float AS answer,q.explanation,(q.retired_at IS NOT NULL) AS withdrawn,(ps.source='generated') AS made_by_ai
      FROM practice_session_items it JOIN practice_questions q ON q.school_id=it.school_id AND q.id=it.question_id JOIN practice_sets ps ON ps.school_id=q.school_id AND ps.id=q.set_id
      WHERE it.school_id=$1 AND it.session_id=$2 ORDER BY it.position`,[schoolId,id])).rows;
    // A question taken out since (reported or retired) keeps its words and what the child chose, but not its answer key or explanation.
    return {kind:'practice' as const,id:session.id as string,on:dayOf(session.completed_at),subject:session.subject as string,topic:session.topic as string,level:session.level as number,
      correct:session.correct as number,total:SESSION_SIZE,outcome:session.outcome as string,levelAfter:session.level_after as number,afterStudy:session.after_study as boolean,
      madeByAi:questions.some(q => q.made_by_ai),label:AI_LABEL,
      questions:questions.map(q => ({position:q.position as number,prompt:q.prompt as string,kind:q.kind as 'choice' | 'number',options:q.kind === 'choice' ? q.options as string[] : null,
        given:q.kind === 'choice' ? Number(q.given) : q.given as string,withdrawn:q.withdrawn as boolean,
        correct:q.withdrawn ? null : q.correct as boolean,correctOption:!q.withdrawn && q.kind === 'choice' ? q.correct_option as number : null,
        correctNumber:!q.withdrawn && q.kind === 'number' ? q.answer as number : null,explanation:q.withdrawn ? null : q.explanation as string | null}))};
  }
  if (kind === 'study') {
    const row = (await client.query(`SELECT st.id,st.finished_at,${minutesOf} AS minutes,s.name AS subject,i.description AS topic,l.body,(l.retired_at IS NOT NULL) AS withdrawn,c.id AS check_id,c.correct AS check_correct
      FROM study_sessions st JOIN curriculum_indicators i ON i.school_id=st.school_id AND i.id=st.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      JOIN topic_lessons l ON l.school_id=st.school_id AND l.id=st.lesson_id
      LEFT JOIN LATERAL (SELECT p.id,p.correct FROM practice_sessions p WHERE p.school_id=st.school_id AND p.study_session_id=st.id AND p.completed_at IS NOT NULL ORDER BY p.completed_at DESC LIMIT 1) c ON true
      WHERE st.school_id=$1 AND st.learner_id=$2 AND st.id=$3 AND st.finished_at IS NOT NULL`,[schoolId,learnerId,id])).rows[0];
    if (!row) throw new NotFoundException('That lesson is not in the history');
    return {kind:'study' as const,id:row.id as string,on:dayOf(row.finished_at),subject:row.subject as string,topic:row.topic as string,label:AI_LABEL,withdrawn:row.withdrawn as boolean,
      lesson:row.withdrawn ? null : row.body as { goal: string; steps: { heading: string; text: string }[]; example: { problem: string; working: string }; recap: string[] },
      check:row.check_id === null ? null : {sessionId:row.check_id as string,correct:row.check_correct as number,total:SESSION_SIZE},...(staff ? {minutes:row.minutes as number} : {})};
  }
  throw new NotFoundException('That is not in the history');
}
