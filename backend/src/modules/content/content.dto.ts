import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageDto } from '../learners/learners.dto';

export const LEVELS = ['Basic 1','Basic 2','Basic 3','Basic 4','Basic 5','Basic 6','JHS 1','JHS 2','JHS 3'];
const STATUSES = ['draft','in_review','published','rejected','retired'];

export class IndicatorDto {
  @IsString() @MinLength(2) @MaxLength(60) @Matches(/\S.*\S/) subject!: string;
  @IsIn(LEVELS) level!: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(120) strand?: string;
  @IsOptional() @IsString() @MaxLength(120) subStrand?: string;
  @IsString() @MinLength(3) @MaxLength(400) @Matches(/\S.*\S/) description!: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsInt({each:true}) @Min(1,{each:true}) @Max(3,{each:true}) termGuidance?: number[];
  @IsIn(['official','platform']) origin!: string;
  @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) sourceNote!: string;
}
export class CatalogueQueryDto extends PageDto {
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsString() @MaxLength(60) subject?: string;
  @IsOptional() @IsIn(['true']) includeRetired?: string;
}
export class ReasonDto { @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.*\S/) reason!: string; }
export class NoteDto { @IsOptional() @IsString() @MinLength(3) @MaxLength(500) note?: string; }
export class RejectDto { @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) note!: string; }

export class NewItemDto {
  @IsIn(['question','guide']) kind!: string;
  @IsUUID() indicatorId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(3) level?: number;
  @IsObject() body!: Record<string, unknown>;
}
export class BodyDto { @IsObject() body!: Record<string, unknown>; }
export class ItemsQueryDto extends PageDto {
  @IsOptional() @IsUUID() indicatorId?: string;
  @IsOptional() @IsIn(['question','guide']) kind?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsIn(['true']) mine?: string;
}

// Claude drafts `count` questions (20 unless told otherwise) for one catalogue entry at one difficulty.
export class BatchDto {
  @IsUUID() indicatorId!: string;
  @IsInt() @Min(1) @Max(3) level!: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) count?: number;
}
export class BudgetDto {
  @IsInt() @Min(0) @Max(200_000_000) monthlyTokenCap!: number;
  @IsInt() @Min(1) @Max(2_000_000_000) version!: number;
}

export class StaffDto {
  @IsIn(['author','reviewer','lead']) role!: string;
  // An existing account is found by its email address; a name makes a new account with a temporary password.
  @IsEmail() @MaxLength(200) email!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) @Matches(/\S.*\S/) name?: string;
}
