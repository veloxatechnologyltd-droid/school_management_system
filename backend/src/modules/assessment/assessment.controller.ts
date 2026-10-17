import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { AssessmentService } from './assessment.service';
import { PolicyDto, PublishDto, RecordScoresDto, ReissueDto, ReopenDto, RemarksDto, SchoolReportsQueryDto, SubjectDto, TermDto, TermQueryDto } from './assessment.dto';

const head = ['headteacher'], staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class AssessmentController {
  constructor(private readonly access: Access, private readonly assessment: AssessmentService) {}
  @Get('assessment/subjects')
  subjects(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,async client => ({items:(await client.query('SELECT id,name FROM subjects WHERE school_id=$1 ORDER BY name,id',[schoolId])).rows}));
  }
  @Post('assessment/subjects')
  createSubject(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: SubjectDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.createSubject(client,actor,body),true);
  }
  @Get('assessment/terms')
  terms(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,async client => ({items:(await client.query('SELECT t.id,t.academic_year_id,t.name,t.start_date::text,t.end_date::text,y.name AS year_name FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date DESC,t.id',[schoolId])).rows}));
  }
  @Post('assessment/terms')
  createTerm(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: TermDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.createTerm(client,actor,body),true);
  }
  @Get('assessment/policy')
  policy(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,async client => ({policy:(await this.assessment.policy(client,schoolId)) ?? null}));
  }
  @Put('assessment/policy')
  setPolicy(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: PolicyDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.setPolicy(client,actor,body),true);
  }
  @Get('assessment/classes/:classId/grid')
  grid(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: TermQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.grid(client,actor,classId,query.termId,query.subjectId));
  }
  @Post('assessment/classes/:classId/scores')
  record(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: RecordScoresDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.record(client,actor,classId,body),true);
  }
  @Get('assessment/classes/:classId/results')
  results(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: TermQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.results(client,actor,classId,query.termId));
  }
  @Get('assessment/reports')
  schoolReports(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: SchoolReportsQueryDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.schoolReports(client,actor,query.termId,query.level));
  }
  @Get('assessment/classes/:classId/reports')
  classReports(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: TermQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.classReports(client,actor,classId,query.termId));
  }
  @Get('assessment/classes/:classId/remarks')
  remarks(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: TermQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.remarks(client,actor,classId,query.termId));
  }
  @Post('assessment/classes/:classId/remarks')
  recordRemarks(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: RemarksDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.assessment.recordRemarks(client,actor,classId,body),true);
  }
  @Post('assessment/classes/:classId/publish')
  publish(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: PublishDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.publish(client,actor,classId,body),true);
  }
  @Post('assessment/classes/:classId/reopen')
  reopen(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: ReopenDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.reopen(client,actor,classId,body),true);
  }
  @Post('assessment/classes/:classId/reissue')
  reissue(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: ReissueDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.assessment.reissue(client,actor,classId,body),true);
  }
  @Get('guardian/children/:learnerId/terminal-reports')
  guardianReports(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,['guardian'],(client,actor) => this.assessment.guardianReports(client,actor,learnerId));
  }
}
