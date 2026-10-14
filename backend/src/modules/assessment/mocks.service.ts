import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { MockRoundDto } from './assessment.dto';
import { AssessmentService } from './assessment.service';
import { PASS_LINE, mean } from './progress.service';

// A learner is listed for support when two or more subjects in the latest mock are below the pass line. This is a
// school-internal prompt, not a prediction of official BECE grades.
export const RISK_SUBJECTS = 2;

@Injectable()
export class MocksService {
  constructor(private readonly assessment: AssessmentService) {}

  createRound(client: PoolClient, actor: Actor, classId: string, body: MockRoundDto) {
    return command(client,actor,body.operationId,'assessment.mock_round',{classId,...body},async () => {
      await this.assessment.classFor(client,actor,classId);
      const term = await this.assessment.term(client,actor.schoolId,body.termId);
      if (body.heldOn < term.start_date || body.heldOn > term.end_date) throw new BadRequestException('The mock date must fall inside the term');
      const subjectIds = [...new Set(body.subjectIds)];
      if ((await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[])',[actor.schoolId,subjectIds])).rowCount !== subjectIds.length) throw new NotFoundException('Subject unavailable');
      const title = body.title.trim();
      if ((await client.query(`SELECT 1 FROM class_assessments a JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id
        WHERE a.school_id=$1 AND a.class_id=$2 AND a.kind='mock' AND lower(a.title)=lower($3) AND t.academic_year_id=(SELECT academic_year_id FROM terms WHERE school_id=$1 AND id=$4)`,[actor.schoolId,classId,title,body.termId])).rowCount)
        throw new ConflictException(`This class already has a mock called "${title}" this year`);
      const ids: string[] = [];
      for (const subjectId of subjectIds) {
        const id = randomUUID(); ids.push(id);
        await client.query(`INSERT INTO class_assessments(id,school_id,term_id,class_id,subject_id,kind,title,held_on,max_mark,created_by) VALUES($1,$2,$3,$4,$5,'mock',$6,$7,$8,$9)`,
          [id,actor.schoolId,body.termId,classId,subjectId,title,body.heldOn,body.maxMark,actor.membershipId]);
      }
      await audit(client,actor,'assessment.mock_round.created',classId,{title,subjects:ids.length});
      return {title,assessments:ids.length};
    });
  }

  // Every mock round this class sat in its academic year, each learner's subject percentages per round, and the
  // latest round's readiness: average, change from the round before, and subjects below the pass line.
  async rounds(client: PoolClient, actor: Actor, classId: string) {
    const section = await this.assessment.classFor(client,actor,classId);
    const assessments = (await client.query(`SELECT a.id,a.title,a.held_on::text,a.term_id,a.subject_id,s.name AS subject_name,a.max_mark::float FROM class_assessments a
      JOIN subjects s ON s.school_id=a.school_id AND s.id=a.subject_id
      WHERE a.school_id=$1 AND a.class_id=$2 AND a.kind='mock' ORDER BY a.held_on,lower(a.title),s.name`,[actor.schoolId,classId])).rows;
    const marks = (await client.query(`SELECT DISTINCT ON (x.assessment_id,x.learner_id) x.assessment_id,x.learner_id,x.mark::float FROM class_assessment_marks x
      WHERE x.school_id=$1 AND x.assessment_id=ANY($2::uuid[]) ORDER BY x.assessment_id,x.learner_id,x.created_at DESC,x.id DESC`,[actor.schoolId,assessments.map(a => a.id)])).rows;
    const keys = [...new Set(assessments.map(a => (a.title as string).toLowerCase()))];
    const rounds = keys.map(key => {
      const own = assessments.filter(a => a.title.toLowerCase() === key);
      return {key,title:own[0].title as string,heldOn:own[0].held_on as string,termId:own[0].term_id as string,subjects:own.map(a => ({assessmentId:a.id as string,subjectId:a.subject_id as string,name:a.subject_name as string,maxMark:a.max_mark as number}))};
    });
    const latestTerm = rounds.length ? rounds[rounds.length - 1]!.termId : null;
    const term = latestTerm ? (await client.query('SELECT start_date::text,end_date::text FROM terms WHERE school_id=$1 AND id=$2',[actor.schoolId,latestTerm])).rows[0] : null;
    const learners = term ? (await this.assessment.learners(client,actor.schoolId,classId,term)).filter(l => !l.left) : [];
    const percent = (assessmentId: string, learnerId: string, max: number) => { const m = marks.find(x => x.assessment_id === assessmentId && x.learner_id === learnerId); return m ? Math.round(m.mark * 1000 / max) / 10 : null; };
    const rows = learners.map(l => {
      const perRound = rounds.map(r => {
        const subjects = r.subjects.map(s => ({subjectId:s.subjectId,name:s.name,percent:percent(s.assessmentId,l.id,s.maxMark)}));
        const taken = subjects.filter(s => s.percent !== null);
        return {key:r.key,average:mean(taken.map(s => s.percent!)),subjects,below:taken.filter(s => s.percent! < PASS_LINE).map(s => s.name),taken:taken.length};
      });
      const sat = perRound.filter(r => r.taken > 0), latest = sat[sat.length - 1], previous = sat[sat.length - 2];
      return {learnerId:l.id,fullName:l.full_name,rounds:perRound,
        latest:latest ? {key:latest.key,average:latest.average,change:previous && latest.average !== null && previous.average !== null ? Math.round((latest.average - previous.average) * 10) / 10 : null,below:latest.below,atRisk:latest.below.length >= RISK_SUBJECTS} : null};
    }).sort((a,b) => (a.latest?.average ?? 101) - (b.latest?.average ?? 101));
    const summary = rounds.map(r => { const own = rows.map(x => x.rounds.find(y => y.key === r.key)!).filter(x => x.taken > 0);
      return {key:r.key,average:mean(own.map(x => x.average!)),sat:own.length,atRisk:own.filter(x => x.below.length >= RISK_SUBJECTS).length}; });
    return {class:section,rounds,summary,learners:rows,riskSubjects:RISK_SUBJECTS,passLine:PASS_LINE};
  }
}
