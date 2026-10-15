import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PracticeBankService } from './bank.service';
import { ApproveQuestionsDto, RetireSetDto } from './practice.dto';

const staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class PracticeController {
  constructor(private readonly access: Access, private readonly bank: PracticeBankService) {}
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
}
