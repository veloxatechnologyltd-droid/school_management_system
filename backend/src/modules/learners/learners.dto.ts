import { IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength } from 'class-validator';
import { Type } from 'class-transformer';
export class PageDto {
  @Type(()=>Number) @IsInt() @Min(0) @Max(100000) offset=0;
  @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit=25;
  @IsOptional() @IsString() @MaxLength(120) search?:string;
}
export class AdmissionPageDto extends PageDto { @IsOptional() @IsIn(['open','enrolled','declined']) stage?:'open'|'enrolled'|'declined' }
export class ClassPageDto extends PageDto { @IsOptional() @IsUUID() academicYearId?:string }
export class OperationDto { @IsUUID() operationId!:string }
export class YearDto extends OperationDto {
  @IsString() @MinLength(3) @MaxLength(80) @Matches(/\S.{1,}\S/) name!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
}
export class ClassDto extends OperationDto {
  @IsString() @MinLength(1) @MaxLength(80) @Matches(/\S/) name!:string;
  @IsIn(['Nursery','KG','Primary','JHS']) level!:string;
  @IsInt() @Min(1) @Max(500) capacity!:number;
  @IsUUID() academicYearId!:string;
}
export class AdmissionDto extends OperationDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) fullName!:string;
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth?:string;
  @IsOptional() @IsIn(['female','male']) sex?:string;
  @IsUUID() classId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9/-]{1,39}$/) admissionNumber!:string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) guardianName?:string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) @Matches(/\S.*\S/) guardianRelationship?:string;
  @IsOptional() @IsString() @MaxLength(20) guardianPhone?:string;
}
export class AdmissionNoteDto extends OperationDto {
  @IsString() @MinLength(3) @MaxLength(1000) @Matches(/\S.{1,}\S/s) note!:string;
}
export class TransitionDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsIn(['review','offer','waitlist','decline','accept','enrol']) action!:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason?:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) capacityOverrideReason?:string;
}
export class TransferDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsUUID() classId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!:string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason!:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) capacityOverrideReason?:string;
}
export class WithdrawalDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!:string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason!:string;
}
export class LearnerSexDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsIn(['female','male']) sex!:string;
}
export class CensusDto { @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day?:string }
