import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';
export class TermQueryDto { @IsOptional() @IsUUID() termId?: string }
export class RoomDto extends OperationDto { @IsString() @MinLength(2) @MaxLength(60) @Matches(/\S.*\S/) name!: string }
export class DraftDto extends OperationDto { @IsUUID() termId!: string }
export class PeriodDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) starts!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) ends!: string;
  @IsIn(['lesson', 'break']) kind!: 'lesson' | 'break';
  @IsOptional() @IsString() @MinLength(2) @MaxLength(30) label?: string;
}
export class PeriodsDto { @IsOptional() @IsUUID() operationId?: string; @IsArray() @ArrayMaxSize(16) @ValidateNested({ each: true }) @Type(() => PeriodDto) periods!: PeriodDto[] }
export class LessonDto {
  @IsOptional() @IsUUID() operationId?: string;
  @IsUUID() classId!: string;
  @IsInt() @Min(1) @Max(5) weekday!: number;
  @IsInt() @Min(1) @Max(16) period!: number;
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) @Matches(/\S.*\S/) label?: string;
  @IsOptional() @IsUUID() teacherMembershipId?: string;
  @IsOptional() @IsUUID() roomId?: string;
}
