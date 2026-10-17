import { IsIn, IsInt, IsDateString, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';

// A staff member's optional details, sent whole: a field left empty is cleared.
export const EMPLOYMENT_TYPES = ['','Full time','Part time','Contract','Volunteer'] as const;
export class StaffDetailsDto extends OperationDto {
  @IsInt() @Min(0) @Max(1000000) version!: number;
  @IsOptional() @IsString() @MaxLength(30) staffNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(120) qualification?: string;
  @IsOptional() @IsString() @MaxLength(40) licenceNumber?: string;
  @ValidateIf(o => o.dateJoined !== undefined && o.dateJoined !== '') @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) dateJoined?: string;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: string;
  @IsOptional() @IsString() @MaxLength(200) subjects?: string;
  @IsOptional() @IsString() @MaxLength(200) homeAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyRelationship?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyPhone?: string;
}
