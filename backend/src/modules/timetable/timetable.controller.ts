import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { OperationDto } from '../learners/learners.dto';
import { DraftDto, LessonDto, PeriodsDto, RoomDto, TermQueryDto } from './timetable.dto';
import { TimetableService } from './timetable.service';
const readers = ['headteacher', 'teacher'], head = ['headteacher'];
@Controller('api/v1/schools/:schoolId/timetable')
export class TimetableController {
  constructor(private readonly access: Access, private readonly timetable: TimetableService) {}
  @Get()
  overview(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Query() query: TermQueryDto) { return this.access.school(req, schoolId, readers, (client, actor) => this.timetable.overview(client, actor, query.termId)); }
  @Get('today')
  today(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string) { return this.access.school(req, schoolId, readers, (client, actor) => this.timetable.today(client, actor)); }
  @Post('rooms')
  room(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Body() body: RoomDto) { return this.access.school(req, schoolId, head, (client, actor) => this.timetable.addRoom(client, actor, body), true); }
  @Post('drafts')
  draft(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Body() body: DraftDto) { return this.access.school(req, schoolId, head, (client, actor) => this.timetable.createDraft(client, actor, body), true); }
  @Get(':id/lessons')
  lessons(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Param('id', new ParseUUIDPipe()) id: string) { return this.access.school(req, schoolId, readers, (client, actor) => this.timetable.lessons(client, actor, id)); }
  @Put(':id/periods')
  periods(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: PeriodsDto) { return this.access.school(req, schoolId, head, (client, actor) => this.timetable.setPeriods(client, actor, id, body.periods), true); }
  @Put(':id/lessons')
  lesson(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: LessonDto) { return this.access.school(req, schoolId, head, (client, actor) => this.timetable.setLesson(client, actor, id, body), true); }
  @Post(':id/publish')
  publish(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: OperationDto) { return this.access.school(req, schoolId, head, (client, actor) => this.timetable.publish(client, actor, id, body.operationId), true); }
}
