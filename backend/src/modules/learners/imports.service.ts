import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash,randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { LearnersService } from './learners.service';
import { PageDto } from './learners.dto';
import { CommitImportDto,StageImportDto,ValidateImportDto } from './imports.dto';
import { CsvRow,parseLearnerCsv } from './imports.csv';
type Match={id:string;kind:'learner'|'admission';full_name:string;admission_number:string;date_of_birth:string|null};
type Validation={issues:string[];possibleMatches:Match[];batchMatches:number[]};
const matchSignature=(matches:Match[])=>JSON.stringify(matches.map(match=>[match.kind,match.id,match.full_name,match.admission_number,match.date_of_birth]));
const escaped=(value?:string)=>`%${(value??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
@Injectable()
export class LearnerImportsService {
  constructor(private readonly learners:LearnersService){}
  async classes(client:PoolClient,schoolId:string,page:PageDto){
    const filter="c.school_id=$1 AND (c.name ILIKE $2 ESCAPE '\\' OR y.name ILIKE $2 ESCAPE '\\')";
    const from='class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id';
    const total=Number((await client.query(`SELECT count(*) FROM ${from} WHERE ${filter}`,[schoolId,escaped(page.search)])).rows[0].count);
    const items=(await client.query(`SELECT c.id,c.name,c.capacity,y.name AS year_name,y.start_date::text,y.end_date::text FROM ${from} WHERE ${filter} ORDER BY y.start_date DESC,c.name,c.id LIMIT $3 OFFSET $4`,[schoolId,escaped(page.search),page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  async list(client:PoolClient,schoolId:string,page:PageDto){
    const total=Number((await client.query("SELECT count(*) FROM learner_import_batches WHERE school_id=$1 AND source_name ILIKE $2 ESCAPE '\\'",[schoolId,escaped(page.search)])).rows[0].count);
    const items=(await client.query("SELECT b.id,b.source_name,b.status,b.version,b.row_count,b.start_date::text,b.created_at,c.name AS class_name FROM learner_import_batches b JOIN class_sections c ON c.school_id=b.school_id AND c.id=b.class_id WHERE b.school_id=$1 AND b.source_name ILIKE $2 ESCAPE '\\' ORDER BY b.created_at DESC,b.id LIMIT $3 OFFSET $4",[schoolId,escaped(page.search),page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  private async batch(client:PoolClient,schoolId:string,id:string,lock=false){
    const batch=(await client.query(`SELECT b.*,b.start_date::text,c.name AS class_name FROM learner_import_batches b JOIN class_sections c ON c.school_id=b.school_id AND c.id=b.class_id WHERE b.school_id=$1 AND b.id=$2${lock?' FOR UPDATE OF b':' FOR SHARE OF b'}`,[schoolId,id])).rows[0];
    if(!batch)throw new NotFoundException('Import batch unavailable');return batch;
  }
  private async rows(client:PoolClient,schoolId:string,id:string){return (await client.query('SELECT row_number,input,validation,learner_id,duplicate_review_reason FROM learner_import_rows WHERE school_id=$1 AND batch_id=$2 ORDER BY row_number',[schoolId,id])).rows;}
  async view(client:PoolClient,schoolId:string,id:string){return {...await this.batch(client,schoolId,id),rows:await this.rows(client,schoolId,id)};}
  private async validations(client:PoolClient,schoolId:string,startDate:string,rows:CsvRow[]):Promise<Map<number,Validation>>{
    const numbers=rows.map(row=>row.input.admissionNumber),names=rows.map(row=>row.input.fullName.toLowerCase());
    const existing:Match[]=(await client.query("SELECT id,full_name,admission_number,date_of_birth::text,'learner' AS kind FROM learners WHERE school_id=$1 AND (admission_number=ANY($2::text[]) OR lower(btrim(full_name))=ANY($3::text[])) UNION ALL SELECT id,full_name,admission_number,date_of_birth::text,'admission' AS kind FROM admissions WHERE school_id=$1 AND (admission_number=ANY($2::text[]) OR lower(btrim(full_name))=ANY($3::text[])) ORDER BY kind,id",[schoolId,numbers,names])).rows;
    const results=new Map<number,Validation>();
    for(const row of rows){
      const input=row.input,issues:string[]=[];
      if(input.columnCount!==3)issues.push('This row has a different number of cells than the header row');
      if(!/^[A-Za-z0-9][A-Za-z0-9/-]{1,39}$/.test(input.admissionNumber))issues.push('Admission number must be 2–40 letters, digits, / or -');
      if(input.fullName.length<3||input.fullName.length>120||/[\x00-\x1f\x7f]/.test(input.fullName))issues.push('Learner name must be 3–120 characters without line breaks');
      if(input.dateOfBirth&&(!validDate(input.dateOfBirth)||input.dateOfBirth>=startDate))issues.push('Birth date must be a valid date before enrolment');
      if(input.sex&&!['female','male'].includes(input.sex))issues.push('Sex must be M or F (or Male/Female)');
      if(rows.filter(other=>other.input.admissionNumber===input.admissionNumber).length>1)issues.push('Admission number repeats in this CSV');
      if(existing.some(match=>match.admission_number===input.admissionNumber))issues.push('Admission number already belongs to a learner or application');
      const samePerson=(name:string,birth:string|null)=>name.trim().toLowerCase()===input.fullName.toLowerCase()&&(!input.dateOfBirth||!birth||birth===input.dateOfBirth);
      const possibleMatches=existing.filter(match=>samePerson(match.full_name,match.date_of_birth));
      if(possibleMatches.length>10)issues.push('Too many possible matches. Review this learner individually');
      const batchMatches=rows.filter(other=>other.rowNumber!==row.rowNumber&&samePerson(other.input.fullName,other.input.dateOfBirth)).map(other=>other.rowNumber);
      results.set(row.rowNumber,{issues,possibleMatches:possibleMatches.slice(0,10),batchMatches});
    }return results;
  }
  stage(client:PoolClient,actor:Actor,body:StageImportDto){return command(client,actor,body.operationId,'learner.import.stage',body,async()=>{
    await this.learners.lockIdentityCatalog(client,actor.schoolId);await this.learners.classForDate(client,actor.schoolId,body.classId,body.startDate);
    const rows=parseLearnerCsv(body.csv,body.dateFormat??'iso'),validation=await this.validations(client,actor.schoolId,body.startDate,rows),id=randomUUID();
    const digest=createHash('sha256').update(body.csv).digest('hex');
    await client.query('INSERT INTO learner_import_batches(id,school_id,class_id,start_date,source_name,source_digest,row_count,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.schoolId,body.classId,body.startDate,body.sourceName.trim(),digest,rows.length,actor.membershipId]);
    for(const row of rows)await client.query('INSERT INTO learner_import_rows(id,school_id,batch_id,row_number,input,validation) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,id,row.rowNumber,JSON.stringify(row.input),JSON.stringify(validation.get(row.rowNumber))]);
    await audit(client,actor,'learner.import.staged',id,{rowCount:rows.length,sourceDigest:digest});return this.view(client,actor.schoolId,id);
  });}
  validate(client:PoolClient,actor:Actor,id:string,body:ValidateImportDto){return command(client,actor,body.operationId,'learner.import.validate',{id,...body},async()=>{
    await this.learners.lockIdentityCatalog(client,actor.schoolId);const batch=await this.batch(client,actor.schoolId,id,true);
    if(batch.status!=='staged'||batch.version!==body.version)throw new ConflictException('Import changed. Reload before rechecking');
    await this.learners.classForDate(client,actor.schoolId,batch.class_id,batch.start_date);
    const rows=await this.rows(client,actor.schoolId,id),validation=await this.validations(client,actor.schoolId,batch.start_date,rows.map(row=>({rowNumber:row.row_number,input:row.input})));
    for(const row of rows)await client.query('UPDATE learner_import_rows SET validation=$1 WHERE school_id=$2 AND batch_id=$3 AND row_number=$4',[JSON.stringify(validation.get(row.row_number)),actor.schoolId,id,row.row_number]);
    await client.query('UPDATE learner_import_batches SET version=version+1 WHERE school_id=$1 AND id=$2',[actor.schoolId,id]);await audit(client,actor,'learner.import.rechecked',id,{version:body.version+1});return this.view(client,actor.schoolId,id);
  });}
  commit(client:PoolClient,actor:Actor,id:string,body:CommitImportDto){return command(client,actor,body.operationId,'learner.import.commit',{id,...body},async()=>{
    await this.learners.lockIdentityCatalog(client,actor.schoolId);const batch=await this.batch(client,actor.schoolId,id,true);
    if(batch.status!=='staged'||batch.version!==body.version)throw new ConflictException('Import changed. Reload before approving');
    const section=await this.learners.classForDate(client,actor.schoolId,batch.class_id,batch.start_date),rows=await this.rows(client,actor.schoolId,id);
    if(rows.length!==batch.row_count)throw new ConflictException('Import source is incomplete. Stage the file again');
    const selection=new Map(body.selectedRows.map(row=>[row.rowNumber,row]));if(selection.size!==body.selectedRows.length||body.selectedRows.some(selected=>!rows.some(row=>row.row_number===selected.rowNumber)))throw new BadRequestException('Select each staged row at most once');
    const validation=await this.validations(client,actor.schoolId,batch.start_date,rows.map(row=>({rowNumber:row.row_number,input:row.input})));
    const selected=rows.filter(row=>selection.has(row.row_number));
    for(const row of selected){
      const check=validation.get(row.row_number)!;
      // JSONB key order is not meaningful; compare the actual reviewed fields.
      if(JSON.stringify(check.issues)!==JSON.stringify(row.validation.issues)||matchSignature(check.possibleMatches)!==matchSignature(row.validation.possibleMatches)||JSON.stringify(check.batchMatches)!==JSON.stringify(row.validation.batchMatches))throw new ConflictException('Import preview is stale. Recheck it before approving');
      if(check.issues.length)throw new BadRequestException(`CSV row ${row.row_number} has unresolved errors`);
      if((check.possibleMatches.length||check.batchMatches.length)&&!selection.get(row.row_number)!.duplicateReviewReason?.trim())throw new BadRequestException(`CSV row ${row.row_number} needs a duplicate review reason`);
    }
    for(const row of selected){
      await this.learners.ensureCapacity(client,actor,section,batch.start_date,body.capacityOverrideReason);
      const learnerId=randomUUID();await client.query('INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth,sex) VALUES($1,$2,$3,$4,$5,$6)',[learnerId,actor.schoolId,row.input.admissionNumber,row.input.fullName,row.input.dateOfBirth||null,row.input.sex||null]);
      await client.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.schoolId,learnerId,batch.class_id,batch.start_date]);
      await client.query('UPDATE learner_import_rows SET learner_id=$1,duplicate_review_reason=$2 WHERE school_id=$3 AND batch_id=$4 AND row_number=$5',[learnerId,selection.get(row.row_number)!.duplicateReviewReason?.trim()??null,actor.schoolId,id,row.row_number]);
    }
    await client.query("UPDATE learner_import_batches SET status='committed',version=version+1,approved_by=$1,approved_at=now(),approval_reason=$2,committed_at=now() WHERE school_id=$3 AND id=$4",[actor.membershipId,body.approvalReason.trim(),actor.schoolId,id]);
    await audit(client,actor,'learner.import.committed',id,{selectedRows:selected.map(row=>row.row_number),createdCount:selected.length,sourceDigest:batch.source_digest,approvalReason:body.approvalReason.trim()});
    if(body.capacityOverrideReason)await audit(client,actor,'class.capacity.override',batch.class_id,{reason:body.capacityOverrideReason,importBatchId:id});
    return this.view(client,actor.schoolId,id);
  });}
}
