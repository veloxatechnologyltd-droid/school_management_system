import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';
import { LEVEL_COUNT, MAX_PER_LEVEL, MIN_PER_LEVEL } from './questions';

export class QuestionDto {
  @IsInt() @Min(1) @Max(LEVEL_COUNT) level!: number;
  @IsIn(['choice','number']) kind!: string;
  @IsString() @MaxLength(400) prompt!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({each:true}) @MaxLength(160,{each:true}) options?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(3) correctOption?: number;
  @IsOptional() @IsNumber({allowNaN:false,allowInfinity:false}) answer?: number;
  @IsOptional() @IsString() @MaxLength(400) explanation?: string;
}
// A reviewed set: the teacher's edited questions (kept as approved) and, if Claude drafted them, the draft's run id.
export class ApproveQuestionsDto extends OperationDto {
  @IsOptional() @IsUUID() runId?: string;
  @IsArray() @ArrayMinSize(LEVEL_COUNT * MIN_PER_LEVEL) @ArrayMaxSize(LEVEL_COUNT * MAX_PER_LEVEL) @ValidateNested({each:true}) @Type(() => QuestionDto) questions!: QuestionDto[];
}
export class RetireSetDto extends OperationDto { @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) reason!: string; }

export class HomePracticeSettingsDto extends OperationDto { @IsBoolean() enabled!: boolean; @IsOptional() @IsInt() @Min(1) version?: number; }
// A session can follow a study of the same topic: the check a child answers after reading the lesson.
export class StartSessionDto extends OperationDto { @IsUUID() indicatorId!: string; @IsOptional() @IsUUID() studySessionId?: string; }
export class StartStudyDto extends OperationDto { @IsUUID() indicatorId!: string; }
// One answer: the option tapped (its position in the list) or the number typed.
export class AnswerDto extends OperationDto {
  @IsUUID() questionId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) choice?: number;
  @IsOptional() @IsString() @MaxLength(40) value?: string;
}
export class ClassPracticeQueryDto { @IsUUID() termId!: string; }
