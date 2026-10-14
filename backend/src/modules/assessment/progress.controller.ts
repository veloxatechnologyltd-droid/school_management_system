import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { ProgressService } from './progress.service';
import { AssessmentListQueryDto, CaSuggestionQueryDto, ClassAssessmentDto, ClassProgressQueryDto, LearnerProgressQueryDto, RecordMarksDto } from './assessment.dto';

const staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class ProgressController {
  constructor(private readonly access: Access, private readonly progress: ProgressService) {}
  @Get('assessment/classes/:classId/assessments')
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: AssessmentListQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.list(client,actor,classId,query.termId,query.subjectId));
  }
  @Post('assessment/classes/:classId/assessments')
  create(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: ClassAssessmentDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.create(client,actor,classId,body),true);
  }
  @Get('assessment/classes/:classId/assessments/:assessmentId/marks')
  roster(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Param('assessmentId',new ParseUUIDPipe()) assessmentId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.roster(client,actor,classId,assessmentId));
  }
  @Post('assessment/classes/:classId/assessments/:assessmentId/marks')
  mark(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Param('assessmentId',new ParseUUIDPipe()) assessmentId: string,@Body() body: RecordMarksDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.recordMarks(client,actor,classId,assessmentId,body),true);
  }
  @Get('assessment/classes/:classId/ca-suggestion')
  caSuggestion(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: CaSuggestionQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.caSuggestion(client,actor,classId,query.termId,query.subjectId));
  }
  @Get('assessment/classes/:classId/progress')
  classProgress(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: ClassProgressQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.classProgress(client,actor,classId,query.termId,(query.period ?? 'week') as 'week' | 'month'));
  }
  @Get('assessment/learners/:learnerId/progress')
  learnerProgress(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Query() query: LearnerProgressQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.learnerProgress(client,actor,learnerId,(query.period ?? 'month') as 'week' | 'month' | 'term' | 'year'));
  }
}
