import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';
import { OperationDto } from '../learners/learners.dto';
import { AiService } from './ai.service';
import { AiDraftsService } from './ai-drafts.service';

class SettingsDto extends OperationDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(5000) monthlyRunCap!: number;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) acknowledgement?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
class DraftDto {
  @IsUUID() learnerId!: string;
  @IsUUID() enrolmentId!: string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodStart!: string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodEnd!: string;
}
class RemarksDraftDto {
  @IsUUID() classId!: string;
  @IsUUID() termId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(80) @IsUUID('4',{each:true}) learnerIds?: string[];
}
class PlanDraftDto {
  @IsUUID() classId!: string;
  @IsUUID() termId!: string;
  @IsUUID() subjectId!: string;
  @IsOptional() @IsUUID() indicatorId?: string;
  @IsArray() @ArrayMaxSize(40) @IsUUID('4',{each:true}) learnerIds!: string[];
}
class FeedbackDto { @IsIn(['accepted','edited','discarded']) outcome!: string; }

@Controller('api/v1/schools/:schoolId/ai')
export class AiController {
  constructor(private readonly access: Access, private readonly ai: AiService, private readonly drafts: AiDraftsService) {}
  @Get('settings')
  settings(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,['headteacher','teacher'],client => this.ai.settings(client,schoolId));
  }
  @Put('settings')
  save(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: SettingsDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.ai.saveSettings(client,actor,body),true);
  }
  @Post('early-years/report-draft')
  async draft(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: DraftDto) {
    const prepared = await this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.prepare(client,actor,body),true);
    const done = await this.ai.complete(prepared);
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.record(client,actor,body,prepared,done),true);
  }
  // Class teacher's remarks for a Primary/JHS terminal report, drafted from computed results. Returned for review, never saved here.
  @Post('report-remarks-draft')
  async remarksDraft(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: RemarksDraftDto) {
    const prepared = await this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.prepareRemarks(client,actor,body),true);
    const done = await this.drafts.completeRemarks(prepared);
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.recordRemarks(client,actor,body,prepared,done),true);
  }
  // A support plan for named learners, drafted from their marks, missed work, exam gap and attendance; the teacher edits and saves it.
  @Post('support-plan-draft')
  async planDraft(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: PlanDraftDto) {
    const prepared = await this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.preparePlan(client,actor,body),true);
    const done = await this.drafts.completePlan(prepared);
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.recordPlan(client,actor,body,prepared,done),true);
  }
  // A short practice worksheet for one curriculum indicator; the teacher edits it and may save it as a practice material.
  @Post('indicators/:indicatorId/worksheet-draft')
  async worksheetDraft(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('indicatorId',new ParseUUIDPipe()) indicatorId: string) {
    const prepared = await this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.prepareWorksheet(client,actor,indicatorId),true);
    const done = await this.drafts.completeWorksheet(prepared);
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.drafts.recordWorksheet(client,actor,indicatorId,done),true);
  }
  @Post('runs/:runId/feedback')
  feedback(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('runId',new ParseUUIDPipe()) runId: string,@Body() body: FeedbackDto) {
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.feedback(client,actor,runId,body.outcome),true);
  }
}
