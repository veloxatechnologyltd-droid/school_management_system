import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { ApproveNoticeDto, CancelNoticeDto, NoticeDto, RetryDto } from './notices.dto';

const counts = `(SELECT coalesce(jsonb_object_agg(state,n),'{}'::jsonb) FROM (SELECT state,count(*)::int AS n FROM notice_deliveries d WHERE d.school_id=n.school_id AND d.notice_id=n.id GROUP BY state) s)`;

@Injectable()
export class NoticesService {
  private async notice(client: PoolClient, schoolId: string, id: string, lock = false) {
    const row = (await client.query(`SELECT id,title,body,audience,class_id,term_id,status,version FROM notices WHERE school_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,[schoolId,id])).rows[0];
    if (!row) throw new NotFoundException('Notice unavailable');
    return row;
  }
  create(client: PoolClient, actor: Actor, body: NoticeDto) {
    return command(client,actor,body.operationId,'notice.create',body,async () => {
      if (body.audience === 'class' && !(await client.query('SELECT 1 FROM class_sections WHERE school_id=$1 AND id=$2',[actor.schoolId,body.classId])).rowCount) throw new NotFoundException('Class unavailable');
      if (body.audience === 'owing' && !(await client.query('SELECT 1 FROM terms WHERE school_id=$1 AND id=$2',[actor.schoolId,body.termId])).rowCount) throw new NotFoundException('Term unavailable');
      const row = (await client.query("INSERT INTO notices(id,school_id,title,body,audience,class_id,term_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,title,body,audience,class_id,term_id,status,version",[randomUUID(),actor.schoolId,body.title.trim(),body.body.trim(),body.audience,body.audience === 'class' ? body.classId : null,body.audience === 'owing' ? body.termId : null,actor.membershipId])).rows[0];
      await audit(client,actor,'notice.created',row.id,{audience:body.audience});
      return row;
    });
  }
  async list(client: PoolClient, schoolId: string) {
    return (await client.query(`SELECT n.id,n.title,n.body,n.audience,n.class_id,c.name AS class_name,n.term_id,t.name AS term_name,n.status,n.version,n.created_at,n.approved_at,${counts} AS deliveries
      FROM notices n LEFT JOIN class_sections c ON c.school_id=n.school_id AND c.id=n.class_id LEFT JOIN terms t ON t.school_id=n.school_id AND t.id=n.term_id WHERE n.school_id=$1 ORDER BY n.created_at DESC,n.id LIMIT 50`,[schoolId])).rows;
  }
  // The recipient list is frozen here: guardians who gain rights later are not added to an already approved notice.
  approve(client: PoolClient, actor: Actor, id: string, body: ApproveNoticeDto) {
    return command(client,actor,body.operationId,'notice.approve',{id,version:body.version},async () => {
      const notice = await this.notice(client,actor.schoolId,id,true);
      if (notice.status !== 'draft') throw new ConflictException('Only a draft notice can be approved');
      if (notice.version !== body.version) throw new ConflictException('The notice changed; reload it before approving');
      const recipients = (notice.audience === 'owing'
        ? await client.query('SELECT guardian_membership_id,phone FROM notice_recipients_owing($1)',[notice.term_id])
        : await client.query('SELECT guardian_membership_id,phone FROM notice_recipients($1)',[notice.class_id])).rows;
      if (!recipients.length) throw new BadRequestException('No guardian with a verified contact right is linked to a current learner in this audience');
      for (const recipient of recipients) await client.query('INSERT INTO notice_deliveries(id,school_id,notice_id,guardian_membership_id,to_phone,state) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,id,recipient.guardian_membership_id,recipient.phone,recipient.phone ? 'queued' : 'in_app_only']);
      await client.query("UPDATE notices SET status='approved',version=version+1,approved_by=$3,approved_at=now() WHERE school_id=$1 AND id=$2",[actor.schoolId,id,actor.membershipId]);
      const summary = {recipients:recipients.length,withPhone:recipients.filter(r => r.phone).length};
      await audit(client,actor,'notice.approved',id,summary);
      return {id,status:'approved',...summary};
    });
  }
  cancel(client: PoolClient, actor: Actor, id: string, body: CancelNoticeDto) {
    return command(client,actor,body.operationId,'notice.cancel',{id,reason:body.reason},async () => {
      const notice = await this.notice(client,actor.schoolId,id,true);
      if (notice.status === 'cancelled') throw new ConflictException('Notice is already cancelled');
      const stopped = (await client.query("UPDATE notice_deliveries SET state='cancelled',updated_at=now() WHERE school_id=$1 AND notice_id=$2 AND state='queued'",[actor.schoolId,id])).rowCount;
      await client.query("UPDATE notices SET status='cancelled',version=version+1 WHERE school_id=$1 AND id=$2",[actor.schoolId,id]);
      await audit(client,actor,'notice.cancelled',id,{reason:body.reason.trim(),unsentStopped:stopped});
      return {id,status:'cancelled',unsentStopped:stopped};
    });
  }
  // Failed SMS are never resent automatically; the headteacher decides. Messages left unresolved as "sending" are not touched.
  retry(client: PoolClient, actor: Actor, id: string, body: RetryDto) {
    return command(client,actor,body.operationId,'notice.retry',{id},async () => {
      const notice = await this.notice(client,actor.schoolId,id,true);
      if (notice.status !== 'approved') throw new ConflictException('Only an approved notice can be resent');
      const count = (await client.query("UPDATE notice_deliveries SET state='queued',last_error=NULL,updated_at=now() WHERE school_id=$1 AND notice_id=$2 AND state='failed' AND to_phone IS NOT NULL",[actor.schoolId,id])).rowCount;
      await audit(client,actor,'notice.retry',id,{requeued:count});
      return {id,requeued:count};
    });
  }
  // Phone numbers are shown only as the last three digits.
  async deliveries(client: PoolClient, schoolId: string, id: string) {
    await this.notice(client,schoolId,id);
    return (await client.query(`SELECT d.id,coalesce((SELECT min(g.guardian_display_name) FROM guardian_links g WHERE g.school_id=d.school_id AND g.guardian_membership_id=d.guardian_membership_id),'Guardian') AS guardian,
      CASE WHEN d.to_phone IS NULL THEN NULL ELSE '••••••'||right(d.to_phone,3) END AS phone,d.state,d.attempts,d.last_error FROM notice_deliveries d WHERE d.school_id=$1 AND d.notice_id=$2 ORDER BY d.state,d.id LIMIT 500`,[schoolId,id])).rows;
  }
  // Guardians see only notices delivered to their own membership.
  async mine(client: PoolClient, actor: Actor) {
    return (await client.query(`SELECT n.id,n.title,n.body,n.approved_at FROM notice_deliveries d JOIN notices n ON n.school_id=d.school_id AND n.id=d.notice_id
      WHERE d.school_id=$1 AND d.guardian_membership_id=$2 AND n.status='approved' ORDER BY n.approved_at DESC,n.id LIMIT 50`,[actor.schoolId,actor.membershipId])).rows;
  }
}
