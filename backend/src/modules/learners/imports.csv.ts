import { BadRequestException } from '@nestjs/common';
export type ImportInput={admissionNumber:string;fullName:string;dateOfBirth:string;sex?:string;columnCount:number};
export type CsvRow={rowNumber:number;input:ImportInput};

export type DateFormat='iso'|'dmy'|'mdy';
// Header names people actually use in Excel/Google Sheets exports, compared after lower-casing and dropping punctuation/spaces.
const aliases:Record<'admissionNumber'|'fullName'|'dateOfBirth'|'sex',string[]>={
  admissionNumber:['admissionnumber','admissionno','admissionnum','admno','admission','admissionid','studentid','studentno','pupilno','idnumber','idno'],
  fullName:['fullname','name','studentname','learnername','pupilname','nameofstudent','nameofpupil'],
  dateOfBirth:['dateofbirth','dob','birthdate','dateborn','birthday'],
  sex:['sex','gender','mf']
};
// M/F, Male/Female and Boy/Girl as schools write them. Anything else is kept as typed so validation flags it.
export function normalizeSex(value:string){const v=value.trim().toLowerCase();return ['m','male','boy'].includes(v)?'male':['f','female','girl'].includes(v)?'female':value.trim();}
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
// Turns 03/04/2015 into an ISO date under the format the school chose. Anything unreadable is left as typed so validation flags it.
export function normalizeDate(value:string,format:DateFormat):string{
  if(format==='iso'||!value)return value;
  const match=/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
  if(!match)return value;
  const [day,month]=format==='dmy'?[match[1],match[2]]:[match[2],match[1]];
  return `${match[3]}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
}
function delimiterOf(source:string){
  let line='',quoted=false;
  for(const char of source){if(char==='"')quoted=!quoted;if(!quoted&&(char==='\n'||char==='\r'))break;line+=char;}
  const counts=[',',';','\t'].map(d=>[d,line.split(d).length-1] as const).sort((a,b)=>b[1]-a[1]);
  return counts[0][1]>0?counts[0][0]:',';
}
// For corrections (`forUpdate`) only the admission number is required, plus at least one of name, date of birth or sex.
export function parseLearnerCsv(source:string,dateFormat:DateFormat='iso',forUpdate=false):CsvRow[]{
  const csv=source.replace(/^\uFEFF/,''),delimiter=delimiterOf(csv);const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  const endField=()=>{row.push(field);field='';closed=false;};
  const endRow=()=>{endField();records.push(row);row=[];if(records.length>201)throw new BadRequestException('Import at most 200 CSV records at a time');};
  for(let i=0;i<csv.length;i++){
    const char=csv[i];
    if(quoted){if(char==='"'){if(csv[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=char;continue;}
    if(char===delimiter){endField();continue;}
    if(char==='\r'||char==='\n'){endRow();if(char==='\r'&&csv[i+1]==='\n')i++;continue;}
    if(closed)throw new BadRequestException('CSV has text after a closing quote');
    if(char==='"'){if(field)throw new BadRequestException('CSV quotes must begin a field');quoted=true;}else field+=char;
  }
  if(quoted)throw new BadRequestException('CSV has an unclosed quoted field');
  if(field||row.length||closed)endRow();
  const header=(records[0]??[]).map(key),column={} as Record<keyof typeof aliases,number>;
  for(const name of Object.keys(aliases) as (keyof typeof aliases)[]){
    const found=header.flatMap((cell,index)=>aliases[name].includes(cell)?[index]:[]);
    if(found.length>1)throw new BadRequestException(`More than one column looks like ${name==='fullName'?'the learner name':name==='dateOfBirth'?'the date of birth':name==='sex'?'sex':'the admission number'}`);
    column[name]=found.length?found[0]:-1;
  }
  if(forUpdate&&(column.admissionNumber<0||[column.fullName,column.dateOfBirth,column.sex].every(index=>index<0)))throw new BadRequestException('The first row must name an admission number column (e.g. "Admission No.") and at least one column to correct: "Full Name", "Date of Birth" or "Sex"');
  if(!forUpdate&&(column.admissionNumber<0||column.fullName<0))throw new BadRequestException('The first row must name an admission number column (e.g. "Admission No.") and a name column (e.g. "Full Name"); "Date of Birth" and "Sex" are optional');
  const at=(cells:string[],index:number)=>index<0?'':(cells[index]??'').trim();
  const rows=records.slice(1).flatMap((cells,index)=>cells.every(value=>!value.trim())?[]:[{rowNumber:index+2,input:{admissionNumber:at(cells,column.admissionNumber),fullName:at(cells,column.fullName),dateOfBirth:normalizeDate(at(cells,column.dateOfBirth),dateFormat),...(column.sex<0?{}:{sex:normalizeSex(at(cells,column.sex))}),columnCount:cells.length===header.length?3:0}}]);
  if(!rows.length)throw new BadRequestException('CSV needs at least one learner record');
  return rows;
}
