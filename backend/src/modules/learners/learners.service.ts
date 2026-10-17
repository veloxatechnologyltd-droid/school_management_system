import { BadRequestException,ConflictException,Injectable,NotFoundException,ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { normalizeGhanaPhone } from '../notices/sms.provider';
import { AdmissionDto,AdmissionNoteDto,AdmissionPageDto,ClassDto,ClassPageDto,PageDto,TransferDto,TransitionDto,WithdrawalDto,LearnerSexDto,YearDto } from './learners.dto';
@Injectable()
export class LearnersService {
  async lockIdentityCatalog(client:PoolClient,schoolId:string){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${schoolId}:learner-identity-catalog`]);}
  async page(client:PoolClient,schoolId:string,table:'learners'|'admissions',page:AdmissionPageDto) {
    const search=`%${(page.search??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
    // Applications can be narrowed to a stage: open (still being decided), enrolled or declined.
    const stages={open:" AND a.status NOT IN ('enrolled','declined')",enrolled:" AND a.status='enrolled'",declined:" AND a.status='declined'"};
    const stage=table==='admissions'&&page.stage?stages[page.stage]:'';
    const filter=`a.school_id=$1 AND (a.full_name ILIKE $2 ESCAPE '\\' OR a.admission_number ILIKE $2 ESCAPE '\\')${stage}`;
    const total=Number((await client.query(`SELECT count(*) FROM ${table} a WHERE ${filter}`,[schoolId,search])).rows[0].count);
    // The roll shows each learner's class today, or when they left.
    const today="(now() AT TIME ZONE 'Africa/Accra')::date";
    const select=table==='learners'?`a.id,a.full_name,a.admission_number,a.date_of_birth::text,a.sex,a.version,
      (SELECT c.name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=a.school_id AND e.learner_id=a.id AND e.superseded_at IS NULL AND e.start_date<=${today} AND (e.end_date IS NULL OR e.end_date>${today}) LIMIT 1) AS class_name,
      (SELECT max(e.end_date)::text FROM enrolments e WHERE e.school_id=a.school_id AND e.learner_id=a.id AND e.superseded_at IS NULL AND e.end_date<=${today}) AS left_on`:'a.id,a.full_name,a.date_of_birth::text,a.status,a.class_id,c.name AS class_name,a.start_date::text,a.admission_number,a.version,a.learner_id,a.decision_reason';
    const join=table==='admissions'?'JOIN class_sections c ON c.school_id=a.school_id AND c.id=a.class_id':'';
    const order=table==='admissions'?'a.created_at DESC,a.id':'a.full_name,a.id';
    const items=(await client.query(`SELECT ${select} FROM ${table} a ${join} WHERE ${filter} ORDER BY ${order} LIMIT $3 OFFSET $4`,[schoolId,search,page.limit,page.offset])).rows;
    return {items,total,limit:page.limit,offset:page.offset};
  }
  async years(client:PoolClient,schoolId:string,page:PageDto) {
    const total=Number((await client.query('SELECT count(*) FROM academic_years WHERE school_id=$1',[schoolId])).rows[0].count);
    const items=(await client.query('SELECT id,name,start_date::text,end_date::text FROM academic_years WHERE school_id=$1 ORDER BY start_date DESC,id LIMIT $2 OFFSET $3',[schoolId,page.limit,page.offset])).rows;
    return {items,total,limit:page.limit,offset:page.offset};
  }
  async classes(client:PoolClient,schoolId:string,page:ClassPageDto) {
    const filter='c.school_id=$1 AND ($2::uuid IS NULL OR c.academic_year_id=$2)',values=[schoolId,page.academicYearId??null];
    const total=Number((await client.query(`SELECT count(*) FROM class_sections c WHERE ${filter}`,values)).rows[0].count);
    const items=(await client.query(`SELECT c.id,c.name,c.level,c.capacity,c.academic_year_id,y.name AS year_name,y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE ${filter} ORDER BY y.start_date DESC,c.name,c.id LIMIT $3 OFFSET $4`,[...values,page.limit,page.offset])).rows;
    return {items,total,limit:page.limit,offset:page.offset};
  }
  async classForDate(client:PoolClient,schoolId:string,classId:string,date:string) {
    const result=await client.query('SELECT c.*,y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 FOR UPDATE OF c',[schoolId,classId]);
    if(!result.rowCount)throw new NotFoundException('Class unavailable');
    const section=result.rows[0];
    if(date<section.start_date||date>=section.end_date)throw new BadRequestException('Enrolment date must be inside the class academic year');
    return section;
  }
  async ensureCapacity(client:PoolClient,actor:Actor,section:any,start:string,override?:string) {
    // Every class write takes this class lock. Check the entire remaining year, including scheduled transfers.
    const events=await client.query("SELECT start_date::text AS date,1 AS delta FROM enrolments WHERE school_id=$1 AND class_id=$2 AND superseded_at IS NULL AND start_date<$4 AND (end_date IS NULL OR end_date>$3) UNION ALL SELECT end_date::text AS date,-1 AS delta FROM enrolments WHERE school_id=$1 AND class_id=$2 AND superseded_at IS NULL AND end_date>$3 AND end_date<$4 ORDER BY date,delta",[actor.schoolId,section.id,start,section.end_date]);
    let occupancy=0,maxOccupancy=0;
    // Existing enrolments that started before the new start contribute to initial occupancy.
    for(const event of events.rows){occupancy+=event.delta;maxOccupancy=Math.max(maxOccupancy,occupancy);}
    if(maxOccupancy>=section.capacity) {
      if(!override)throw new ConflictException('Class capacity would be exceeded. A headteacher override needs a reason');
      if(actor.role!=='headteacher')throw new ForbiddenException('Only the headteacher can override capacity');
    }else if(override&&actor.role!=='headteacher')throw new ForbiddenException('Only the headteacher can record a capacity override');
  }
  createYear(client:PoolClient,actor:Actor,body:YearDto) {
    return command(client,actor,body.operationId,'calendar.year.create',body,async()=>{
      if(body.startDate>=body.endDate)throw new BadRequestException('Academic year end must follow its start');
      const result=await client.query('INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING id,name,start_date::text,end_date::text',[randomUUID(),actor.schoolId,body.name.trim(),body.startDate,body.endDate]);
      await audit(client,actor,'calendar.year.created',result.rows[0].id);return result.rows[0];
    });
  }
  createClass(client:PoolClient,actor:Actor,body:ClassDto) {
    return command(client,actor,body.operationId,'class.create',body,async()=>{
      const year=await client.query('SELECT id FROM academic_years WHERE school_id=$1 AND id=$2',[actor.schoolId,body.academicYearId]);
      if(!year.rowCount)throw new NotFoundException('Academic year unavailable');
      const result=await client.query('INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),actor.schoolId,body.academicYearId,body.name.trim(),body.level,body.capacity]);
      await audit(client,actor,'class.created',result.rows[0].id);return result.rows[0];
    });
  }
  createAdmission(client:PoolClient,actor:Actor,body:AdmissionDto) {
    return command(client,actor,body.operationId,'admission.create',body,async()=>{
      await this.lockIdentityCatalog(client,actor.schoolId);
      await this.classForDate(client,actor.schoolId,body.classId,body.startDate);
      if(body.dateOfBirth&&body.dateOfBirth>=body.startDate)throw new BadRequestException('Birth date must precede enrolment');
      const existing=await client.query('SELECT id FROM learners WHERE school_id=$1 AND admission_number=$2',[actor.schoolId,body.admissionNumber]);
      if(existing.rowCount)throw new ConflictException('Admission number already belongs to a learner');
      const guardianName=body.guardianName?.trim()||null,phone=body.guardianPhone?.trim()?normalizeGhanaPhone(body.guardianPhone):null;
      if(body.guardianPhone?.trim()&&!phone)throw new BadRequestException('Enter a Ghana mobile number, for example 024 123 4567');
      if(!guardianName&&(body.guardianRelationship?.trim()||phone))throw new BadRequestException('Give the parent or guardian\'s name with their relationship or phone');
      const result=await client.query('INSERT INTO admissions(id,school_id,full_name,date_of_birth,class_id,start_date,admission_number,sex,guardian_name,guardian_relationship,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,full_name,status,version',[randomUUID(),actor.schoolId,body.fullName.trim(),body.dateOfBirth??null,body.classId,body.startDate,body.admissionNumber,body.sex??null,guardianName,guardianName?body.guardianRelationship?.trim()||null:null,phone]);
      await audit(client,actor,'admission.created',result.rows[0].id);return result.rows[0];
    });
  }
  transition(client:PoolClient,actor:Actor,id:string,body:TransitionDto) {
    return command(client,actor,body.operationId,'admission.transition',{id,...body},async()=>{
      const application=await client.query('SELECT *,start_date::text,date_of_birth::text FROM admissions WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id]);
      if(!application.rowCount)throw new NotFoundException('Application unavailable');
      const record=application.rows[0];if(record.version!==body.version)throw new ConflictException('Application changed. Reload before continuing');
      const transitions:Record<string,Record<string,string>>={application:{review:'review'},review:{offer:'offered',waitlist:'waitlisted',decline:'declined'},waitlisted:{offer:'offered',decline:'declined'},offered:{accept:'accepted'},accepted:{enrol:'enrolled'}};
      const next=transitions[record.status]?.[body.action];if(!next)throw new ConflictException('This action is not available in the current application state');
      if(['waitlist','decline'].includes(body.action)&&!body.reason)throw new BadRequestException('A decision reason is required');
      if(body.action!=='enrol'&&body.capacityOverrideReason)throw new BadRequestException('Capacity overrides apply only to enrolment');
      let learnerId:string|null=null;
      if(next==='enrolled') {
        await this.lockIdentityCatalog(client,actor.schoolId);
        const section=await this.classForDate(client,actor.schoolId,record.class_id,record.start_date);
        await this.ensureCapacity(client,actor,section,record.start_date,body.capacityOverrideReason);
        learnerId=randomUUID();
        await client.query('INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth,sex) VALUES($1,$2,$3,$4,$5,$6)',[learnerId,actor.schoolId,record.admission_number,record.full_name,record.date_of_birth,record.sex]);
        await client.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.schoolId,learnerId,record.class_id,record.start_date]);
      }
      const result=await client.query('UPDATE admissions SET status=$1,version=version+1,learner_id=$2,decision_reason=COALESCE($3,decision_reason) WHERE school_id=$4 AND id=$5 RETURNING id,status,version,learner_id',[next,learnerId,body.reason??null,actor.schoolId,id]);
      await audit(client,actor,`admission.${next}`,id,{version:result.rows[0].version,capacityOverride:!!body.capacityOverrideReason,...(body.reason?{reason:body.reason}:{})});
      if(body.capacityOverrideReason)await audit(client,actor,'class.capacity.override',record.class_id,{reason:body.capacityOverrideReason,applicationId:id});
      return result.rows[0];
    });
  }
  // One application on one page: who applied for which class, the family's contact, every decision with who made it
  // and when (from the audit log), staff notes, and the parent accounts linked once the student is enrolled.
  async admission(client:PoolClient,schoolId:string,id:string) {
    const row=(await client.query(`SELECT a.id,a.full_name,a.date_of_birth::text,a.sex,a.status,a.class_id,c.name AS class_name,c.level,y.name AS year_name,a.start_date::text,a.admission_number,a.version,a.learner_id,a.decision_reason,
        a.guardian_name,a.guardian_relationship,a.guardian_phone,a.created_at
      FROM admissions a JOIN class_sections c ON c.school_id=a.school_id AND c.id=a.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id
      WHERE a.school_id=$1 AND a.id=$2`,[schoolId,id])).rows[0];
    if(!row)throw new NotFoundException('Application unavailable');
    const names=new Map((await client.query('SELECT membership_id,display_name FROM admission_actor_names($1)',[id])).rows.map(r=>[r.membership_id as string,r.display_name as string]));
    const timeline=(await client.query(`SELECT action,created_at,actor_membership_id,metadata FROM audit_events WHERE school_id=$1 AND target_id=$2
        AND action IN ('admission.created','admission.review','admission.offered','admission.waitlisted','admission.declined','admission.accepted','admission.enrolled') ORDER BY created_at,id`,[schoolId,id])).rows
      .map(e=>({step:e.action.slice('admission.'.length),at:e.created_at,by:names.get(e.actor_membership_id)??null,reason:e.metadata?.reason??null,capacityOverride:!!e.metadata?.capacityOverride}));
    const notes=(await client.query('SELECT id,note,author_name,created_at FROM admission_notes WHERE school_id=$1 AND admission_id=$2 ORDER BY created_at DESC,id',[schoolId,id])).rows;
    const parents=row.learner_id?(await client.query(`SELECT guardian_display_name AS name,verified_at IS NOT NULL AS verified FROM guardian_links
        WHERE school_id=$1 AND learner_id=$2 AND revoked_at IS NULL ORDER BY verified_at IS NULL,created_at,id`,[schoolId,row.learner_id])).rows:[];
    return {...row,timeline,notes,parents};
  }
  addAdmissionNote(client:PoolClient,actor:Actor,id:string,body:AdmissionNoteDto) {
    return command(client,actor,body.operationId,'admission.note',{id,...body},async()=>{
      const exists=await client.query('SELECT 1 FROM admissions WHERE school_id=$1 AND id=$2',[actor.schoolId,id]);
      if(!exists.rowCount)throw new NotFoundException('Application unavailable');
      const note=(await client.query('INSERT INTO admission_notes(id,school_id,admission_id,note,author_membership_id,author_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,note,author_name,created_at',[randomUUID(),actor.schoolId,id,body.note.trim(),actor.membershipId,actor.displayName??'Staff member'])).rows[0];
      await audit(client,actor,'admission_note.added',id,{noteId:note.id});
      return note;
    });
  }
  async learner(client:PoolClient,schoolId:string,id:string,lock=false) {
    const result=await client.query(`SELECT id,full_name,admission_number,date_of_birth::text,sex,version FROM learners WHERE school_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[schoolId,id]);
    if(!result.rowCount)throw new NotFoundException('Learner unavailable');
    const enrolments=await client.query('SELECT e.id,e.class_id,c.name AS class_name,e.start_date::text,e.end_date::text,e.end_reason,e.superseded_at,e.supersession_reason FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=$1 AND e.learner_id=$2 ORDER BY e.start_date,e.id',[schoolId,id]);
    return {...result.rows[0],enrolments:enrolments.rows};
  }
  setSex(client:PoolClient,actor:Actor,id:string,body:LearnerSexDto) {
    return command(client,actor,body.operationId,'learner.sex',{id,...body},async()=>{
      const learner=await this.learner(client,actor.schoolId,id,true);
      if(learner.version!==body.version)throw new ConflictException('Learner changed. Reload before saving');
      const result=await client.query('UPDATE learners SET sex=$1,version=version+1 WHERE school_id=$2 AND id=$3 RETURNING id,sex,version',[body.sex,actor.schoolId,id]);
      await audit(client,actor,'learner.sex.recorded',id,{sex:body.sex,previous:learner.sex});return result.rows[0];
    });
  }
  withdraw(client:PoolClient,actor:Actor,id:string,body:WithdrawalDto) {
    return command(client,actor,body.operationId,'learner.withdraw',{id,...body},async()=>{
      const learner=await this.learner(client,actor.schoolId,id,true);
      if(learner.version!==body.version)throw new ConflictException('Learner changed. Reload before withdrawing');
      const active=learner.enrolments.filter((row:any)=>!row.superseded_at);
      if(!active.some((row:any)=>row.end_date===null))throw new ConflictException('No open enrolment to withdraw');
      if(body.effectiveDate<=active[0].start_date)throw new BadRequestException('Withdrawal must follow the first enrolment start');
      const affected=active.filter((row:any)=>!row.end_date||row.end_date>body.effectiveDate);
      // Stable class locks serialize supersession with capacity and opposite transfers.
      await client.query('SELECT id FROM class_sections WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[actor.schoolId,affected.map((row:any)=>row.class_id)]);
      const supersededIds:string[]=[];
      for(const row of affected) {
        if(row.start_date<body.effectiveDate&&row.end_date===null) {
          await client.query('UPDATE enrolments SET end_date=$1,end_reason=$2 WHERE school_id=$3 AND id=$4',[body.effectiveDate,body.reason,actor.schoolId,row.id]);
        }else{
          await client.query('UPDATE enrolments SET superseded_at=now(),supersession_reason=$1 WHERE school_id=$2 AND id=$3',[body.reason,actor.schoolId,row.id]);
          supersededIds.push(row.id);
          if(row.start_date<body.effectiveDate)await client.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date,end_date,end_reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),actor.schoolId,id,row.class_id,row.start_date,body.effectiveDate,body.reason]);
        }
      }
      await client.query('UPDATE learners SET version=version+1 WHERE school_id=$1 AND id=$2',[actor.schoolId,id]);
      await audit(client,actor,'learner.withdrawn',id,{effectiveDate:body.effectiveDate,supersededIds,reason:body.reason});
      return this.learner(client,actor.schoolId,id);
    });
  }
  transfer(client:PoolClient,actor:Actor,id:string,body:TransferDto) {
    return command(client,actor,body.operationId,'learner.transfer',{id,...body},async()=>{
      const learner=await this.learner(client,actor.schoolId,id,true);
      if(learner.version!==body.version)throw new ConflictException('Learner changed. Reload before transferring');
      const current=learner.enrolments.find((row:any)=>row.end_date===null&&!row.superseded_at);
      if(!current)throw new ConflictException('No open enrolment to transfer');
      if(body.effectiveDate<=current.start_date)throw new BadRequestException('Transfer must follow the current enrolment start');
      if(current.class_id===body.classId)throw new BadRequestException('Choose a different class');
      // Stable class lock order prevents opposite-direction transfers deadlocking.
      await client.query('SELECT id FROM class_sections WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[actor.schoolId,[current.class_id,body.classId]]);
      const destination=await this.classForDate(client,actor.schoolId,body.classId,body.effectiveDate);
      await client.query('UPDATE enrolments SET end_date=$1,end_reason=$2 WHERE school_id=$3 AND id=$4',[body.effectiveDate,body.reason,actor.schoolId,current.id]);
      await this.ensureCapacity(client,actor,destination,body.effectiveDate,body.capacityOverrideReason);
      await client.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.schoolId,id,body.classId,body.effectiveDate]);
      await client.query('UPDATE learners SET version=version+1 WHERE school_id=$1 AND id=$2',[actor.schoolId,id]);
      await audit(client,actor,'learner.transferred',id,{effectiveDate:body.effectiveDate,fromClassId:current.class_id,toClassId:body.classId,reason:body.reason});
      if(body.capacityOverrideReason)await audit(client,actor,'class.capacity.override',body.classId,{reason:body.capacityOverrideReason,learnerId:id});
      return this.learner(client,actor.schoolId,id);
    });
  }
}
