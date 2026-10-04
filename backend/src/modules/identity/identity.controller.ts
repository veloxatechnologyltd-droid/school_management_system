import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, ForbiddenException, BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Database } from '../../core/database';
import { Access, digest, sessionToken } from '../../core/access';
import { decryptSecret, encryptSecret, hashRecovery, newRecoveryCodes, newSecret, verifyTotp } from '../../core/totp';
const scryptAsync = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scryptAsync(password,salt,64)).toString('hex')}`;
}
class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword!: string;
}
class CodeDto { @IsString() @MinLength(6) @MaxLength(20) code!: string; }
class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) schoolName!: string;
  @IsEmail() @MaxLength(200) email!: string;
  @IsString() @MinLength(12) @MaxLength(200) password!: string;
}
class LoginDto {
  @IsEmail() @MaxLength(200) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}
// Failed sign-ins per account (attempted email, known or not): 10 failures lock that email for 15 minutes on this instance.
const failures = new Map<string,{count:number;until:number}>();
const lockAfter = 10, lockWindow = 15 * 60_000;
function throttled(email: string, now = Date.now()) {
  for (const [key,value] of failures) if (value.until < now) failures.delete(key);
  const entry = failures.get(email);
  return Boolean(entry && entry.count >= lockAfter);
}
function failed(email: string, now = Date.now()) {
  if (failures.size > 10_000) failures.clear();
  const entry = failures.get(email) ?? { count: 0, until: now + lockWindow };
  entry.count++; failures.set(email, entry);
}
@Controller('api/v1/auth')
export class IdentityController {
  constructor(private readonly db: Database, private readonly access: Access) {}
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    const syntheticLocal = process.env.DEV_AUTH === 'synthetic-local' && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!syntheticLocal && process.env.AUTH_MODE !== 'password') throw new ForbiddenException('Synthetic identity is disabled');
    // Phones capitalise the first letter and people add spaces; accounts are stored lower-case.
    const email = body.email.trim().toLowerCase();
    if (throttled(email)) throw new HttpException('Too many failed sign-ins for this account. Try again in 15 minutes or ask your school administrator to reset the password.',429);
    const identity = await this.db.pool.query('SELECT id,password_hash FROM users WHERE synthetic_login=$1',[email]);
    const [salt,hash] = identity.rows[0]?.password_hash.split(':') ?? ['missing', '00'.repeat(64)];
    if (!timingSafeEqual(await scryptAsync(body.password,salt,64),Buffer.from(hash,'hex')) || !identity.rowCount) { failed(email); throw new UnauthorizedException('Sign-in details were not accepted'); }
    failures.delete(email);
    return this.startSession(identity.rows[0].id,req,res);
  }
  private async startSession(userId: string, req: Request, res: Response) {
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    await this.db.transaction(async client => {
      if (sessionToken(req)) await client.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]);
      await client.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(token),userId,csrf]);
    });
    res.cookie('school_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api',maxAge:8*3600*1000});
    return {csrfToken:csrf};
  }
  // Open sign-up: creates a new school and its headteacher, then signs them in. No email verification (pilot decision).
  @Post('register')
  async register(@Body() body: RegisterDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    const syntheticLocal = process.env.DEV_AUTH === 'synthetic-local' && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!syntheticLocal && process.env.AUTH_MODE !== 'password') throw new ForbiddenException('Sign-up is disabled');
    let userId: string;
    try {
      userId = (await this.db.pool.query('SELECT self_register_school($1,$2,$3,$4) AS id',[body.schoolName.trim(),body.name.trim(),body.email.trim(),await hashPassword(body.password)])).rows[0].id;
    } catch (error) {
      if ((error as {code?:string}).code === '23505') throw new ConflictException('That email address already has an account. Sign in instead.');
      throw error;
    }
    return this.startSession(userId,req,res);
  }
  @Get('session')
  async session(@Req() req: Request) {
    return this.db.transaction(async client => {
      const identity = await this.access.identity(client,req,false,true,true);
      const admin = (await client.query('SELECT is_platform_admin() AS admin')).rows[0].admin as boolean;
      const memberships = await client.query('SELECT school_id,role FROM memberships WHERE user_id=$1 AND revoked_at IS NULL ORDER BY school_id',[identity.user_id]);
      const schools = [];
      for (const membership of memberships.rows) {
        await client.query("SELECT set_config('app.school_id',$1,true)",[membership.school_id]);
        const school = await client.query('SELECT id,name FROM schools WHERE id=$1',[membership.school_id]);
        schools.push({...school.rows[0],role:membership.role});
      }
      const mfa = (await client.query('SELECT confirmed_at FROM user_mfa WHERE user_id=$1',[identity.user_id])).rows[0];
      return {displayName:identity.display_name,csrfToken:identity.csrf_token,schools:identity.mfa_required && !identity.mfa_verified_at ? [] : schools,platformAdmin:admin,mustChangePassword:identity.must_change_password as boolean,
        mfaRequired:identity.mfa_required as boolean,mfaEnrolled:Boolean(mfa?.confirmed_at),mfaVerified:Boolean(identity.mfa_verified_at)};
    });
  }
  @Post('change-password')
  async changePassword(@Req() req: Request,@Body() body: ChangePasswordDto) {
    if (body.newPassword === body.currentPassword) throw new BadRequestException('Choose a password different from the current one');
    await this.db.transaction(async client => {
      const identity = await this.access.identity(client,req,true,true,true);
      const current = (await client.query('SELECT password_hash FROM users WHERE id=$1',[identity.user_id])).rows[0].password_hash as string;
      const [salt,hash] = current.split(':');
      if (!timingSafeEqual(await scryptAsync(body.currentPassword,salt,64),Buffer.from(hash,'hex'))) throw new UnauthorizedException('Current password was not accepted');
      await client.query('SELECT change_own_password($1,$2)',[await hashPassword(body.newPassword),digest(sessionToken(req))]);
    });
    return {changed:true};
  }
  // Second sign-in step. Setup returns the secret once; it is confirmed by proving a first code, which also returns recovery codes once.
  @Post('mfa/setup')
  async mfaSetup(@Req() req: Request) {
    return this.db.transaction(async client => {
      const identity = await this.access.identity(client,req,true,true,true);
      if (!identity.mfa_required) throw new BadRequestException('Your role does not use a second sign-in step');
      const existing = (await client.query('SELECT confirmed_at FROM user_mfa WHERE user_id=$1',[identity.user_id])).rows[0];
      if (existing?.confirmed_at) throw new ConflictException('A second sign-in step is already set up');
      const secret = newSecret();
      if (existing) await client.query('UPDATE user_mfa SET secret_ciphertext=$2 WHERE user_id=$1',[identity.user_id,encryptSecret(secret)]);
      else await client.query('INSERT INTO user_mfa(user_id,secret_ciphertext) VALUES($1,$2)',[identity.user_id,encryptSecret(secret)]);
      return {secret,otpauthUrl:`otpauth://totp/School%20workspace:${encodeURIComponent(identity.display_name)}?secret=${secret}&issuer=School%20workspace&digits=6&period=30`};
    });
  }
  @Post('mfa/confirm')
  async mfaConfirm(@Req() req: Request,@Body() body: CodeDto) {
    return this.db.transaction(async client => {
      const identity = await this.access.identity(client,req,true,true,true);
      const row = (await client.query('SELECT secret_ciphertext,confirmed_at,last_used_step,locked_until FROM user_mfa WHERE user_id=$1 FOR UPDATE',[identity.user_id])).rows[0];
      if (!row || row.confirmed_at) throw new ConflictException('Start the setup first');
      const step = verifyTotp(decryptSecret(row.secret_ciphertext),body.code,Number(row.last_used_step));
      if (step === null) throw new UnauthorizedException('That code was not accepted');
      const codes = newRecoveryCodes();
      await client.query('UPDATE user_mfa SET confirmed_at=now(),last_used_step=$2,recovery_hashes=$3,failed_attempts=0 WHERE user_id=$1',[identity.user_id,step,JSON.stringify(codes.map(hashRecovery))]);
      await client.query('UPDATE sessions SET mfa_verified_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]);
      return {recoveryCodes:codes};
    });
  }
  @Post('mfa/verify')
  async mfaVerify(@Req() req: Request,@Body() body: CodeDto) {
    let outcome = 'bad' as 'ok' | 'bad' | 'locked';
    await this.db.transaction(async client => {
      const identity = await this.access.identity(client,req,true,true,true);
      const row = (await client.query('SELECT secret_ciphertext,confirmed_at,last_used_step,failed_attempts,locked_until,recovery_hashes FROM user_mfa WHERE user_id=$1 FOR UPDATE',[identity.user_id])).rows[0];
      if (!row?.confirmed_at) throw new ConflictException('Set up the second sign-in step first');
      if (row.locked_until && new Date(row.locked_until) > new Date()) { outcome = 'locked'; return; }
      const step = verifyTotp(decryptSecret(row.secret_ciphertext),body.code,Number(row.last_used_step));
      const recovery = (row.recovery_hashes as string[]).includes(hashRecovery(body.code));
      if (step !== null || recovery) {
        await client.query('UPDATE user_mfa SET failed_attempts=0,locked_until=NULL,last_used_step=$2,recovery_hashes=$3 WHERE user_id=$1',[identity.user_id,step ?? row.last_used_step,JSON.stringify(recovery ? (row.recovery_hashes as string[]).filter(hash => hash !== hashRecovery(body.code)) : row.recovery_hashes)]);
        await client.query('UPDATE sessions SET mfa_verified_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]);
        outcome = 'ok'; return;
      }
      const failed = row.failed_attempts + 1;
      await client.query("UPDATE user_mfa SET failed_attempts=CASE WHEN $2::int>=5 THEN 0 ELSE $2::int END,locked_until=CASE WHEN $2::int>=5 THEN now()+interval '5 minutes' ELSE NULL END WHERE user_id=$1",[identity.user_id,failed]);
    });
    if (outcome === 'locked') throw new HttpException('Too many attempts. Try again in a few minutes',429);
    if (outcome !== 'ok') throw new UnauthorizedException('That code was not accepted');
    return {verified:true};
  }
  @Post('logout')
  async logout(@Req() req: Request,@Res({passthrough:true}) res: Response) {
    await this.db.transaction(async client => { await this.access.identity(client,req,true,true,true); await client.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]); });
    res.clearCookie('school_session',{path:'/api'}); return {signedOut:true};
  }
}
