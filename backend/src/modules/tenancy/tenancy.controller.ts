import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Put, Query, Req, Res, StreamableFile, ConflictException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Access, isReadOnlySchool } from '../../core/access';
import { PageDto } from '../learners/learners.dto';
class SchoolDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) name!: string;
  // Printed on report cards and receipts. An empty string clears the value.
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) motto?: string;
  @IsInt() @Min(1) version!: number;
}
class LogoDto {
  // A small PNG, JPEG or WebP as a data URL; null removes the logo.
  @IsOptional() @IsString() @MaxLength(98000) @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,{message:'Logo must be a PNG, JPEG or WebP image'}) logo!: string | null;
}
@Controller('api/v1/schools/:schoolId')
export class TenancyController {
  constructor(private readonly access: Access) {}
  @Get()
  school(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,null,async (client,actor) => {
      // logo_tag changes whenever the logo does, so the browser can cache the image by it.
      const result = await client.query('SELECT id,name,address,phone,motto,version,left(md5(logo),12) AS logo_tag FROM schools WHERE id=$1',[schoolId]);
      return {...result.rows[0],role:actor.role,...(isReadOnlySchool(schoolId) ? {readOnly:true} : {})};
    });
  }
  // The image itself, for every member of the school (parents see it on report cards). 404 when none is set.
  @Get('logo')
  async logo(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Res({passthrough:true}) res: Response) {
    const logo = await this.access.school(req,schoolId,null,async client => (await client.query('SELECT logo FROM schools WHERE id=$1',[schoolId])).rows[0]?.logo as string | null);
    if (!logo) throw new NotFoundException('No logo set');
    const [, type, data] = /^data:(image\/[a-z]+);base64,(.*)$/.exec(logo)!;
    res.setHeader('cache-control','private, max-age=300');
    return new StreamableFile(Buffer.from(data,'base64'),{type});
  }
  @Put('logo')
  setLogo(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: LogoDto) {
    return this.access.school(req,schoolId,['headteacher'],async (client,actor) => {
      const logo = body.logo ?? null;
      await client.query('UPDATE schools SET logo=$1 WHERE id=$2',[logo,schoolId]).catch(error => {
        if ((error as {code?:string}).code === '23514') throw new BadRequestException('The logo image is too large. Use a smaller picture');
        throw error;
      });
      await client.query('INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$2,$5)',[randomUUID(),schoolId,actor.membershipId,logo ? 'school.logo.updated' : 'school.logo.removed','{}']);
      return {logo_tag:logo ? createHash('md5').update(logo).digest('hex').slice(0,12) : null};
    },true);
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
