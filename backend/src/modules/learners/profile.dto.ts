import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
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
