import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { Access, Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { LearnersService } from './learners.service';
import { OperationDto } from './learners.dto';

class DecisionDto {
  @IsUUID() learnerId!: string;
  @IsIn(['move','leave']) action!: string;
  @IsOptional() @IsUUID() classId?: string;
}
class PromotionDto extends OperationDto {
  @IsUUID() sourceClassId!: string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @MinLength(3) @MaxLength(400) @Matches(/\S.*\S/) reason!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({each:true}) @Type(() => DecisionDto) decisions!: DecisionDto[];
}
class PreviewDto { @IsUUID() sourceClassId!: string; @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string; }
// Deterministic child operation IDs make a retried batch replay each learner's receipt instead of repeating it.
const childOperation = (batch: string, learnerId: string) => {
  const hex = createHash('sha256').update(`${batch}:${learnerId}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
};

// Year-end roll-over: every learner in a class is explicitly moved to a next-year class or leaves; history stays in enrolment intervals.
@Controller('api/v1/schools/:schoolId/promotions')
export class PromotionsController {
  constructor(private readonly access: Access, private readonly learners: LearnersService) {}
  private async roster(client: PoolClient, schoolId: string, classId: string, effectiveDate: string) {
    if (!(await client.query('SELECT 1 FROM class_sections WHERE school_id=$1 AND id=$2',[schoolId,classId])).rowCount) throw new NotFoundException('Class unavailable');
    return (await client.query(`SELECT l.id,l.full_name,l.admission_number FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id
      WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<$3 AND (e.end_date IS NULL OR e.end_date>$3) ORDER BY l.full_name,l.id`,[schoolId,classId,effectiveDate])).rows;
  }
  @Get('preview')
  preview(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: PreviewDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => ({items:await this.roster(client,schoolId,query.sourceClassId,query.effectiveDate)}));
  }
  @Post()
  run(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: PromotionDto) {
    return this.access.school(req,schoolId,['headteacher'],(client: PoolClient,actor: Actor) => command(client,actor,body.operationId,'learners.promotion',body,async () => {
      const roster = await this.roster(client,actor.schoolId,body.sourceClassId,body.effectiveDate);
      const decided = new Map(body.decisions.map(decision => [decision.learnerId,decision]));
      if (decided.size !== body.decisions.length) throw new ConflictException('Each learner may appear once');
      const missing = roster.filter(row => !decided.has(row.id)).length, unknown = body.decisions.filter(decision => !roster.some(row => row.id === decision.learnerId)).length;
      if (missing || unknown) throw new ConflictException(`Decide every learner in the class: ${missing} missing, ${unknown} not in this class`);
      let moved = 0, left = 0;
      for (const row of roster) {
        const decision = decided.get(row.id)!;
        const version = (await client.query('SELECT version FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,row.id])).rows[0].version as number;
        const operationId = childOperation(body.operationId,row.id);
        if (decision.action === 'move') {
          if (!decision.classId || decision.classId === body.sourceClassId) throw new ConflictException(`${row.full_name} needs a different class to move to`);
          await this.learners.transfer(client,actor,row.id,{operationId,version,classId:decision.classId,effectiveDate:body.effectiveDate,reason:body.reason.trim()} as never);
          moved++;
        } else {
          await this.learners.withdraw(client,actor,row.id,{operationId,version,effectiveDate:body.effectiveDate,reason:body.reason.trim()} as never);
          left++;
        }
      }
      await audit(client,actor,'learners.promotion.completed',body.sourceClassId,{effectiveDate:body.effectiveDate,moved,left});
      return {moved,left};
    }),true);
  }
}
