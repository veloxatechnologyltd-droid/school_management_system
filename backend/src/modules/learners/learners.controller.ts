import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { LearnersService } from './learners.service';
import { AdmissionDto,AdmissionNoteDto,AdmissionPageDto,CensusDto,ClassDto,ClassPageDto,LearnerSexDto,PageDto,TransferDto,TransitionDto,WithdrawalDto,YearDto } from './learners.dto';
const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId')
export class LearnersController {
  constructor(private readonly access:Access,private readonly learners:LearnersService){}
  @Get('academic-years')
  years(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.years(client,schoolId,page));}
  @Post('academic-years')
  year(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:YearDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.learners.createYear(client,actor,body),true);}
  @Get('classes')
  classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:ClassPageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.classes(client,schoolId,page));}
  @Post('classes')
  section(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:ClassDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.learners.createClass(client,actor,body),true);}
  @Get('admissions')
  applications(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:AdmissionPageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.page(client,schoolId,'admissions',page));}
  @Post('admissions')
  apply(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:AdmissionDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.createAdmission(client,actor,body),true);}
  @Get('admissions/:id')
  application(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,staff,client=>this.learners.admission(client,schoolId,id));}
  @Post('admissions/:id/notes')
  note(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:AdmissionNoteDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.addAdmissionNote(client,actor,id,body),true);}
  @Post('admissions/:id/transition')
  transition(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:TransitionDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.transition(client,actor,id,body),true);}
  // Enrolment by class and sex on one day (default today), as the GES annual school census asks for it.
  @Get('learners/census')
  census(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() query:CensusDto){return this.access.school(req,schoolId,staff,async client=>{
    const day=query.day??(await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string;
    const items=(await client.query(`SELECT c.id,c.name,c.level,count(*) FILTER (WHERE l.sex='female')::int AS female,count(*) FILTER (WHERE l.sex='male')::int AS male,count(*) FILTER (WHERE l.sex IS NULL)::int AS unrecorded
      FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id
      WHERE e.school_id=$1 AND e.superseded_at IS NULL AND e.start_date<=$2 AND (e.end_date IS NULL OR e.end_date>$2) GROUP BY c.id ORDER BY c.name`,[schoolId,day])).rows;
    return {day,items};
  });}
  @Get('learners')
  list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,client=>this.learners.page(client,schoolId,'learners',page));}
  @Get('learners/:id')
  detail(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,staff,client=>this.learners.learner(client,schoolId,id));}
  @Post('learners/:id/transfer')
  transfer(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:TransferDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.transfer(client,actor,id,body),true);}
  @Post('learners/:id/sex')
  sex(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:LearnerSexDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.setSex(client,actor,id,body),true);}
  @Post('learners/:id/withdraw')
  withdraw(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:WithdrawalDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.withdraw(client,actor,id,body),true);}
}
