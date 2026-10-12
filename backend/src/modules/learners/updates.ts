import { Body,ConflictException,Controller,Get,Injectable,NotFoundException,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { IsIn,IsInt,IsOptional,IsString,Matches,MaxLength,Min,MinLength } from 'class-validator';
import { Request } from 'express';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Access,Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { OperationDto,PageDto } from './learners.dto';
import { parseLearnerCsv } from './imports.csv';

export class StageUpdateDto extends OperationDto {
  @IsString() @MinLength(1) @MaxLength(160) @Matches(/\S/) @Matches(/^[^\x00-\x1f\x7f]+$/) sourceName!:string;
  @IsOptional() @IsIn(['iso','dmy','mdy']) dateFormat?:'iso'|'dmy'|'mdy';
  @IsString() @MinLength(1) @MaxLength(40000) @Matches(/^[^\x00]*$/) csv!:string;
}
export class ApplyUpdateDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) approvalReason!:string;
}
type Field='full_name'|'date_of_birth'|'sex';
type Change={rowNumber:number;learnerId:string;admissionNumber:string;fullName:string;field:Field;from:string|null;to:string};
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// Corrections to existing learners from a CSV: staged and previewed (front desk or headteacher), applied once by the headteacher.
// Blank cells change nothing; each changed field becomes its own correction row with the old and new value.
@Injectable()
export class LearnerUpdatesService {
  async list(client:PoolClient,schoolId:string,page:PageDto){
    const total=Number((await client.query('SELECT count(*) FROM learner_update_batches WHERE school_id=$1',[schoolId])).rows[0].count);
    const items=(await client.query('SELECT id,source_name,status,version,jsonb_array_length(changes) AS changes,jsonb_array_length(issues) AS issues,created_at,approved_at FROM learner_update_batches WHERE school_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[schoolId,page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  async view(client:PoolClient,schoolId:string,id:string,lock=false){
    const batch=(await client.query(`SELECT id,source_name,status,version,changes,issues,created_at,approved_at,approval_reason FROM learner_update_batches WHERE school_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[schoolId,id])).rows[0];
    if(!batch)throw new NotFoundException('Learner update unavailable');return batch;
  }
  stage(client:PoolClient,actor:Actor,body:StageUpdateDto){
    return command(client,actor,body.operationId,'learner.update.stage',body,async()=>{
      const rows=parseLearnerCsv(body.csv,body.dateFormat??'iso',true);
      const today=(await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string;
      const found=new Map((await client.query('SELECT id,admission_number,full_name,date_of_birth::text,sex FROM learners WHERE school_id=$1 AND admission_number=ANY($2::text[])',[actor.schoolId,rows.map(row=>row.input.admissionNumber)])).rows.map(row=>[row.admission_number as string,row]));
      const changes:Change[]=[],issues:{rowNumber:number;admissionNumber:string;message:string}[]=[];let unchanged=0;
      for(const {rowNumber,input} of rows){
        const problems:string[]=[],learner=found.get(input.admissionNumber);
        if(!learner)problems.push('No learner has this admission number');
        if(rows.filter(other=>other.input.admissionNumber===input.admissionNumber).length>1)problems.push('Admission number repeats in this CSV');
        if(input.fullName&&(input.fullName.length<3||input.fullName.length>120||/[\x00-\x1f\x7f]/.test(input.fullName)))problems.push('Learner name must be 3–120 characters without line breaks');
        if(input.dateOfBirth&&(!validDate(input.dateOfBirth)||input.dateOfBirth>=today))problems.push('Birth date must be a valid date in the past');
        if(input.sex&&!['female','male'].includes(input.sex))problems.push('Sex must be M or F (or Male/Female)');
        if(problems.length||!learner){issues.push(...problems.map(message=>({rowNumber,admissionNumber:input.admissionNumber,message})));continue;}
        const wanted:[Field,string|undefined][]=[['full_name',input.fullName||undefined],['date_of_birth',input.dateOfBirth||undefined],['sex',input.sex||undefined]];
        const rowChanges=wanted.filter(([field,to])=>to!==undefined&&to!==learner[field]).map(([field,to])=>({rowNumber,learnerId:learner.id,admissionNumber:learner.admission_number,fullName:learner.full_name,field,from:learner[field] ?? null,to:to!}));
        if(rowChanges.length)changes.push(...rowChanges);else unchanged++;
      }
      const id=randomUUID();
      await client.query('INSERT INTO learner_update_batches(id,school_id,source_name,changes,issues,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.schoolId,body.sourceName.trim(),JSON.stringify(changes),JSON.stringify(issues),actor.membershipId]);
      await audit(client,actor,'learner.update.staged',id,{changes:changes.length,issues:issues.length,unchanged});
      return {id,version:1,status:'staged',changes,issues,unchanged};
    });
  }
  apply(client:PoolClient,actor:Actor,id:string,body:ApplyUpdateDto){
    return command(client,actor,body.operationId,'learner.update.apply',{id,...body},async()=>{
      const batch=await this.view(client,actor.schoolId,id,true);
      if(batch.status!=='staged')throw new ConflictException('This learner update has already been applied');
      if(batch.version!==body.version)throw new ConflictException('This learner update changed; review it again');
      const changes=batch.changes as Change[];
      if(!changes.length)throw new ConflictException('There is nothing to change in this file');
      if(batch.issues.length)throw new ConflictException('Fix the rows with problems and stage the file again');
      const learnerIds=[...new Set(changes.map(change=>change.learnerId))].sort();
      const current=new Map((await client.query('SELECT id,full_name,date_of_birth::text,sex FROM learners WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[actor.schoolId,learnerIds])).rows.map(row=>[row.id as string,row]));
      // Fresh review: if any learner changed since the preview, nothing is applied.
      const stale=changes.filter(change=>(current.get(change.learnerId)?.[change.field] ?? null)!==change.from);
      if(stale.length)throw new ConflictException(`Some learners changed after this file was staged (${[...new Set(stale.map(change=>change.fullName))].slice(0,5).join(', ')}). Stage the file again`);
      const reason=body.approvalReason.trim();
      await client.query(`INSERT INTO learner_corrections(id,school_id,learner_id,batch_id,field,old_value,new_value,reason,recorded_by)
        SELECT gen_random_uuid(),$1,x.learner_id,$2,x.field,x.old_value,x.new_value,$3,$4 FROM unnest($5::uuid[],$6::text[],$7::text[],$8::text[]) x(learner_id,field,old_value,new_value)`,
        [actor.schoolId,id,reason,actor.membershipId,changes.map(change=>change.learnerId),changes.map(change=>change.field),changes.map(change=>change.from),changes.map(change=>change.to)]);
      for(const learnerId of learnerIds){
        const mine=changes.filter(change=>change.learnerId===learnerId),value=(field:Field)=>mine.find(change=>change.field===field)?.to ?? null;
        await client.query('UPDATE learners SET full_name=coalesce($3,full_name),date_of_birth=coalesce($4::date,date_of_birth),sex=coalesce($5,sex),version=version+1 WHERE school_id=$1 AND id=$2',[actor.schoolId,learnerId,value('full_name'),value('date_of_birth'),value('sex')]);
        await audit(client,actor,'learner.corrected',learnerId,{batchId:id,fields:mine.map(change=>change.field)});
      }
      await client.query('UPDATE learner_update_batches SET status=$3,version=version+1,approved_by=$4,approved_at=now(),approval_reason=$5 WHERE school_id=$1 AND id=$2',[actor.schoolId,id,'applied',actor.membershipId,reason]);
      return {id,status:'applied',learners:learnerIds.length,changes:changes.length};
    });
  }
  async history(client:PoolClient,schoolId:string,learnerId:string){
    return {items:(await client.query('SELECT id,field,old_value,new_value,reason,recorded_at,batch_id FROM learner_corrections WHERE school_id=$1 AND learner_id=$2 ORDER BY recorded_at DESC,id',[schoolId,learnerId])).rows};
  }
}

const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId')
export class LearnerUpdatesController {
  constructor(private readonly access:Access,private readonly updates:LearnerUpdatesService){}
  @Get('learner-updates')
  list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,client=>this.updates.list(client,schoolId,page));}
  @Get('learner-updates/:id')
  view(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,staff,client=>this.updates.view(client,schoolId,id));}
  @Post('learner-updates')
  stage(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:StageUpdateDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.updates.stage(client,actor,body),true);}
  @Post('learner-updates/:id/apply')
  apply(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:ApplyUpdateDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.updates.apply(client,actor,id,body),true);}
  @Get('learners/:learnerId/corrections')
  history(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('learnerId',new ParseUUIDPipe()) learnerId:string){return this.access.school(req,schoolId,staff,client=>this.updates.history(client,schoolId,learnerId));}
}
