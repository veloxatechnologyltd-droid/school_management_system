import { Body, Controller, ForbiddenException, Get, NotFoundException, ConflictException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { Access } from '../../core/access';
import { Database } from '../../core/database';
import { PageDto } from '../learners/learners.dto';
import { hashPassword } from '../identity/identity.controller';
import { BudgetDto, StaffDto } from '../content/content.dto';
import { ContentDraftingService } from '../content/drafting.service';

class NewSchoolDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) name!: string;
  @IsString() @MinLength(2) @MaxLength(120) headteacherName!: string;
  @IsEmail() @MaxLength(200) headteacherEmail!: string;
}
class NewUserDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(200) email!: string;
  @IsIn(['headteacher','teacher','accountant','frontdesk','guardian']) role!: string;
}
// Shown once to the platform administrator; 16 characters from an unambiguous alphabet.
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(16),byte => alphabet[byte % alphabet.length]).join('');
}
@Controller('api/v1/platform')
export class PlatformController {
  constructor(private readonly db: Database, private readonly access: Access, private readonly drafting: ContentDraftingService) {}
  private async admin<T>(req: Request, write: boolean, work: (client: PoolClient) => Promise<T>) {
    try {
      return await this.db.transaction(async client => {
        await this.access.identity(client,req,write);
        if (!(await client.query('SELECT is_platform_admin() AS admin')).rows[0].admin) throw new ForbiddenException('Platform administrator required');
        return work(client);
      });
    } catch (error) {
      const pg = error as {code?:string;message?:string};
      if (pg.code === '23505') throw new ConflictException('That email address already has an account');
      if (pg.code === 'P0002') throw new NotFoundException(pg.message);
      throw error;
    }
  }
  @Get('schools')
  schools(@Req() req: Request,@Query() page: PageDto) {
    return this.admin(req,false,async client => {
      const all = (await client.query('SELECT id,name,members::int,headteachers::int FROM platform_schools()')).rows;
      return {items:all.slice(page.offset,page.offset+page.limit),total:all.length,limit:page.limit,offset:page.offset};
    });
  }
  @Post('schools')
  createSchool(@Req() req: Request,@Body() body: NewSchoolDto) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      const row = (await client.query('SELECT school_id,user_id FROM platform_create_school($1,$2,$3,$4)',[body.name.trim(),body.headteacherName.trim(),body.headteacherEmail,await hashPassword(password)])).rows[0];
      return {schoolId:row.school_id,headteacher:{userId:row.user_id,email:body.headteacherEmail.toLowerCase(),temporaryPassword:password}};
    });
  }
  @Post('schools/:schoolId/users')
  createUser(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: NewUserDto) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      const id = (await client.query('SELECT platform_create_user($1,$2,$3,$4,$5) AS id',[schoolId,body.name.trim(),body.email,await hashPassword(password),body.role])).rows[0].id;
      return {userId:id,email:body.email.toLowerCase(),role:body.role,temporaryPassword:password};
    });
  }
  @Post('schools/:schoolId/users/:userId/reset-password')
  reset(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      await client.query('SELECT platform_reset_password($1,$2,$3)',[schoolId,userId,await hashPassword(password)]);
      return {temporaryPassword:password};
    });
  }
  @Post('schools/:schoolId/enter')
  enter(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.admin(req,true,async client => ({membershipId:(await client.query('SELECT platform_enter_school($1) AS id',[schoolId])).rows[0].id}));
  }

  // Content roles (author, reviewer, lead) for the shared content library. They are granted here, not by schools or content leads.
  @Get('content-staff')
  contentStaff(@Req() req: Request) {
    return this.admin(req,false,async client => ({items:(await client.query('SELECT id,user_id AS "userId",name,login,role,granted_at AS "grantedAt",revoked_at AS "revokedAt" FROM platform_content_staff()')).rows}));
  }
  // With a name: a new account with a temporary password. Without: an existing account found by its email address.
  @Post('content-staff')
  addContentStaff(@Req() req: Request,@Body() body: StaffDto) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      try {
        if (body.name) {
          const userId = (await client.query('SELECT platform_create_content_user($1,$2,$3,$4) AS id',[body.name.trim(),body.email,await hashPassword(password),body.role])).rows[0].id;
          return {userId,email:body.email.toLowerCase(),role:body.role,temporaryPassword:password};
        }
        const user = (await client.query('SELECT id FROM users WHERE synthetic_login=$1',[body.email.trim().toLowerCase()])).rows[0];
        if (!user) throw new NotFoundException('No account has that email address. Add a name to create one');
        await client.query('SELECT platform_grant_content_role($1,$2)',[user.id,body.role]);
        return {userId:user.id as string,email:body.email.toLowerCase(),role:body.role};
      } catch (error) {
        if ((error as {code?:string;constraint?:string}).code === '23505' && (error as {constraint?:string}).constraint === 'content_staff_active') throw new ConflictException('They already hold that role');
        throw error;
      }
    });
  }
  @Post('content-staff/:id/revoke')
  revokeContentStaff(@Req() req: Request,@Param('id',new ParseUUIDPipe()) id: string) {
    return this.admin(req,true,async client => { await client.query('SELECT platform_revoke_content_role($1)',[id]); return {revoked:true}; });
  }

  // Claude drafting for the content library is paid for by the platform: the administrator sets the monthly budget (in tokens) and
  // sees every run, who asked and what it cost. No prompt or question text is kept in the log.
  @Get('content-drafting')
  contentDrafting(@Req() req: Request) {
    return this.admin(req,false,async client => {
      const { remainingTokens: _remaining, ...budget } = await this.drafting.budget(client);
      return {...budget,runs:await this.drafting.runs(client,50)};
    });
  }
  @Put('content-drafting/budget')
  setDraftingBudget(@Req() req: Request,@Body() body: BudgetDto) {
    return this.admin(req,true,async client => {
      try {
        const version = (await client.query('SELECT platform_set_content_ai_budget($1,$2) AS version',[body.monthlyTokenCap,body.version])).rows[0].version as number;
        return {monthlyTokenCap:body.monthlyTokenCap,version};
      } catch (error) {
        if ((error as {code?:string}).code === '40001') throw new ConflictException('The budget changed. Reload before saving');
        throw error;
      }
    });
  }
}
