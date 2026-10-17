import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { ProgressService } from './progress.service';
import { MocksService } from './mocks.service';
import { AddIndicatorsDto, AssessmentListQueryDto, CaSuggestionQueryDto, ClassAssessmentDto, ClassProgressQueryDto, GapsQueryDto, IndicatorQueryDto, LearnerProgressQueryDto, RecordMarksDto, ResourceDto, RetireIndicatorDto, MockRoundDto, WorkloadQueryDto } from './assessment.dto';

const head = ['headteacher'], staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class ProgressController {
  constructor(private readonly access: Access, private readonly progress: ProgressService, private readonly mocks: MocksService) {}
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
  @Get('assessment/classes/:classId/ca-sheet')
  caSheet(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: CaSuggestionQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.caSheet(client,actor,classId,query.termId,query.subjectId));
  }
  @Get('assessment/classes/:classId/workload')
  workload(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: WorkloadQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.workload(client,actor,classId,query.termId));
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
  @Get('assessment/indicators')
  indicators(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: IndicatorQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.indicators(client,actor,query.subjectId));
  }
  @Post('assessment/indicators')
  addIndicators(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: AddIndicatorsDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.addIndicators(client,actor,body),true);
  }
  @Post('assessment/indicators/:indicatorId/retire')
  retireIndicator(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string,@Body() body: RetireIndicatorDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.retireIndicator(client,actor,indicatorId,body),true);
  }
  @Get('assessment/classes/:classId/gaps')
  gaps(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: GapsQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.gaps(client,actor,classId,query.termId,query.subjectId));
  }
  @Get('assessment/indicators/:indicatorId/resources')
  resources(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.resources(client,actor,indicatorId));
  }
  @Post('assessment/indicators/:indicatorId/resources')
  addResource(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string,@Body() body: ResourceDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.addResource(client,actor,indicatorId,body),true);
  }
  @Post('assessment/indicator-resources/:resourceId/retire')
  retireResource(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('resourceId',new ParseUUIDPipe()) resourceId: string,@Body() body: RetireIndicatorDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.progress.retireResource(client,actor,resourceId,body),true);
  }
  @Get('assessment/classes/:classId/mocks')
  mockRounds(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.mocks.rounds(client,actor,classId));
  }
  @Post('assessment/classes/:classId/mocks')
  createMockRound(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: MockRoundDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.mocks.createRound(client,actor,classId,body),true);
  }
}
