import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { SharingDto } from './assessment.dto';
import { DROP, PASS_LINE, RECENT, attentionFor, mean } from './progress.service';

const todayInAccra = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// A subject's direction for families, in plain words, from the current term's marks (oldest first).
export function familyStatus(percents: number[]) {
  if (percents.length < RECENT) return 'not_enough' as const;
  if (attentionFor(percents)) return 'needs_attention' as const;
  const recent = mean(percents.slice(-RECENT))!, earlier = mean(percents.slice(0, -RECENT));
  return earlier !== null && recent >= earlier + DROP / 2 && recent >= PASS_LINE ? 'improving' as const : 'steady' as const;
}

@Injectable()
export class FamilyService {
  async sharing(client: PoolClient, schoolId: string) {
    const row = (await client.query('SELECT share_with_families,version,updated_at FROM progress_sharing WHERE school_id=$1',[schoolId])).rows[0];
    return row ? {shareWithFamilies:row.share_with_families as boolean,version:row.version as number,updatedAt:row.updated_at} : {shareWithFamilies:false,version:null,updatedAt:null};
  }
  setSharing(client: PoolClient, actor: Actor, body: SharingDto) {
    return command(client,actor,body.operationId,'assessment.sharing',body,async () => {
      const current = await this.sharing(client,actor.schoolId);
      if (current.version !== null && body.version !== current.version) throw new ConflictException('This setting changed. Reload before saving');
      const row = current.version === null
        ? (await client.query('INSERT INTO progress_sharing(school_id,share_with_families,updated_by) VALUES($1,$2,$3) RETURNING share_with_families,version',[actor.schoolId,body.shareWithFamilies,actor.membershipId])).rows[0]
        : (await client.query('UPDATE progress_sharing SET share_with_families=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE school_id=$1 RETURNING share_with_families,version',[actor.schoolId,body.shareWithFamilies,actor.membershipId])).rows[0];
      await audit(client,actor,'assessment.sharing.saved',actor.schoolId,{shareWithFamilies:row.share_with_families,version:row.version});
      return {shareWithFamilies:row.share_with_families,version:row.version};
    });
  }

  // One child's progress for a verified academic guardian. Published term results always; class-assessment trends,
  // a plain status per subject and home-help notes only when the school shares progress with families.
  async childProgress(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT 1 FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL',[actor.schoolId,learnerId,actor.membershipId])).rowCount;
    if (!link) throw new NotFoundException('Child unavailable');
    const shared = (await this.sharing(client,actor.schoolId)).shareWithFamilies;
    const reports = (await client.query(`SELECT r.term_id,t.name AS term_name,y.name AS year_name,t.start_date::text,r.snapshot FROM (
        SELECT DISTINCT ON (term_id) term_id,snapshot FROM terminal_reports WHERE school_id=$1 AND learner_id=$2 ORDER BY term_id,revision DESC) r
      JOIN terms t ON t.school_id=$1 AND t.id=r.term_id JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id ORDER BY t.start_date`,[actor.schoolId,learnerId])).rows;
    const terms = reports.map(r => ({termId:r.term_id,label:`${r.term_name} ${r.year_name}`,average:r.snapshot.average ?? null}));
    const subjectNames = [...new Set(reports.flatMap(r => (r.snapshot.subjects ?? []).map((s: { name: string }) => s.name)))].sort();
    const termResults = {terms,subjects:subjectNames.map(name => ({name,points:reports.map(r => ({termId:r.term_id,total:(r.snapshot.subjects ?? []).find((s: { name: string }) => s.name === name)?.total ?? null}))}))};
    if (!shared) return {shared,termResults};

    const today = todayInAccra();
    const term = (await client.query('SELECT id FROM terms WHERE school_id=$1 AND start_date<=$2 AND end_date>=$2 ORDER BY start_date DESC LIMIT 1',[actor.schoolId,today])).rows[0];
    const marks = (await client.query(`SELECT s.name AS subject,a.term_id,a.held_on::text,round(m.mark*100/a.max_mark,1)::float AS percent FROM class_assessments a
      JOIN subjects s ON s.school_id=a.school_id AND s.id=a.subject_id
      JOIN LATERAL (SELECT x.mark FROM class_assessment_marks x WHERE x.school_id=a.school_id AND x.assessment_id=a.id AND x.learner_id=$2 ORDER BY x.created_at DESC,x.id DESC LIMIT 1) m ON true
      WHERE a.school_id=$1 AND a.kind<>'mock' AND a.held_on>=$3 AND a.held_on<=$4 ORDER BY a.held_on,a.created_at,a.id`,[actor.schoolId,learnerId,addDays(today,-183),today])).rows as { subject: string; term_id: string; held_on: string; percent: number }[];
    const months = [...new Set(marks.map(m => `${m.held_on.slice(0,7)}-01`))].sort();
    const names = [...new Set(marks.map(m => m.subject))].sort();
    const subjects = names.map(name => {
      const own = marks.filter(m => m.subject === name);
      return {name,status:familyStatus(own.filter(m => m.term_id === term?.id).map(m => m.percent)),months:months.map(month => ({month,average:mean(own.filter(m => m.held_on.startsWith(month.slice(0,7))).map(m => m.percent))}))};
    });
    const plans = (await client.query(`SELECT p.id,s.name AS subject,i.description AS topic,p.indicator_id,p.family_note,p.owner_name FROM support_plans p
      JOIN support_plan_learners x ON x.school_id=p.school_id AND x.plan_id=p.id AND x.learner_id=$2 JOIN subjects s ON s.school_id=p.school_id AND s.id=p.subject_id
      LEFT JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id
      WHERE p.school_id=$1 AND p.family_note IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_plan_reviews r WHERE r.school_id=p.school_id AND r.plan_id=p.id AND r.decision='close')
      ORDER BY p.created_at DESC`,[actor.schoolId,learnerId])).rows;
    const resources = (await client.query(`SELECT indicator_id,kind,title,detail,url FROM indicator_resources WHERE school_id=$1 AND indicator_id=ANY($2::uuid[]) AND for_families AND retired_at IS NULL ORDER BY created_at,id`,
      [actor.schoolId,plans.flatMap(p => p.indicator_id ? [p.indicator_id] : [])])).rows;
    const help = plans.map(p => ({subject:p.subject,topic:p.topic,note:p.family_note,teacher:p.owner_name,practice:resources.filter(r => r.indicator_id === p.indicator_id).map(({indicator_id: _, ...r}) => r)}));
    return {shared,termResults,months,subjects,help};
  }
}
