import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { SupportService } from './support.service';
import { FamilyService } from './family.service';
import { OwnersQueryDto, SharingDto, SupportListQueryDto, SupportPlanDto, SupportReviewDto } from './assessment.dto';

const staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class SupportController {
  constructor(private readonly access: Access, private readonly support: SupportService, private readonly family: FamilyService) {}
  @Get('support-plans')
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: SupportListQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.support.list(client,actor,query));
  }
  @Get('support-plans/owners')
  owners(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: OwnersQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.support.owners(client,actor,query.classId));
  }
  @Get('support-plans/:planId')
  detail(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('planId',new ParseUUIDPipe()) planId: string) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.support.detail(client,actor,planId));
  }
  @Post('assessment/classes/:classId/support-plans')
  create(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('classId',new ParseUUIDPipe()) classId: string,@Body() body: SupportPlanDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.support.create(client,actor,classId,body),true);
  }
  @Post('support-plans/:planId/reviews')
  review(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('planId',new ParseUUIDPipe()) planId: string,@Body() body: SupportReviewDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.support.review(client,actor,planId,body),true);
  }
  @Get('assessment/sharing')
  sharing(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,staff,client => this.family.sharing(client,schoolId));
  }
  @Put('assessment/sharing')
  setSharing(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: SharingDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.family.setSharing(client,actor,body),true);
  }
  @Get('guardian/children/:learnerId/progress')
  childProgress(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,['guardian'],(client,actor) => this.family.childProgress(client,actor,learnerId));
  }
}
