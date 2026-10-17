import { BadRequestException, Body, ConflictException, Controller, DefaultValuePipe, Get, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { Access, Actor } from '../../core/access';
import { audit } from '../../core/commands';
import { normalizeGhanaPhone } from '../notices/sms.provider';
import { PhoneDto } from '../notices/notices.dto';
import { hashPassword } from '../identity/identity.controller';
import { memberActivity, memberProfile } from './profile';

class NewAccountDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  // An email address, or a Ghana mobile number for people (often guardians) who have no email.
  @IsString() @MinLength(3) @MaxLength(200) email!: string;
  @IsIn(['teacher','frontdesk','accountant','guardian']) role!: string;
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(16),byte => alphabet[byte % alphabet.length]).join('');
}
// Headteachers manage accounts inside their own school; the database functions re-check the caller.
@Controller('api/v1/schools/:schoolId/accounts')
export class AccountsController {
  constructor(private readonly access: Access) {}
  private run<T>(req: Request, schoolId: string, write: boolean, work: (client: PoolClient, actor: Actor) => Promise<T>) {
    return this.access.school(req,schoolId,['headteacher'],async (client,actor) => {
      try { return await work(client,actor); }
      catch (error) {
        const pg = error as {code?:string;message?:string};
        if (pg.code === '23505') throw new ConflictException('That email address already has an account');
        if (pg.code === '22023') throw new BadRequestException(pg.message);
        if (pg.code === 'P0002') throw new NotFoundException(pg.message);
        throw error;
      }
    },write);
  }
  @Get()
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.run(req,schoolId,false,async client => ({items:(await client.query('SELECT user_id,membership_id,display_name,login,role,revoked_at,must_change_password,phone FROM staff_list()')).rows}));
  }
  // One staff member's page (classes, what they have done lately, their sign-in's history).
  @Get(':membershipId')
  profile(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('membershipId',new ParseUUIDPipe()) membershipId: string) {
    return this.run(req,schoolId,false,client => memberProfile(client,schoolId,membershipId));
  }
  @Get(':membershipId/activity')
  activity(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('membershipId',new ParseUUIDPipe()) membershipId: string,
    @Query('offset',new DefaultValuePipe(0),ParseIntPipe) offset: number) {
    return this.run(req,schoolId,false,async client => {
      if (!(await client.query('SELECT 1 FROM staff_list() WHERE membership_id=$1 AND role<>\'guardian\'',[membershipId])).rowCount) throw new NotFoundException('Staff member unavailable');
      return memberActivity(client,schoolId,membershipId,Math.max(0,offset),25);
    });
  }
  @Post()
  create(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: NewAccountDto) {
    const password = temporaryPassword(), phone = normalizeGhanaPhone(body.email), login = phone ?? body.email.trim().toLowerCase();
    if (!phone && !emailPattern.test(login)) throw new BadRequestException('Enter an email address or a Ghana mobile number such as 024 123 4567');
    return this.run(req,schoolId,true,async (client,actor) => {
      const id = (await client.query('SELECT staff_create($1,$2,$3,$4) AS id',[body.name.trim(),login,await hashPassword(password),body.role])).rows[0].id as string;
      // A phone sign-in is also the number notices are sent to.
      if (phone) await client.query('SELECT staff_set_phone($1,$2)',[id,phone]);
      await audit(client,actor,'account.created',id,{role:body.role,signIn:phone ? 'phone' : 'email'});
      return {userId:id,email:login,role:body.role,temporaryPassword:password};
    });
  }
  @Post(':userId/reset-password')
  reset(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    const password = temporaryPassword();
    return this.run(req,schoolId,true,async (client,actor) => {
      await client.query('SELECT staff_reset_password($1,$2)',[userId,await hashPassword(password)]);
      await audit(client,actor,'account.password_reset',userId);
      return {temporaryPassword:password};
    });
  }
  @Post(':userId/phone')
  phone(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string,@Body() body: PhoneDto) {
    const phone = body.phone.trim() === '' ? null : normalizeGhanaPhone(body.phone);
    if (body.phone.trim() !== '' && !phone) throw new BadRequestException('Enter a Ghana mobile number such as 024 123 4567');
    return this.run(req,schoolId,true,async (client,actor) => {
      await client.query('SELECT staff_set_phone($1,$2)',[userId,phone]);
      await audit(client,actor,'account.phone_set',userId,{cleared:phone === null});
      return {phone};
    });
  }
  @Post(':userId/revoke')
  revoke(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    return this.run(req,schoolId,true,async (client,actor) => {
      await client.query('SELECT staff_revoke($1)',[userId]);
      await audit(client,actor,'account.revoked',userId);
      return {revoked:true};
    });
  }
}
