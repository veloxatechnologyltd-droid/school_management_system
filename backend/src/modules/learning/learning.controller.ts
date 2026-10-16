import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { GenerationService } from './generation.service';
import { ApproveTopicsDto, ContentQueryDto, FlagQuestionDto, HandleFlagDto, ReasonDto, TopicsQueryDto } from './learning.dto';
import { TopicsService } from './topics.service';

const staff = ['headteacher','teacher'], guardian = ['guardian'];
@Controller('api/v1/schools/:schoolId')
export class LearningController {
  constructor(private readonly access: Access, private readonly topics: TopicsService, private readonly generation: GenerationService) {}
  @Get('learning/topics')
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: TopicsQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.topics(client,actor,query.termId));
  }
  @Post('learning/topics/approve')
  approve(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: ApproveTopicsDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.approve(client,actor,body),true);
  }
  @Post('learning/approvals/:approvalId/retire')
  retire(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('approvalId',new ParseUUIDPipe()) approvalId: string,@Body() body: ReasonDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.retireApproval(client,actor,approvalId,body),true);
  }
  // Claude makes the lesson and the missing questions. The model is called with no database transaction held.
  @Post('learning/approvals/:approvalId/generate')
  async generate(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('approvalId',new ParseUUIDPipe()) approvalId: string) {
    const prepared = await this.access.school(req,schoolId,staff,(client,actor) => this.generation.prepare(client,actor,approvalId),true);
    // Nothing to ask the model, or no model to ask: no claim is needed. Otherwise one request at a time per topic: a second is told it is already being made.
    const asks = !prepared.idle && !prepared.note;
    if (asks && !this.generation.claim(schoolId,approvalId)) return this.generation.busy(prepared,approvalId);
    try {
      const done = await this.generation.complete(prepared);
      return await this.access.school(req,schoolId,staff,(client,actor) => this.generation.record(client,actor,approvalId,prepared,done),true);
    } finally { if (asks) this.generation.release(schoolId,approvalId); }
  }
  @Get('learning/topics/:indicatorId/content')
  content(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string,@Query() query: ContentQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.content(client,actor,indicatorId,query.grade));
  }
  @Post('learning/questions/:questionId/retire')
  retireQuestion(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('questionId',new ParseUUIDPipe()) questionId: string,@Body() body: ReasonDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.retireQuestion(client,actor,questionId,body),true);
  }
  @Post('learning/lessons/:lessonId/retire')
  retireLesson(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('lessonId',new ParseUUIDPipe()) lessonId: string,@Body() body: ReasonDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.retireLesson(client,actor,lessonId,body),true);
  }
  @Get('learning/flags')
  flags(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.flags(client,actor));
  }
  @Post('learning/flags/:flagId/handle')
  handle(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('flagId',new ParseUUIDPipe()) flagId: string,@Body() body: HandleFlagDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.topics.handleFlag(client,actor,flagId,body),true);
  }
  // A parent reports a question their child was given.
  @Post('guardian/children/:learnerId/practice/questions/:questionId/flag')
  flag(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('questionId',new ParseUUIDPipe()) questionId: string,@Body() body: FlagQuestionDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.topics.flagQuestion(client,actor,learnerId,questionId,body),true);
  }
  // A parent reports a lesson their child was shown.
  @Post('guardian/children/:learnerId/study/lessons/:lessonId/flag')
  flagLesson(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('lessonId',new ParseUUIDPipe()) lessonId: string,@Body() body: FlagQuestionDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.topics.flagLesson(client,actor,learnerId,lessonId,body),true);
  }
}
