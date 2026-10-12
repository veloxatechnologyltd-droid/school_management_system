import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';

export class NoticeDto extends OperationDto {
  @IsString() @MinLength(3) @MaxLength(100) @Matches(/\S.*\S/) title!: string;
  // Kept short on purpose: one SMS segment-ish message that guardians on basic phones can read.
  @IsString() @MinLength(3) @MaxLength(320) @Matches(/\S.*\S/) body!: string;
  // 'owing': the families who still owe on the chosen term's bills.
  @IsIn(['school','class','owing']) audience!: string;
  @ValidateIf(dto => dto.audience === 'class') @IsUUID() classId?: string;
  @ValidateIf(dto => dto.audience === 'owing') @IsUUID() termId?: string;
}
export class ApproveNoticeDto extends OperationDto { @IsInt() @Min(1) version!: number; }
export class CancelNoticeDto extends OperationDto { @IsString() @MinLength(3) @MaxLength(200) @Matches(/\S.*\S/) reason!: string; }
export class RetryDto extends OperationDto { @IsOptional() @IsString() @MaxLength(0) _?: string; }
export class PhoneDto { @IsString() @MaxLength(30) phone!: string; }
