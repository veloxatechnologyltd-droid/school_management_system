import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { OperationDto } from '../learners/learners.dto';

const trimmed = Transform(({ value }) => typeof value === 'string' ? value.trim() : value);
export class ApproveItemDto {
  @IsUUID() indicatorId!: string;
  // Needed only for a topic that names no class level.
  @IsOptional() @trimmed @IsString() @MinLength(1) @MaxLength(40) grade?: string;
}
export class ApproveTopicsDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(80) @ValidateNested({each:true}) @Type(() => ApproveItemDto) items!: ApproveItemDto[];
}
export class TopicsQueryDto { @IsOptional() @IsUUID() termId?: string; }
export class ContentQueryDto { @IsString() @MinLength(1) @MaxLength(40) grade!: string; }
export class ReasonDto extends OperationDto { @trimmed @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) @Matches(/^[^\u0000]*$/) reason!: string; }
export class HandleFlagDto extends OperationDto {
  @IsIn(['was_wrong','was_fine']) outcome!: string;
  @IsOptional() @trimmed @IsString() @MinLength(1) @MaxLength(300) note?: string;
}
export class FlagQuestionDto extends OperationDto {
  @IsIn(['wrong_answer','unclear','not_taught','other']) reason!: string;
  @IsOptional() @trimmed @IsString() @MinLength(1) @MaxLength(300) note?: string;
}

export class WriteLearningNoteDto extends OperationDto {
  @trimmed @IsString() @MinLength(5) @MaxLength(240) @Matches(/^[^\u0000]*$/) note!: string;
  @IsOptional() @IsUUID() indicatorId?: string;
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) until?: string;
}
