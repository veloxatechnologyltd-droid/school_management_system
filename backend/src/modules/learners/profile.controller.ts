import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { LearnerProfileService } from './profile.service';
import { LearnerDetailsDto, LearnerNoteDto, ProfileQueryDto, WithdrawNoteDto } from './profile.dto';

const staff = ['headteacher','teacher'];
@Controller('api/v1/schools/:schoolId')
export class LearnerProfileController {
  constructor(private readonly access: Access, private readonly profiles: LearnerProfileService) {}
  @Get('learners/:learnerId/profile')
  profile(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Query() query: ProfileQueryDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.profiles.profile(client,actor,learnerId,query.termId));
  }
  // The headteacher records the optional details; teachers only read the ones that keep a child safe.
  @Put('learners/:learnerId/details')
  details(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Body() body: LearnerDetailsDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.profiles.saveDetails(client,actor,learnerId,body),true);
  }
  @Post('learners/:learnerId/notes')
  addNote(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Body() body: LearnerNoteDto) {
    return this.access.school(req,schoolId,staff,(client,actor) => this.profiles.addNote(client,actor,learnerId,body),true);
  }
  @Get('guardian/children/:learnerId/notes')
  familyNotes(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,['guardian'],(client,actor) => this.profiles.familyNotes(client,actor,learnerId));
  }
  @Post('guardian/children/:learnerId/notes')
  addFamilyNote(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string,@Body() body: LearnerNoteDto) {
    return this.access.school(req,schoolId,['guardian'],(client,actor) => this.profiles.addNote(client,actor,learnerId,body),true);
  }
  @Post('learner-notes/:noteId/withdraw')
  withdraw(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('noteId',new ParseUUIDPipe()) noteId: string,@Body() body: WithdrawNoteDto) {
    return this.access.school(req,schoolId,[...staff,'guardian'],(client,actor) => this.profiles.withdrawNote(client,actor,noteId,body),true);
  }
}
