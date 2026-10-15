import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PracticeBankService } from './bank.service';
import { HomePracticeService } from './home.service';
import { AnswerDto, ApproveQuestionsDto, ClassPracticeQueryDto, HomePracticeSettingsDto, RetireSetDto, StartSessionDto } from './practice.dto';

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

  // Staff see practice as evidence beside class work (the headteacher, or a teacher for a learner or class they teach today).
  @Get('learners/:learnerId/practice')
  learner(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffLearner(client,actor,learnerId));
  }
  @Get('assessment/classes/:classId/home-practice')
  classView(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Query() query: ClassPracticeQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.home.staffClass(client,actor,classId,query.termId));
  }
}
