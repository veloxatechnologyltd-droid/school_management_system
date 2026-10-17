import React, { FormEvent, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { request } from './lib/api';
import { forgetChats } from './lib/chatStore';
import { Mfa } from './modules/Mfa';
import { PlatformAdmin } from './modules/PlatformAdmin';
import { Icon, PageHeader, Tabs } from './lib/ui';
import { SchoolLogo, setLogoTag, shrinkLogo } from './lib/logo';
// Local synthetic hints show only on the dev server, not against the cloud database (dev:cloud) or the demo school (dev:demo).
const LOCAL=import.meta.env.DEV&&!['cloud','demo'].includes(import.meta.env.VITE_APP_MODE);
// Demo mode (npm run dev:demo) shows the production sign-in, prefilled with the demo headteacher.
const DEMO=import.meta.env.DEV&&import.meta.env.VITE_APP_MODE==='demo';
const lazyModule=<T extends Record<string,React.ComponentType<any>>,K extends keyof T>(load:()=>Promise<T>,name:K)=>lazy(()=>load().then(m=>({default:m[name]})));
const AuditExport=lazyModule(()=>import('./modules/AuditExport'),'AuditExport');
const Admissions=lazyModule(()=>import('./modules/Admissions'),'Admissions');
const Collection=lazyModule(()=>import('./modules/Collection'),'Collection');
const GuardianNotices=lazyModule(()=>import('./modules/Notices'),'GuardianNotices');
const Notices=lazyModule(()=>import('./modules/Notices'),'Notices');
const Guardians=lazyModule(()=>import('./modules/Guardians'),'Guardians');
const Teaching=lazyModule(()=>import('./modules/Teaching'),'Teaching');
const Attendance=lazyModule(()=>import('./modules/Attendance'),'Attendance');
const EarlyYears=lazyModule(()=>import('./modules/EarlyYears'),'EarlyYears');
const EarlyYearsReports=lazyModule(()=>import('./modules/EarlyYearsReports'),'EarlyYearsReports');
const HeadHome=lazyModule(()=>import('./modules/HeadHome'),'HeadHome');
const Assessment=lazyModule(()=>import('./modules/Assessment'),'Assessment');
const Progress=lazyModule(()=>import('./modules/Progress'),'Progress');
const Curriculum=lazyModule(()=>import('./modules/Curriculum'),'Curriculum');
const Topics=lazyModule(()=>import('./modules/Topics'),'Topics');
const Family=lazyModule(()=>import('./modules/Family'),'Family');
const SupportDue=lazy(()=>import('./modules/Support').then(m=>({default:m.SupportDue})));
const Finance=lazyModule(()=>import('./modules/Finance'),'Finance');
const GuardianStatement=lazyModule(()=>import('./modules/Finance'),'GuardianStatement');
const AiSettings=lazyModule(()=>import('./modules/AiSettings'),'AiSettings');
const Assistant=lazyModule(()=>import('./modules/Assistant'),'Assistant');
const LearnerPage=lazyModule(()=>import('./modules/LearnerPage'),'LearnerPage');
const Accounts=lazyModule(()=>import('./modules/Accounts'),'Accounts');
const ContentLibrary=lazyModule(()=>import('./modules/ContentLibrary'),'ContentLibrary');
const GettingStarted=lazyModule(()=>import('./modules/GettingStarted'),'GettingStarted');
const Landing=lazy(()=>import('./landing/Landing'));
const AuthPage=lazy(()=>import('./auth/AuthPage'));
// Remembers that this browser was signed in, so a returning user waits for the session instead of seeing the landing page flash.
const SIGNED_IN='vx-signed-in';
const rememberSignedIn=(on:boolean)=>{try{on?localStorage.setItem(SIGNED_IN,'1'):localStorage.removeItem(SIGNED_IN);}catch{/* storage blocked */}};
const wasSignedIn=()=>{try{return localStorage.getItem(SIGNED_IN)==='1';}catch{return false;}};
// The shared service-problem text says "changes may not have been saved", which is wrong for a sign-in and unclear for a new account.
const authProblem=(error:unknown,creating:boolean)=>{
  const {message,status,retryable}=error as {message:string;status?:number;retryable?:boolean};
  if(!retryable)return message;
  if(status===0)return 'Connection problem. Check your internet connection and try again.';
  return creating?'The service did not answer, so your account may not have been created. Wait a few seconds, then sign in with the same email. If that fails, create the account again.':'The service did not answer, so you were not signed in. It may be waking up: wait a few seconds and try again.';
};
const leaveAuthPage=()=>{if(/^#\/(signin|register)$/.test(location.hash))history.replaceState(null,'',location.pathname+location.search);};
type NavItem={id:string;label:string;icon:string};
const nav=(id:string,label:string,icon:string):NavItem=>({id,label,icon});
type NavGroup={group:string;items:NavItem[];pinned?:boolean};
const navByRole:Record<string,NavGroup[]>={
  headteacher:[
    {group:'Overview',items:[nav('today','Home','space_dashboard'),nav('ask','Kobby AI','auto_awesome')]},
    {group:'People',items:[nav('students','Students','groups'),nav('parents','Parents','family_restroom'),nav('teachers','Teachers','badge'),nav('staff','Staff','manage_accounts')]},
    {group:'School',items:[nav('classes','Classes','meeting_room'),nav('attendance','Attendance','event_available'),nav('collection','Pickup','directions_walk')]},
    {group:'Teaching',items:[nav('curriculum','Curriculum','menu_book'),nav('assessment','Assessment','school'),nav('progress','Performance','insights'),nav('early-years','Early years','child_care')]},
    {group:'Office',items:[nav('accounts','Accounts','receipt_long'),nav('notices','Notices','campaign')]},
    {group:'Administration',pinned:true,items:[nav('settings','Settings','settings')]}],
  teacher:[
    {group:'Overview',items:[nav('today','Today','today'),nav('ask','Kobby AI','auto_awesome')]},
    {group:'My classes',items:[nav('classes','Classes','meeting_room'),nav('curriculum','Curriculum','menu_book'),nav('assessment','Assessment','school'),nav('progress','Performance','insights'),nav('early-years','Early years','child_care')]}],
  accountant:[{group:'Office',items:[nav('accounts','Accounts','receipt_long')]}],
  frontdesk:[{group:'Front desk',items:[nav('collection','Pickup','directions_walk'),nav('students','Students','groups')]}],
  guardian:[
    {group:'My child',items:[nav('children','Home','home'),nav('practice','Learn at home','menu_book'),nav('my-progress','Performance','insights'),nav('reports','Report cards','description'),nav('notes','Notes','forum')]},
    {group:'The school',items:[nav('fees','Fees','receipt_long'),nav('notices','Notices','campaign')]}]
};
// Page headers for modules that do not draw their own (the other pages do).
const pageMeta:Record<string,{eyebrow:string;title:string;blurb:string}>={
  assessment:{eyebrow:'Teaching',title:'Assessment',blurb:'Record class work and exam marks; the CA is worked out from class work. Then remarks and report cards.'},
  settings:{eyebrow:'Administration',title:'Settings',blurb:'Set up your school once, in this order. Daily pages stay for daily work.'},
};
// The browser tab and history name the page, e.g. "Fees · Sunrise International School".
function PageTitle({title}:{title:string}) {
  useEffect(()=>{document.title=title;return ()=>{document.title='Veloxa SmartSchool';};},[title]);
  return null;
}
type ModuleProps={schoolId:string;csrfToken:string;role:string};
// Early years: observations and progress reports on tabs; headteachers open on the reports they review.
function EarlyYearsWork({schoolId,csrfToken,role}:ModuleProps) {
  const [tab,setTab]=useState<'observations'|'reports'>(role==='headteacher'?'reports':'observations');
  return <>
    <PageHeader eyebrow="Teaching" title="Early years" blurb="Nursery and KG observations, and the progress reports families receive."/>
    <div className="actions"><Tabs label="Early years" value={tab} onChange={setTab} options={[{id:'observations',label:'Observations'},{id:'reports',label:'Progress reports'}]}/></div>
    {tab==='observations'?<EarlyYears schoolId={schoolId} csrfToken={csrfToken} role={role} view="work"/>:<EarlyYearsReports schoolId={schoolId} csrfToken={csrfToken} role={role}/>}
  </>;
}
// Tabs on these pages live in the address (#/curriculum/material), so a reload or a shared link opens the same tab.
const openTab=(page:string,tab:string,first:string)=>{location.hash=tab===first?`#/${page}`:`#/${page}/${tab}`;};
// Curriculum: what the school teaches, and the lessons and questions Claude makes from it, on tabs.
function CurriculumWork({schoolId,csrfToken,role,sub}:ModuleProps&{sub?:string}) {
  const tab=sub==='material'?'material':'topics';
  return <>
    <PageHeader eyebrow="Teaching" title="Curriculum" blurb="The topics your school teaches, and the lessons, questions and practice Claude makes from them."/>
    <div className="actions"><Tabs label="Curriculum" value={tab} onChange={id=>openTab('curriculum',id,'topics')} options={[{id:'topics',label:'Topics'},{id:'material',label:'Learning material'}]}/></div>
    {tab==='topics'?<Curriculum schoolId={schoolId} csrfToken={csrfToken} role={role}/>:<Topics schoolId={schoolId} csrfToken={csrfToken} role={role}/>}
  </>;
}
// Teachers: their sign-ins, and which classes each one is assigned to.
function TeachersWork({schoolId,csrfToken,role,onAccessRefresh,sub}:ModuleProps&{onAccessRefresh:()=>void;sub?:string}) {
  const tab=sub==='assignments'?'assignments':'people';
  return <>
    <PageHeader eyebrow="People" title="Teachers" blurb="Teacher sign-ins, and the classes each teacher is assigned to."/>
    <div className="actions"><Tabs label="Teachers" value={tab} onChange={id=>openTab('teachers',id,'people')} options={[{id:'people',label:'Teachers'},{id:'assignments',label:'Class assignments'}]}/></div>
    {tab==='people'?<Accounts schoolId={schoolId} csrfToken={csrfToken} only="teacher"/>:<Teaching schoolId={schoolId} csrfToken={csrfToken} role={role} onAccessRefresh={onAccessRefresh}/>}
  </>;
}
// Parents: who may see, pay for and collect each child, and the parents' own sign-ins.
function ParentsWork({schoolId,csrfToken,role,sub}:ModuleProps&{sub?:string}) {
  const tab=sub==='accounts'?'accounts':'links';
  const tabs=<div className="actions"><Tabs label="Parents" value={tab} onChange={id=>openTab('parents',id,'links')} options={[{id:'links',label:'Parents and children'},{id:'accounts',label:'Parent accounts'}]}/></div>;
  return tab==='links'?<Guardians schoolId={schoolId} csrfToken={csrfToken} role={role} tabs={tabs}/>
    :<><PageHeader eyebrow="People" title="Parents" blurb="Parent sign-ins. Link each parent to their children on the Parents and children tab."/>{tabs}<Accounts schoolId={schoolId} csrfToken={csrfToken} only="guardian"/></>;
}
// Section addresses from the earlier layouts keep working (Settings steps that became pages are mapped below).
const legacyIds:Record<string,string>={learning:'assessment',school:'settings',teaching:'settings',promotion:'students',learners:'students',guardians:'parents',topics:'curriculum'};
const movedFromSettings:Record<string,string>={classes:'classes',staff:'staff',assignments:'teachers',fees:'accounts'};
type School = {id:string;name:string;role:string;version:number;address?:string|null;phone?:string|null;motto?:string|null;logo_tag?:string|null;readOnly?:boolean};
const detailsOf=(s:School)=>({address:s.address??'',phone:s.phone??'',motto:s.motto??''});
type Session = {displayName:string;csrfToken:string;schools:School[];platformAdmin:boolean;contentRoles:string[];mustChangePassword:boolean;mfaRequired:boolean;mfaEnrolled:boolean;mfaVerified:boolean};
type AuditPage = {items:Audit[];total:number};
type Audit = {id:string;action:string;created_at:string;metadata:{version?:number}};
function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [school,setSchool] = useState<School|null>(null);
  const [audit,setAudit] = useState<Audit[]>([]);
  const [auditTotal,setAuditTotal] = useState(0);
  const defaultEmail=LOCAL?'head@example.test':DEMO?'headteacher@sunrise.demo':'';
  const [email,setEmail] = useState(location.hash==='#/register'?'':defaultEmail);
  const [password,setPassword] = useState('');
  const [newPassword,setNewPassword] = useState('');
  const [name,setName] = useState('');
  const [details,setDetails] = useState({address:'',phone:'',motto:''});
  const [status,setStatus] = useState('');
  const [logoStatus,setLogoStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const [fullName,setFullName] = useState('');
  const [schoolName,setSchoolName] = useState('');
  const [teacherAccessRefresh,setTeacherAccessRefresh] = useState(0);
  const [loading,setLoading] = useState(true);
  const [tab,setTab] = useState(()=>location.hash.replace(/^#\//,''));
  const [menuOpen,setMenuOpen] = useState(false);
  useEffect(()=>{const change=()=>{setTab(location.hash.replace(/^#\//,''));setMenuOpen(false);window.scrollTo(0,0);if(location.hash==='#/register')setEmail(value=>value===defaultEmail?'':value);};addEventListener('hashchange',change);return ()=>removeEventListener('hashchange',change);},[]);
  const selectionEpoch=useRef(0);
  async function selectSchool(id:string) {
    const epoch=++selectionEpoch.current;
    setSchool(null);setAudit([]);setAuditTotal(0);setName('');setStatus('');setLogoStatus('');
    try {
      const current = await request<School>(`/schools/${id}`);
      if(epoch!==selectionEpoch.current)return;
      setLogoTag(current.id,current.logo_tag??null);setSchool(current);setName(current.name);setDetails(detailsOf(current));
      if(current.role==='headteacher') {const events=await request<AuditPage>(`/schools/${id}/audit`);if(epoch===selectionEpoch.current){setAudit(events.items);setAuditTotal(events.total);}}
    } catch(error) {
      if(epoch!==selectionEpoch.current)return;
      if((error as {status?:number}).status===401){setSession(null);forgetChats();rememberSignedIn(false);if(!location.hash.startsWith('#/'))location.hash='#/signin';setStatus('Your session ended. Sign in again.');}
      else setStatus((error as Error).message);
    }
  }
  async function restore() {
    const current = await request<Session>('/auth/session');
    setSession(current);rememberSignedIn(true);
    if(current.schools.length) await selectSchool(current.schools[0].id);
  }
  useEffect(() => {restore().catch(() => {setSession(null);forgetChats();rememberSignedIn(false);}).finally(() => setLoading(false));},[]);
  async function signIn(event:FormEvent) {
    event.preventDefault();setBusy(true);setStatus('');
    try { await request('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setPassword('');leaveAuthPage();setTab('');await restore(); }
    catch(error) {setStatus(authProblem(error,false));} finally {setBusy(false);}
  }
  async function register(event:FormEvent) {
    event.preventDefault();setBusy(true);setStatus('');
    try { await request('/auth/register',{method:'POST',body:JSON.stringify({name:fullName,schoolName,email,password})});setPassword('');leaveAuthPage();setTab('');await restore(); }
    catch(error) {setStatus(authProblem(error,true));} finally {setBusy(false);}
  }
  async function changePassword(event:FormEvent) {
    event.preventDefault();if(!session)return;setBusy(true);setStatus('');
    try {
      await request('/auth/change-password',{method:'POST',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({currentPassword:password,newPassword})});
      setPassword('');setNewPassword('');await restore();
    } catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function enterSchool(id:string) {
    const current = await request<Session>('/auth/session');
    setSession(current);await selectSchool(id);
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(!school||!session)return;setBusy(true);setStatus('Saving…');
    try {
      const saved = await request<School>(`/schools/${school.id}`,{method:'PATCH',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({name,...details,version:school.version})});
      setSchool({...saved,role:school.role,logo_tag:school.logo_tag});setName(saved.name);setDetails(detailsOf(saved));setSession({...session,schools:session.schools.map(s=>s.id===saved.id?{...s,name:saved.name}:s)});
      {const events=await request<AuditPage>(`/schools/${school.id}/audit`);setAudit(events.items);setAuditTotal(events.total);}setStatus('Saved. School details are up to date.');
    } catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function changeLogo(file:File|null) {
    if(!school||!session)return;setBusy(true);setLogoStatus(file?'Saving logo…':'Removing logo…');
    try {
      const logo=file?await shrinkLogo(file):null;
      const saved=await request<{logo_tag:string|null}>(`/schools/${school.id}/logo`,{method:'PUT',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({logo})});
      setLogoTag(school.id,saved.logo_tag);setSchool({...school,logo_tag:saved.logo_tag});setLogoStatus(file?'Logo saved. It now prints on receipts and report cards.':'Logo removed.');
    } catch(error) {setLogoStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function moreAudit() {
    if(!school)return;
    try {const events=await request<AuditPage>(`/schools/${school.id}/audit?offset=${audit.length}&limit=25`);setAudit(prior=>[...prior,...events.items]);setAuditTotal(events.total);} catch(error) {setStatus((error as Error).message);}
  }
  async function signOut() {
    if(!session)return;setBusy(true);
    try {await request('/auth/logout',{method:'POST',headers:{'x-csrf-token':session.csrfToken}});selectionEpoch.current++;forgetChats();rememberSignedIn(false);location.hash='#/signin';setSession(null);setSchool(null);setAudit([]);setStatus('Signed out');}
    catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  }
  const onLanding=!tab||tab.startsWith('#');
  if(loading&&onLanding&&!wasSignedIn())return <Suspense fallback={null}><Landing/></Suspense>;
  if(loading)return <main><p role="status">Loading workspace…</p></main>;
  if(!session&&onLanding)return <Suspense fallback={null}><Landing/></Suspense>;
  const authProps={local:LOCAL,busy,status,email,onEmail:setEmail,password,onPassword:setPassword,fullName,onFullName:setFullName,schoolName,onSchoolName:setSchoolName,onSwitch:(to:'signin'|'register')=>{setStatus('');setPassword('');location.hash=`#/${to}`;}};
  if(!session&&tab==='register')return <Suspense fallback={null}><AuthPage key="register" {...authProps} mode="register" onSubmit={register}/></Suspense>;
  if(!session)return <Suspense fallback={null}><AuthPage key="signin" {...authProps} mode="signin" onSubmit={signIn}/></Suspense>;
  if(session.mustChangePassword)return <main className="login"><p className="brand"><img className="logo" src="/brand/mark.svg" alt="Veloxa SmartSchool" /></p><h1>Choose a new password</h1><p>Your account was created with a temporary password. Choose your own to continue (at least 12 characters).</p><form onSubmit={changePassword}><label>Temporary password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Saving…':'Save new password'}</button></form><p role="status">{status}</p></main>;
  if(session.mfaRequired&&!session.mfaVerified)return <Mfa csrfToken={session.csrfToken} enrolled={session.mfaEnrolled} onDone={restore} onSignOut={()=>void signOut()}/>;
  const detailsChanged=!!school&&(name!==school.name||JSON.stringify(details)!==JSON.stringify(detailsOf(school)));
  const schoolDetails=school&&<><section><h2>School details</h2>{school.role==='headteacher'?<form onSubmit={save}><label>School name<input value={name} minLength={3} maxLength={120} onChange={e=>setName(e.target.value)} required/></label><label>Address (printed on report cards and receipts)<input value={details.address} maxLength={200} onChange={e=>setDetails({...details,address:e.target.value})} placeholder="P.O. Box 12, Kasoa, Central Region"/></label><label>Phone<input value={details.phone} maxLength={40} onChange={e=>setDetails({...details,phone:e.target.value})} placeholder="024 123 4567"/></label><label>Motto<input value={details.motto} maxLength={120} onChange={e=>setDetails({...details,motto:e.target.value})}/></label><div className="actions"><button disabled={busy||!detailsChanged}>{busy?'Saving…':'Save details'}</button><button className="secondary" type="button" disabled={busy} onClick={()=>selectSchool(school.id).catch(error=>setStatus(error.message))}>Reload details</button></div><p className="muted">{detailsChanged?'Unsaved changes':`Saved version ${school.version}`}</p></form>:<p>School details are maintained by the headteacher.</p>}<p role="status" aria-live="polite">{status}</p></section>
    {school.role==='headteacher'&&<section><h2>School logo</h2><p className="card-hint">Printed on receipts and report cards and shown at the top of the menu. A square PNG with a clear background looks best; it is shrunk to 256 pixels.</p>
      <div className="logo-setting"><div className="logo-preview">{school.logo_tag?<SchoolLogo schoolId={school.id} className="doc-logo"/>:<span className="muted">No logo yet</span>}</div>
        <div><label>{school.logo_tag?'Choose a new logo':'Choose a logo'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void changeLogo(file);}}/></label>
        {school.logo_tag&&<button type="button" className="secondary" disabled={busy} onClick={()=>void changeLogo(null)}>Remove logo</button>}</div></div><p role="status" aria-live="polite">{logoStatus}</p></section>}</>;
  const recentChanges=school&&<section><h2>Recent changes</h2><AuditExport key={school.id} schoolId={school.id} csrfToken={session.csrfToken}/>{audit.length?<><ul className="history">{audit.map(item=><li key={item.id}><strong>{({"school.details.updated":"School details saved","audit.export.requested":"Audit export requested"} as Record<string,string>)[item.action]??item.action.replaceAll("."," ")}</strong><span>{item.metadata.version?`Version ${item.metadata.version} · `:""}{new Date(item.created_at).toLocaleString('en-GH',{timeZone:'Africa/Accra'})}</span></li>)}</ul>{audit.length<auditTotal&&<p>Showing {audit.length} of {auditTotal} changes. <button type="button" className="secondary" onClick={()=>void moreAudit()}>Show older changes</button></p>}</>:<p>No changes recorded yet.</p>}</section>;
  const sid=school?.id??'',csrf=session.csrfToken,role=school?.role??'';
  const contentRoles=session.contentRoles??[],showContent=contentRoles.length>0&&(!school||tab.split('/')[0]==='content');
  const teachingView=<Teaching key={`teaching:${sid}`} schoolId={sid} csrfToken={csrf} role={role} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>;
  const attendanceView=<Attendance key={`attendance:${sid}`} schoolId={sid} csrfToken={csrf} role={role} accessRefresh={teacherAccessRefresh}/>;
  const settingsSteps:{id:string;label:string;render:()=>React.ReactNode}[]=[
    {id:'school',label:'School details',render:()=>schoolDetails},
    {id:'grading',label:'Subjects, terms & grading',render:()=><Assessment key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'sharing',label:'Family sharing & home practice',render:()=><Curriculum key={`sharing:${sid}`} schoolId={sid} csrfToken={csrf} part="sharing"/>},
    {id:'early-years',label:'Early years policies',render:()=><EarlyYears key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'ai',label:'AI assistance',render:()=><AiSettings key={`ai:${sid}`} schoolId={sid} csrfToken={csrf}/>},
    {id:'activity',label:'Activity log',render:()=>recentChanges},
  ];
  const [rawTab='',rawSub]=tab.split('/'),moved=rawTab==='settings'&&rawSub?movedFromSettings[rawSub]:undefined;
  const tabId=moved??rawTab,subId=moved?undefined:rawSub,setting=settingsSteps.find(step=>step.id===subId)??settingsSteps[0];
  const views:Record<string,()=>React.ReactNode>={
    today:()=>role==='headteacher'?<GettingStarted key={`setup:${sid}`} schoolId={sid} schoolName={school?.name??''} displayName={session.displayName} csrfToken={csrf}><HeadHome key={`home:${sid}`} schoolId={sid}/></GettingStarted>:<><SupportDue key={`support-due:${sid}`} schoolId={sid}/>{attendanceView}</>,
    classes:()=>role==='headteacher'?<Admissions key={`classes:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>:teachingView,
    teachers:()=><TeachersWork key={`teachers:${sid}`} schoolId={sid} csrfToken={csrf} role={role} sub={moved==='teachers'?'assignments':subId} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>,
    staff:()=><><PageHeader eyebrow="People" title="Staff" blurb="The headteacher, front desk and accounts staff, and their sign-ins."/><Accounts key={`staff:${sid}`} schoolId={sid} csrfToken={csrf} only="office"/></>,
    attendance:()=>attendanceView,
    ask:()=><Assistant key={`ask:${sid}`} schoolId={sid} csrfToken={csrf} role={role} displayName={session.displayName}/>,
    collection:()=><Collection key={'collection:'+sid} schoolId={sid} csrfToken={csrf} role={role}/>,
    students:()=><Admissions key={sid} schoolId={sid} csrfToken={csrf} role={role} view={role==='headteacher'?'work':undefined} initialTab={tabId==='promotion'||subId==='promotion'?'promotion':subId==='applications'?'applications':'roll'}/>,
    parents:()=><ParentsWork key={`parents:${sid}`} schoolId={sid} csrfToken={csrf} role={role} sub={subId}/>,
    assessment:()=><Assessment key={`assessment:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="work"/>,
    progress:()=><Progress key={`progress:${sid}`} schoolId={sid} csrfToken={csrf} role={role} initialTab={subId}/>,
    curriculum:()=><CurriculumWork key={`curriculum:${sid}`} schoolId={sid} csrfToken={csrf} role={role} sub={rawTab==='topics'?'material':subId}/>,
    'early-years':()=><EarlyYearsWork key={`early-years:${sid}:${role}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    fees:()=><GuardianStatement key={`statement:${sid}`} schoolId={sid}/>,
    accounts:()=><Finance key={`finance:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    notices:()=>role==='guardian'?<GuardianNotices key={`gnotices:${sid}`} schoolId={sid}/>:<Notices key={`notices:${sid}`} schoolId={sid} csrfToken={csrf}/>,
    // The family area keeps one key, so the child a parent picked stays picked as they move between its pages.
    children:()=><Family key={`family:${sid}`} schoolId={sid} csrfToken={csrf} section="children"/>,
    practice:()=><Family key={`family:${sid}`} schoolId={sid} csrfToken={csrf} section="practice"/>,
    'my-progress':()=><Family key={`family:${sid}`} schoolId={sid} csrfToken={csrf} section="my-progress"/>,
    reports:()=><Family key={`family:${sid}`} schoolId={sid} csrfToken={csrf} section="reports"/>,
    notes:()=><Family key={`family:${sid}`} schoolId={sid} csrfToken={csrf} section="notes"/>,
    settings:()=><div className="settings"><nav className="setting-steps" aria-label="Settings">{settingsSteps.map((step,index)=><a key={step.id} href={`#/settings/${step.id}`} aria-current={step.id===setting.id?'page':undefined}><b aria-hidden="true">{index+1}</b>{step.label}</a>)}</nav><div className="setting-body">{setting.render()}</div></div>,
  };
  // A student's own page (#/learner/<id>) for heads and teachers sits under Students (head) or Performance (teacher) in the menu.
  const learnerPage=tabId==='learner'&&!!subId&&(role==='headteacher'||role==='teacher');
  if(learnerPage)views.learner=()=><LearnerPage key={`student:${sid}:${subId}`} schoolId={sid} csrfToken={csrf} role={role} learnerId={subId!}/>;
  const groups=navByRole[role]??[],items=groups.flatMap(g=>g.items),wanted=learnerPage?(role==='headteacher'?'students':'progress'):tabId==='fees'&&role!=='guardian'?'accounts':legacyIds[tabId]??tabId,current=items.find(item=>item.id===wanted)??items[0];
  const roleName=role==='frontdesk'?'Front desk':role.charAt(0).toUpperCase()+role.slice(1);
  const meta=!learnerPage&&current&&pageMeta[current.id];
  const navGroup=(g:NavGroup)=><div key={g.items[0].id} className="nav-section">{g.group&&<p className="nav-group">{g.group}</p>}{g.items.map(item=><a key={item.id} href={`#/${item.id}`} aria-current={!showContent&&item.id===current?.id?'page':undefined}><Icon name={item.icon}/><span className="label">{item.label}</span></a>)}</div>;
  return <div className="shell">
    <PageTitle title={`${showContent?'Content library':learnerPage?'Student':current?.id==='settings'?`Settings · ${setting.label}`:current?.label??'Home'} · ${school?.name??'Veloxa SmartSchool'}`}/>
    <a href="#main" className="skip-link" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a>
    <aside className={menuOpen?'sidebar open':'sidebar'}>
      <a href="#/" className="brand">{school?.logo_tag?<SchoolLogo schoolId={school.id} className="logo school-mark"/>:<img className="logo" src="/brand/mark-white.svg" alt="" />}<span className="brand-text"><strong>{school?.name??'Veloxa SmartSchool'}</strong><span>{roleName||'Signed in'}</span></span></a>
      {session.schools.length>1&&<label className="school-picker">School<select value={school?.id??''} disabled={busy} onChange={e=>{setBusy(true);selectSchool(e.target.value).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>{!school&&<option value="">Loading…</option>}{session.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {school&&<nav aria-label="Sections"><div className="nav-scroll">{groups.filter(g=>!g.pinned).map(navGroup)}</div>{groups.some(g=>g.pinned)&&<div className="nav-pinned">{groups.filter(g=>g.pinned).map(g=>navGroup({...g,group:''}))}</div>}</nav>}
      {contentRoles.length>0&&<nav aria-label="Content"><div className="nav-section">{school&&<p className="nav-group">Content team</p>}<a href="#/content" aria-current={showContent?'page':undefined}><Icon name="library_books"/><span className="label">Content library</span></a></div></nav>}
    </aside>
    {menuOpen&&<div className="scrim" onClick={()=>setMenuOpen(false)}/>}
    <div className="content">
      <header className="topbar"><button type="button" className="icon-button menu-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}><Icon name="menu"/></button>{school&&<h1>{school.name}</h1>}{school&&<em className="role-chip">{roleName}</em>}{role==='headteacher'&&<a className="icon-button settings-link" href="#/settings" aria-label="Settings" title="Settings"><Icon name="settings"/></a>}<div className="user"><span className="avatar" aria-hidden="true">{session.displayName.charAt(0).toUpperCase()}</span><span className="name">{session.displayName}</span></div><button className="secondary sign-out" disabled={busy} onClick={signOut}>Sign out</button></header>
      {school?.readOnly&&<p role="status" style={{margin:0,padding:'8px 16px',background:'var(--info-soft)',color:'var(--info)',fontSize:13,fontWeight:600}}>Demo school with sample data · read-only. Explore every page and try Ask; changes and password changes are switched off.</p>}
      <main id="main" tabIndex={-1} className={current?.id==='ask'&&!learnerPage&&!showContent?'ask-main':undefined}>{session.platformAdmin&&<PlatformAdmin csrfToken={session.csrfToken} onEnter={enterSchool}/>}{showContent&&<Suspense fallback={<p role="status">Loading…</p>}><ContentLibrary csrfToken={csrf}/></Suspense>}{school&&!showContent&&<>{meta&&<PageHeader eyebrow={meta.eyebrow} title={meta.title} blurb={meta.blurb}/>}<Suspense fallback={<p role="status">Loading…</p>}>{learnerPage?views.learner!():current&&views[current.id]()}</Suspense></>}{!school&&!showContent&&<p role="status">{status||'Select an available school to continue.'}</p>}{LOCAL&&<p className="muted local-note">Local foundation build · Synthetic schools</p>}</main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
