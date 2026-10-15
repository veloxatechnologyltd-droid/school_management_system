import { Body, ConflictException, Controller, ForbiddenException, Get, HttpException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PoolClient } from 'pg';
import { Access } from '../../core/access';
import { Database } from '../../core/database';
import { BodyDto, CatalogueQueryDto, IndicatorDto, ItemsQueryDto, NewItemDto, NoteDto, ReasonDto, RejectDto } from './content.dto';
import { ContentService } from './content.service';

// The database refuses what the rules forbid (a reviewer approving their own item, a frozen version being reworded);
// these say so in plain words instead of a database error.
function plain(error: unknown) {
  const pg = error as { code?: string; message?: string; constraint?: string; routine?: string };
  if (error instanceof HttpException || typeof pg.code !== 'string') return error;
  // Only the messages our own triggers raise (RAISE EXCEPTION) are shown; a privilege or constraint error would name tables and columns.
  const ours = pg.routine === 'exec_stmt_raise';
  if (pg.code === '42501') return new ForbiddenException(ours ? pg.message : 'Your content role cannot do this');
  if (pg.code === '23514') return new ConflictException(ours ? pg.message : 'That change is not allowed by the content rules');
  if (pg.code === '23505') return new ConflictException('Someone else changed this at the same time. Reload and try again');
  return error;
}

// Everything here is for the content team (platform-level roles, separate from school roles and from the platform administrator).
@Controller('api/v1/content')
export class ContentController {
  constructor(private readonly db: Database, private readonly access: Access, private readonly content: ContentService) {}
  private async staff<T>(req: Request, write: boolean, work: (client: PoolClient, userId: string) => Promise<T>) {
    try {
      return await this.db.transaction(async client => {
        const session = await this.access.identity(client, req, write);
        await this.content.need(client, 'staff', 'Content access is for the content team');
        return work(client, session.user_id as string);
      });
    } catch (error) { throw plain(error); }
  }

  @Get('me')
  me(@Req() req: Request) { return this.staff(req, false, (client, userId) => this.content.me(client, userId)); }

  @Get('catalogue')
  catalogue(@Req() req: Request, @Query() query: CatalogueQueryDto) { return this.staff(req, false, client => this.content.catalogue(client, query)); }
  @Post('catalogue')
  addIndicator(@Req() req: Request, @Body() body: IndicatorDto) { return this.staff(req, true, (client, userId) => this.content.addIndicator(client, userId, body)); }
  @Post('catalogue/:id/retire')
  retireIndicator(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReasonDto) { return this.staff(req, true, (client, userId) => this.content.retireIndicator(client, userId, id, body.reason)); }

  @Get('items')
  items(@Req() req: Request, @Query() query: ItemsQueryDto) { return this.staff(req, false, (client, userId) => this.content.items(client, userId, query)); }
  @Post('items')
  createItem(@Req() req: Request, @Body() body: NewItemDto) { return this.staff(req, true, (client, userId) => this.content.createItem(client, userId, body)); }
  @Get('items/:id')
  item(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) { return this.staff(req, false, client => this.content.item(client, id)); }
  @Post('items/:id/versions')
  newVersion(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: BodyDto) { return this.staff(req, true, (client, userId) => this.content.newVersion(client, userId, id, body)); }

  @Put('versions/:id')
  editDraft(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: BodyDto) { return this.staff(req, true, (client, userId) => this.content.editDraft(client, userId, id, body)); }
  @Post('versions/:id/submit')
  submit(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) { return this.staff(req, true, (client, userId) => this.content.submit(client, userId, id)); }
  @Post('versions/:id/approve')
  approve(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: NoteDto) { return this.staff(req, true, (client, userId) => this.content.approve(client, userId, id, body.note)); }
  @Post('versions/:id/reject')
  reject(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: RejectDto) { return this.staff(req, true, (client, userId) => this.content.reject(client, userId, id, body.note)); }
  @Post('versions/:id/retire')
  retire(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReasonDto) { return this.staff(req, true, (client, userId) => this.content.retire(client, userId, id, body.reason)); }

  @Get('queue')
  queue(@Req() req: Request) { return this.staff(req, false, (client, userId) => this.content.queue(client, userId)); }
}
