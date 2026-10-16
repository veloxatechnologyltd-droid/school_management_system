import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PracticeBankService } from './bank.service';
import { HomePracticeService } from './home.service';
import { AnswerDto, ApproveQuestionsDto, ClassPracticeQueryDto, HomePracticeSettingsDto, RetireSetDto, StartSessionDto, StartStudyDto } from './practice.dto';
import { OperationDto } from '../learners/learners.dto';

const staff = ['headteacher','teacher'], guardian = ['guardian'];
@Controller('api/v1/schools/:schoolId')
export class PracticeController {
  constructor(private readonly access: Access, private readonly bank: PracticeBankService, private readonly home: HomePracticeService) {}
  @Get('assessment/indicators/:indicatorId/questions')
  questions(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.bank.bank(client,actor,indicatorId));
  }
  @Post('assessment/indicators/:indicatorId/questions')
  approve(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string,@Body() body: ApproveQuestionsDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.bank.approve(client,actor,indicatorId,body),true);
  }
  @Post('assessment/practice-sets/:setId/retire')
  retire(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('setId',new ParseUUIDPipe()) setId: string,@Body() body: RetireSetDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.bank.retire(client,actor,setId,body),true);
  }

  // The school's home practice switch (off by default). Staff read it; the headteacher sets it.
  @Get('practice/settings')
  settings(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,client => this.home.settings(client,schoolId));
  }
  @Put('practice/settings')
  setSettings(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: HomePracticeSettingsDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.home.setSettings(client,actor,body),true);
  }

  // A verified guardian's child practising at home.
  @Get('guardian/children/:learnerId/practice')
  child(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.child(client,actor,learnerId));
  }
  @Post('guardian/children/:learnerId/practice/sessions')
  start(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Body() body: StartSessionDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.start(client,actor,learnerId,body),true);
  }
  @Get('guardian/children/:learnerId/practice/sessions/:sessionId')
  session(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('sessionId',new ParseUUIDPipe()) sessionId: string) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.session(client,actor,learnerId,sessionId));
  }
  @Post('guardian/children/:learnerId/practice/sessions/:sessionId/answer')
  answer(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('sessionId',new ParseUUIDPipe()) sessionId: string,@Body() body: AnswerDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.answer(client,actor,learnerId,sessionId,body),true);
  }

  // Study: the topic's lesson on a verified guardian's phone, then the check (an ordinary practice session tied to the study).
  @Post('guardian/children/:learnerId/study/sessions')
  startStudy(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Body() body: StartStudyDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.startStudy(client,actor,learnerId,body),true);
  }
  @Post('guardian/children/:learnerId/study/sessions/:studyId/finish')
  finishStudy(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('studyId',new ParseUUIDPipe()) studyId: string,@Body() body: OperationDto) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.finishStudy(client,actor,learnerId,studyId,body.operationId),true);
  }

  // What the child has learned, to revisit: lessons read and practice finished, and any one of them in full.
  @Get('guardian/children/:learnerId/history')
  history(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.familyHistory(client,actor,learnerId));
  }
  @Get('guardian/children/:learnerId/history/:kind/:id')
  historyEntry(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('kind') kind: string,@Param('id',new ParseUUIDPipe()) id: string) {
    return this.access.school(req,schoolId,guardian,(client,actor) => this.home.familyHistoryEntry(client,actor,learnerId,kind,id));
  }

  // Staff see practice as evidence beside class work (the headteacher, or a teacher for a learner or class they teach today).
  @Get('learners/:learnerId/practice')
  learner(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffLearner(client,actor,learnerId));
  }
  @Get('learners/:learnerId/practice/history')
  learnerHistory(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffHistory(client,actor,learnerId));
  }
  @Get('learners/:learnerId/practice/history/:kind/:id')
  learnerHistoryEntry(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Param('kind') kind: string,@Param('id',new ParseUUIDPipe()) id: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffHistoryEntry(client,actor,learnerId,kind,id));
  }
  @Get('assessment/classes/:classId/home-practice')
  classView(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: ClassPracticeQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffClass(client,actor,classId,query.termId));
  }
}
