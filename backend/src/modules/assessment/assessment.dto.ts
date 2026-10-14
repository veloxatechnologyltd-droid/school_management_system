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
// Dated class assessments and the progress views built from them.
export class ClassAssessmentDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsUUID() subjectId!: string;
  @IsIn(['classwork','homework','quiz','class_test','project']) kind!: string;
  @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) title!: string;
  @IsDateString({strict:true}) @date() heldOn!: string;
  @IsNumber({maxDecimalPlaces:2}) @Min(1) @Max(1000) maxMark!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all',{each:true}) indicatorIds?: string[];
}
export class AssessmentListQueryDto { @IsUUID() termId!: string; @IsOptional() @IsUUID() subjectId?: string; }
export class MarkDto { @IsUUID() learnerId!: string; @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(1000) mark!: number; }
export class RecordMarksDto extends OperationDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({each:true}) @Type(() => MarkDto) marks!: MarkDto[]; }
export class CaSuggestionQueryDto { @IsUUID() termId!: string; @IsUUID() subjectId!: string; }
export class ClassProgressQueryDto { @IsUUID() termId!: string; @IsOptional() @IsIn(['week','month']) period?: string; }
export class LearnerProgressQueryDto { @IsOptional() @IsIn(['week','month','term','year']) period?: string; }
// The school's curriculum indicators: pasted in bulk per subject, with where they come from.
export class IndicatorDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) @Matches(/\S/) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) strand?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) subStrand?: string;
  @IsString() @MinLength(3) @MaxLength(400) @Matches(/\S.*\S/) description!: string;
}
export class AddIndicatorsDto extends OperationDto {
  @IsUUID() subjectId!: string;
  @IsIn(['official','local']) origin!: string;
  @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) sourceNote!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) @Matches(/\S/) grade?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({each:true}) @Type(() => IndicatorDto) items!: IndicatorDto[];
}
export class RetireIndicatorDto extends OperationDto { @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) reason!: string; }
export class IndicatorQueryDto { @IsOptional() @IsUUID() subjectId?: string; }
export class GapsQueryDto { @IsUUID() termId!: string; @IsOptional() @IsUUID() subjectId?: string; }
// Support plans: who needs help in what, the agreed action, its owner and when it is reviewed.
export class SupportPlanDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsUUID() subjectId!: string;
  @IsOptional() @IsUUID() indicatorId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @IsUUID('all',{each:true}) learnerIds!: string[];
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) concern!: string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) action!: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  // Written for the learner's family: what helps at home. Never shown to staff as the concern, never names other learners.
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) familyNote?: string;
  @IsDateString({strict:true}) @date() startDate!: string;
  @IsDateString({strict:true}) @date() reviewDate!: string;
}
export class SupportReviewDto extends OperationDto {
  @IsOptional() @IsDateString({strict:true}) @date() reviewedOn?: string;
  @IsIn(['improved','no_change','worse']) outcome!: string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) note!: string;
  @IsIn(['continue','close']) decision!: string;
  @IsOptional() @IsDateString({strict:true}) @date() nextReviewDate?: string;
}
export class SupportListQueryDto { @IsOptional() @IsUUID() classId?: string; @IsOptional() @IsUUID() termId?: string; @IsOptional() @IsIn(['open','closed','all']) status?: string; }
export class OwnersQueryDto { @IsUUID() classId!: string; }
// Practice materials for an indicator: a reference or link, never the material itself.
export class ResourceDto extends OperationDto {
  @IsIn(['worksheet','textbook','link','activity']) kind!: string;
  @IsString() @MinLength(3) @MaxLength(160) @Matches(/\S.*\S/) title!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(500) @Matches(/\S.*\S/) detail?: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^https?:\/\/\S+$/,{message:'The link must start with http:// or https://'}) url?: string;
  @IsOptional() @IsBoolean() forFamilies?: boolean;
}
export class SharingDto extends OperationDto { @IsBoolean() shareWithFamilies!: boolean; @IsOptional() @IsInt() @Min(1) version?: number; }
// A mock exam round: one dated assessment per subject sharing the round's title.
export class MockRoundDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) title!: string;
  @IsDateString({strict:true}) @date() heldOn!: string;
  @IsNumber({maxDecimalPlaces:2}) @Min(1) @Max(1000) maxMark!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all',{each:true}) subjectIds!: string[];
}
