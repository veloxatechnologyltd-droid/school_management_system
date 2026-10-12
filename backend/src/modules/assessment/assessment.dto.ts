import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';

const date = () => Matches(/^\d{4}-\d{2}-\d{2}$/);
export class SubjectDto extends OperationDto { @IsString() @MinLength(2) @MaxLength(80) @Matches(/\S.*\S/) name!: string; }
export class TermDto extends OperationDto {
  @IsUUID() academicYearId!: string;
  @IsString() @MinLength(2) @MaxLength(80) @Matches(/\S.*\S/) name!: string;
  @IsDateString({strict:true}) @date() startDate!: string;
  @IsDateString({strict:true}) @date() endDate!: string;
}
export class BandDto {
  @IsNumber() @Min(0) @Max(100) min!: number;
  @IsString() @MinLength(1) @MaxLength(10) grade!: string;
  @IsString() @MaxLength(40) remark!: string;
}
export class PolicyDto extends OperationDto {
  @IsInt() @Min(0) @Max(100) caWeight!: number;
  @IsInt() @Min(0) @Max(100) examWeight!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @ValidateNested({each:true}) @Type(() => BandDto) bands!: BandDto[];
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) sourceNote!: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
export class ScoreDto {
  @IsUUID() learnerId!: string;
  @IsIn(['ca','exam']) kind!: string;
  @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(100) score!: number;
}
export class RecordScoresDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsUUID() subjectId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(() => ScoreDto) scores!: ScoreDto[];
}
// Report cards for printing across the school: one term, optionally one level.
export class SchoolReportsQueryDto { @IsUUID() termId!: string; @IsOptional() @IsIn(['Nursery','KG','Primary','JHS']) level?: string; }
export class TermQueryDto { @IsUUID() termId!: string; @IsOptional() @IsUUID() subjectId?: string; }
export class PublishDto extends OperationDto { @IsUUID() termId!: string; @IsOptional() @IsBoolean() acknowledgeIncomplete?: boolean; }
export class ReopenDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsUUID() learnerId!: string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) reason!: string;
}
export class ReissueDto extends OperationDto { @IsUUID() termId!: string; @IsUUID() learnerId!: string; @IsOptional() @IsBoolean() acknowledgeIncomplete?: boolean; }
export class RemarkDto {
  @IsUUID() learnerId!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) conduct?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) attitude?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) interest?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) @Matches(/\S.*\S/) remark?: string;
}
export class RemarksDto extends OperationDto {
  @IsUUID() termId!: string;
  // The class teacher writes conduct, attitude, interest and a remark; the headteacher adds the head's remark.
  @IsIn(['class_teacher','headteacher']) author!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({each:true}) @Type(() => RemarkDto) items!: RemarkDto[];
}
