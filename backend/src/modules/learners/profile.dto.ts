import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OperationDto } from './learners.dto';

export const NOTE_CATEGORIES = ['general','classwork','behaviour','attendance','health','home'] as const;
export class LearnerNoteDto extends OperationDto {
  @IsIn(NOTE_CATEGORIES) category!: string;
  @IsString() @MinLength(3) @MaxLength(2000) @Matches(/\S.*\S/s) body!: string;
  // Staff only: also show the note to the learner's verified guardians. A guardian's note is always shared with the school.
  @IsOptional() @IsBoolean() sharedWithFamily?: boolean;
}
export class WithdrawNoteDto extends OperationDto { @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) reason!: string; }
export class ProfileQueryDto { @IsOptional() @IsUUID() termId?: string; }

// A student's optional details, sent whole: a field left empty is cleared. Religion, blood group and health are never required.
export const RELIGIONS = ['','Christian','Muslim','Traditional','Other'] as const;
export const BLOOD_GROUPS = ['','A+','A-','B+','B-','AB+','AB-','O+','O-'] as const;
export class LearnerDetailsDto extends OperationDto {
  @IsInt() @Min(0) @Max(1000000) version!: number;
  @IsOptional() @IsString() @MaxLength(60) nationality?: string;
  @IsOptional() @IsIn(RELIGIONS) religion?: string;
  @IsOptional() @IsString() @MaxLength(200) homeAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) previousSchool?: string;
  @IsOptional() @IsIn(BLOOD_GROUPS) bloodGroup?: string;
  @IsOptional() @IsString() @MaxLength(500) healthNotes?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyRelationship?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyPhone?: string;
}
