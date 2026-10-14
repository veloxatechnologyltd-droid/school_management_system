import { Body, Controller, HttpException, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';
import { AssistantService } from './assistant.service';

class TurnDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(4000) text!: string;
}
class ChatDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TurnDto) messages!: TurnDto[];
}

// Per-person request budget (per API process) so one open tab cannot run up the school's AI bill.
const WINDOW_MS = 60_000;
const recent = new Map<string, number[]>();
function throttle(key: string) {
  const limit = Number(process.env.ASSISTANT_PER_MINUTE) || 8, now = Date.now(), times = (recent.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (times.length >= limit) throw new HttpException('You are asking very quickly. Wait a minute and try again', HttpStatus.TOO_MANY_REQUESTS);
  times.push(now); recent.set(key, times);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some(t => now - t < WINDOW_MS)) recent.delete(k);
}

// The school assistant: a question (with the earlier turns of the conversation, kept by the browser) in, a grounded answer out.
// Read-only; every tool call re-checks the session, membership, role and class assignment.
@Controller('api/v1/schools/:schoolId/assistant')
export class AssistantController {
  constructor(private readonly access: Access, private readonly assistant: AssistantService) {}
  @Post('chat')
  async chat(@Req() req: Request, @Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Body() body: ChatDto) {
    this.assistant.validate(body.messages);
    const roles = ['headteacher', 'teacher'];
    const context = await this.access.school(req, schoolId, roles, async (client, actor) => { throttle(actor.membershipId); return this.assistant.prepare(client, actor); }, true);
    const done = await this.assistant.converse(work => this.access.school(req, schoolId, roles, work), context, body.messages);
    return this.access.school(req, schoolId, roles, (client, actor) => this.assistant.finish(client, actor, done), true);
  }
}
