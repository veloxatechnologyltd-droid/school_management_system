import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, ConflictException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Access } from '../../core/access';
import { PageDto } from '../learners/learners.dto';
class SchoolDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) name!: string;
  // Printed on report cards and receipts. An empty string clears the value.
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) motto?: string;
  @IsInt() @Min(1) version!: number;
}
@Controller('api/v1/schools/:schoolId')
export class TenancyController {
  constructor(private readonly access: Access) {}
  @Get()
  school(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,null,async (client,actor) => {
      const result = await client.query('SELECT id,name,address,phone,motto,version FROM schools WHERE id=$1',[schoolId]);
      return {...result.rows[0],role:actor.role};
    });
  }
  @Patch()
  update(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: SchoolDto) {
    return this.access.school(req,schoolId,['headteacher'],async (client,actor) => {
      // Fields left out of the request keep their value; an empty string clears it.
      const values = [body.name.trim(),schoolId,body.version,body.address?.trim() || null,body.phone?.trim() || null,body.motto?.trim() || null,body.address !== undefined,body.phone !== undefined,body.motto !== undefined];
      const result = await client.query(`UPDATE schools SET name=$1,address=CASE WHEN $7 THEN $4 ELSE address END,phone=CASE WHEN $8 THEN $5 ELSE phone END,motto=CASE WHEN $9 THEN $6 ELSE motto END,version=version+1
        WHERE id=$2 AND version=$3 RETURNING id,name,address,phone,motto,version`,values).catch(error => {
        if ((error as {code?:string}).code === '23514') throw new BadRequestException('Address must be 3–200 characters, phone 7–40 and motto 2–120');
        throw error;
      });
      if (!result.rowCount) throw new ConflictException('School details changed. Reload before saving');
      await client.query('INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$2,$5)',[randomUUID(),schoolId,actor.membershipId,'school.details.updated',JSON.stringify({version:result.rows[0].version})]);
      return result.rows[0];
    },true);
  }
  @Get('audit')
  audit(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() page: PageDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => {
      const total = Number((await client.query('SELECT count(*) FROM audit_events WHERE school_id=$1',[schoolId])).rows[0].count);
      const items = (await client.query('SELECT id,action,created_at,metadata FROM audit_events WHERE school_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[schoolId,page.limit,page.offset])).rows;
      return {items,total,limit:page.limit,offset:page.offset};
    });
  }
}
