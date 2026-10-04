import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { FinanceService } from './finance.service';
import { FeeItemDto, GenerateInvoicesDto, InvoiceQueryDto, PaymentDto, ReverseDto, SummaryQueryDto } from './finance.dto';

const money = ['headteacher','accountant'];
@Controller('api/v1/schools/:schoolId')
export class FinanceController {
  constructor(private readonly access: Access, private readonly finance: FinanceService) {}
  @Get('finance/terms')
  terms(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,money,async client => ({items:(await client.query('SELECT t.id,t.name,t.start_date::text,t.end_date::text,y.name AS year_name FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date DESC,t.id',[schoolId])).rows}));
  }
  @Get('finance/classes')
  classes(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,money,async client => ({items:(await client.query('SELECT c.id,c.name,c.level,y.name AS year_name FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 ORDER BY y.start_date DESC,c.name,c.id LIMIT 100',[schoolId])).rows}));
  }
  @Get('finance/fee-items')
  items(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query('termId') termId?: string) {
    return this.access.school(req,schoolId,money,async client => ({items:await this.finance.feeItems(client,schoolId,termId)}));
  }
  @Post('finance/fee-items')
  createItem(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: FeeItemDto) {
    return this.access.school(req,schoolId,money,(client,actor) => this.finance.createFeeItem(client,actor,body),true);
  }
  @Post('finance/invoices/generate')
  generate(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: GenerateInvoicesDto) {
    return this.access.school(req,schoolId,money,(client,actor) => this.finance.generate(client,actor,body),true);
  }
  @Get('finance/invoices')
  invoices(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: InvoiceQueryDto) {
    return this.access.school(req,schoolId,money,client => this.finance.invoices(client,schoolId,query));
  }
  @Post('finance/payments')
  pay(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: PaymentDto) {
    return this.access.school(req,schoolId,money,(client,actor) => this.finance.payment(client,actor,body),true);
  }
  @Post('finance/payments/:paymentId/reverse')
  reverse(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('paymentId',new ParseUUIDPipe()) paymentId: string,@Body() body: ReverseDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.finance.reverse(client,actor,paymentId,body),true);
  }
  @Get('finance/payments/:paymentId/receipt')
  receipt(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('paymentId',new ParseUUIDPipe()) paymentId: string) {
    return this.access.school(req,schoolId,money,client => this.finance.receipt(client,schoolId,paymentId));
  }
  @Get('finance/summary')
  summary(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: SummaryQueryDto) {
    return this.access.school(req,schoolId,money,client => this.finance.summary(client,schoolId,query.termId));
  }
  @Get('guardian/children/:learnerId/statement')
  statement(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('learnerId',new ParseUUIDPipe()) learnerId: string) {
    return this.access.school(req,schoolId,['guardian'],(client,actor) => this.finance.statement(client,actor,learnerId));
  }
}
