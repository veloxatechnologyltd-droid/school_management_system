import React, { FormEvent, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { request } from './lib/api';
import { Mfa } from './modules/Mfa';
import { PlatformAdmin } from './modules/PlatformAdmin';
import { Icon, PageHeader, Tabs } from './lib/ui';
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
const AttendanceFollowUp=lazyModule(()=>import('./modules/AttendanceFollowUp'),'AttendanceFollowUp');
const Assessment=lazyModule(()=>import('./modules/Assessment'),'Assessment');
const GuardianTerminalReports=lazyModule(()=>import('./modules/Assessment'),'GuardianTerminalReports');
const Finance=lazyModule(()=>import('./modules/Finance'),'Finance');
const GuardianStatement=lazyModule(()=>import('./modules/Finance'),'GuardianStatement');
const Promotion=lazyModule(()=>import('./modules/Promotion'),'Promotion');
const AiSettings=lazyModule(()=>import('./modules/AiSettings'),'AiSettings');
const Accounts=lazyModule(()=>import('./modules/Accounts'),'Accounts');
const GettingStarted=lazyModule(()=>import('./modules/GettingStarted'),'GettingStarted');
type NavItem={id:string;label:string;icon:string};
const nav=(id:string,label:string,icon:string):NavItem=>({id,label,icon});
const navByRole:Record<string,{group:string;items:NavItem[]}[]>={
  headteacher:[
    {group:'Overview',items:[nav('today','Home','space_dashboard')]},
    {group:'People',items:[nav('attendance','Attendance','event_available'),nav('learners','Learners','groups'),nav('guardians','Guardians','family_restroom'),nav('collection','Pickup','directions_walk')]},
    {group:'Teaching',items:[nav('assessment','Assessment','school'),nav('early-years','Early years','child_care')]},
    {group:'Office',items:[nav('fees','Fees','receipt_long'),nav('notices','Notices','campaign'),nav('promotion','Promotion','trending_up')]},
    {group:'Administration',items:[nav('settings','Settings','settings')]}],
  teacher:[{group:'My work',items:[nav('today','Today','today'),nav('assessment','Assessment','school'),nav('early-years','Early years','child_care')]}],
  accountant:[{group:'Money',items:[nav('fees','Fees','receipt_long')]}],
  frontdesk:[{group:'Front desk',items:[nav('collection','Pickup','directions_walk'),nav('learners','Learners','groups')]}],
  guardian:[{group:'My family',items:[nav('children','My children','child_care'),nav('fees','Fees','receipt_long'),nav('notices','Notices','campaign')]}]
};
// Page headers for modules that do not draw their own (the other pages do).
const pageMeta:Record<string,{eyebrow:string;title:string;blurb:string}>={
  assessment:{eyebrow:'Teaching',title:'Assessment',blurb:'Class scores, terminal results and published report cards.'},
  settings:{eyebrow:'Administration',title:'Settings',blurb:'Set up your school once, in this order. Daily pages stay for daily work.'},
};
type ModuleProps={schoolId:string;csrfToken:string;role:string};
// Guardian portal: the child chosen at the top drives the report cards below it.
function MyChildren({schoolId,csrfToken,role}:ModuleProps) {
  const [childId,setChildId]=useState('');
  return <><Guardians schoolId={schoolId} csrfToken={csrfToken} role={role} onChildChange={setChildId}/>{childId&&<><EarlyYearsReports schoolId={schoolId} csrfToken={csrfToken} role={role} childId={childId}/><GuardianTerminalReports schoolId={schoolId} childId={childId}/></>}</>;
}
// Early years: observations and progress reports on tabs; headteachers open on the reports they review.
function EarlyYearsWork({schoolId,csrfToken,role}:ModuleProps) {
  const [tab,setTab]=useState<'observations'|'reports'>(role==='headteacher'?'reports':'observations');
  return <>
    <PageHeader eyebrow="Teaching" title="Early years" blurb="Nursery and KG observations, and the progress reports families receive."/>
    <div className="actions"><Tabs label="Early years" value={tab} onChange={setTab} options={[{id:'observations',label:'Observations'},{id:'reports',label:'Progress reports'}]}/></div>
    {tab==='observations'?<EarlyYears schoolId={schoolId} csrfToken={csrfToken} role={role} view="work"/>:<EarlyYearsReports schoolId={schoolId} csrfToken={csrfToken} role={role}/>}
  </>;
}
// Section addresses from the earlier tab layout keep working.
const legacyIds:Record<string,string>={learning:'assessment',school:'settings',teaching:'settings',accounts:'settings'};
type School = {id:string;name:string;role:string;version:number};
type Session = {displayName:string;csrfToken:string;schools:School[];platformAdmin:boolean;mustChangePassword:boolean;mfaRequired:boolean;mfaEnrolled:boolean;mfaVerified:boolean};
type AuditPage = {items:Audit[];total:number};
type Audit = {id:string;action:string;created_at:string;metadata:{version?:number}};
function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [school,setSchool] = useState<School|null>(null);
  const [audit,setAudit] = useState<Audit[]>([]);
  const [auditTotal,setAuditTotal] = useState(0);
  const [email,setEmail] = useState(LOCAL?'head@example.test':DEMO?'headteacher@sunrise.demo':'');
  const [password,setPassword] = useState('');
  const [newPassword,setNewPassword] = useState('');
  const [name,setName] = useState('');
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const [registering,setRegistering] = useState(false);
  const [fullName,setFullName] = useState('');
  const [schoolName,setSchoolName] = useState('');
  const [teacherAccessRefresh,setTeacherAccessRefresh] = useState(0);
  const [loading,setLoading] = useState(true);
  const [tab,setTab] = useState(()=>location.hash.replace(/^#\//,''));
  const [menuOpen,setMenuOpen] = useState(false);
  useEffect(()=>{const change=()=>{setTab(location.hash.replace(/^#\//,''));setMenuOpen(false);};addEventListener('hashchange',change);return ()=>removeEventListener('hashchange',change);},[]);
  const selectionEpoch=useRef(0);
  async function selectSchool(id:string) {
    const epoch=++selectionEpoch.current;
    setSchool(null);setAudit([]);setAuditTotal(0);setName('');setStatus('');
    try {
      const current = await request<School>(`/schools/${id}`);
      if(epoch!==selectionEpoch.current)return;
      setSchool(current);setName(current.name);
      if(current.role==='headteacher') {const events=await request<AuditPage>(`/schools/${id}/audit`);if(epoch===selectionEpoch.current){setAudit(events.items);setAuditTotal(events.total);}}
    } catch(error) {
      if(epoch!==selectionEpoch.current)return;
      if((error as {status?:number}).status===401){setSession(null);setStatus('Your session ended. Sign in again.');}
      else setStatus((error as Error).message);
    }
  }
  async function restore() {
    const current = await request<Session>('/auth/session');
    setSession(current);
    if(current.schools.length) await selectSchool(current.schools[0].id);
  }
  useEffect(() => {restore().catch(() => setSession(null)).finally(() => setLoading(false));},[]);
  async function signIn(event:FormEvent) {
    event.preventDefault();setBusy(true);setStatus('');
    try { await request('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setPassword('');await restore(); }
    catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function register(event:FormEvent) {
    event.preventDefault();setBusy(true);setStatus('');
    try { await request('/auth/register',{method:'POST',body:JSON.stringify({name:fullName,schoolName,email,password})});setPassword('');await restore(); }
    catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
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
      const saved = await request<School>(`/schools/${school.id}`,{method:'PATCH',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({name,version:school.version})});
      setSchool({...saved,role:school.role});setName(saved.name);setSession({...session,schools:session.schools.map(s=>s.id===saved.id?{...s,name:saved.name}:s)});
      {const events=await request<AuditPage>(`/schools/${school.id}/audit`);setAudit(events.items);setAuditTotal(events.total);}setStatus('Saved. School details are up to date.');
    } catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function moreAudit() {
    if(!school)return;
    try {const events=await request<AuditPage>(`/schools/${school.id}/audit?offset=${audit.length}&limit=25`);setAudit(prior=>[...prior,...events.items]);setAuditTotal(events.total);} catch(error) {setStatus((error as Error).message);}
  }
  async function signOut() {
    if(!session)return;setBusy(true);
    try {await request('/auth/logout',{method:'POST',headers:{'x-csrf-token':session.csrfToken}});selectionEpoch.current++;setSession(null);setSchool(null);setAudit([]);setStatus('Signed out');}
    catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  }
  if(loading)return <main><p role="status">Loading workspace…</p></main>;
  if(!session&&registering)return <main className="login"><p className="brand"><span className="logo" aria-hidden="true">V</span>Veloxa SmartSchool</p><h1>Create your account</h1><p>Set up your school and become its headteacher. You can add staff and guardians afterwards.</p><form onSubmit={register}><label>Your full name<input autoComplete="name" minLength={2} maxLength={120} value={fullName} onChange={e=>setFullName(e.target.value)} required/></label><label>School name<input minLength={3} maxLength={120} value={schoolName} onChange={e=>setSchoolName(e.target.value)} required/></label><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password (at least 12 characters)<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Creating…':'Create account'}</button></form><p role="status">{status}</p><p className="muted">Already have an account? <button type="button" className="secondary" onClick={()=>{setRegistering(false);setStatus('');setPassword('')}}>Sign in</button></p></main>;
  if(!session)return <main className="login"><p className="brand"><span className="logo" aria-hidden="true">V</span>{LOCAL?'Veloxa SmartSchool · Local':'Veloxa SmartSchool'}</p><h1>Welcome back</h1><p>{LOCAL?'Use a synthetic staff account to open your school.':'Sign in with the account your school administrator created for you.'}</p><form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p role="status">{status}</p><p className="muted">New here? <button type="button" className="secondary" onClick={()=>{setRegistering(true);setStatus('');setPassword('');if(LOCAL)setEmail('')}}>Create an account</button></p><p className="muted">{LOCAL?'Synthetic data only. Password: Synthetic-only-2026!':'Forgot your password? Ask your school administrator to reset it.'}</p></main>;
  if(session.mustChangePassword)return <main className="login"><p className="brand"><span className="logo" aria-hidden="true">V</span>Veloxa SmartSchool</p><h1>Choose a new password</h1><p>Your account was created with a temporary password. Choose your own to continue (at least 12 characters).</p><form onSubmit={changePassword}><label>Temporary password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Saving…':'Save new password'}</button></form><p role="status">{status}</p></main>;
  if(session.mfaRequired&&!session.mfaVerified)return <Mfa csrfToken={session.csrfToken} enrolled={session.mfaEnrolled} onDone={restore} onSignOut={()=>void signOut()}/>;
  const schoolDetails=school&&<><section><h2>School details</h2>{school.role==='headteacher'?<form onSubmit={save}><label>School name<input value={name} minLength={3} maxLength={120} onChange={e=>setName(e.target.value)} required/></label><div className="actions"><button disabled={busy||name===school.name}>{busy?'Saving…':'Save details'}</button><button className="secondary" type="button" disabled={busy} onClick={()=>selectSchool(school.id).catch(error=>setStatus(error.message))}>Reload details</button></div><p className="muted">{name!==school.name?'Unsaved changes':`Saved version ${school.version}`}</p></form>:<p>School details are maintained by the headteacher.</p>}<p role="status" aria-live="polite">{status}</p></section></>;
  const recentChanges=school&&<section><h2>Recent changes</h2><AuditExport key={school.id} schoolId={school.id} csrfToken={session.csrfToken}/>{audit.length?<><ul className="history">{audit.map(item=><li key={item.id}><strong>{({"school.details.updated":"School details saved","audit.export.requested":"Audit export requested"} as Record<string,string>)[item.action]??item.action.replaceAll("."," ")}</strong><span>{item.metadata.version?`Version ${item.metadata.version} · `:""}{new Date(item.created_at).toLocaleString('en-GH',{timeZone:'Africa/Accra'})}</span></li>)}</ul>{audit.length<auditTotal&&<p>Showing {audit.length} of {auditTotal} changes. <button type="button" className="secondary" onClick={()=>void moreAudit()}>Show older changes</button></p>}</>:<p>No changes recorded yet.</p>}</section>;
  const sid=school?.id??'',csrf=session.csrfToken,role=school?.role??'';
  const teachingView=<Teaching key={`teaching:${sid}`} schoolId={sid} csrfToken={csrf} role={role} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>;
  const attendanceView=<Attendance key={`attendance:${sid}`} schoolId={sid} csrfToken={csrf} role={role} accessRefresh={teacherAccessRefresh}/>;
  const settingsSteps:{id:string;label:string;render:()=>React.ReactNode}[]=[
    {id:'school',label:'School details',render:()=>schoolDetails},
    {id:'classes',label:'Academic year & classes',render:()=><Admissions key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'staff',label:'Staff accounts',render:()=><Accounts key={`accounts:${sid}`} schoolId={sid} csrfToken={csrf}/>},
    {id:'assignments',label:'Teacher assignments',render:()=>teachingView},
    {id:'grading',label:'Subjects, terms & grading',render:()=><Assessment key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'fees',label:'Fee items',render:()=><Finance key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'early-years',label:'Early years policies',render:()=><EarlyYears key={`setup:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="setup"/>},
    {id:'ai',label:'AI assistance',render:()=><AiSettings key={`ai:${sid}`} schoolId={sid} csrfToken={csrf}/>},
    {id:'activity',label:'Activity log',render:()=>recentChanges},
  ];
  const [tabId,subId]=tab.split('/'),setting=settingsSteps.find(step=>step.id===subId)??settingsSteps[0];
  const views:Record<string,()=>React.ReactNode>={
    today:()=>role==='headteacher'?<GettingStarted key={`setup:${sid}`} schoolId={sid} schoolName={school?.name??''} displayName={session.displayName} csrfToken={csrf}><AttendanceFollowUp key={`followup:${sid}`} schoolId={sid}/></GettingStarted>:<>{attendanceView}{teachingView}</>,
    attendance:()=>attendanceView,
    collection:()=><Collection key={'collection:'+sid} schoolId={sid} csrfToken={csrf} role={role}/>,
    learners:()=><Admissions key={sid} schoolId={sid} csrfToken={csrf} role={role} view={role==='headteacher'?'work':undefined} initialTab={subId==='applications'?'applications':'roll'}/>,
    guardians:()=><Guardians key={`guardians:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    promotion:()=><Promotion key={`promotion:${sid}`} schoolId={sid} csrfToken={csrf}/>,
    assessment:()=><Assessment key={`assessment:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="work"/>,
    'early-years':()=><EarlyYearsWork key={`early-years:${sid}:${role}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    fees:()=>role==='guardian'?<GuardianStatement key={`statement:${sid}`} schoolId={sid}/>:<Finance key={`finance:${sid}`} schoolId={sid} csrfToken={csrf} role={role} view="work"/>,
    notices:()=>role==='guardian'?<GuardianNotices key={`gnotices:${sid}`} schoolId={sid}/>:<Notices key={`notices:${sid}`} schoolId={sid} csrfToken={csrf}/>,
    children:()=><MyChildren key={`children:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    settings:()=><div className="settings"><nav className="setting-steps" aria-label="Settings">{settingsSteps.map((step,index)=><a key={step.id} href={`#/settings/${step.id}`} aria-current={step.id===setting.id?'page':undefined}><b aria-hidden="true">{index+1}</b>{step.label}</a>)}</nav><div className="setting-body">{setting.render()}</div></div>,
  };
  const groups=navByRole[role]??[],items=groups.flatMap(g=>g.items),wanted=legacyIds[tabId]??tabId,current=items.find(item=>item.id===wanted)??items[0];
  const roleName=role==='frontdesk'?'Front desk':role.charAt(0).toUpperCase()+role.slice(1);
  const meta=current&&pageMeta[current.id];
  const initials=(school?.name??'V').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]!.toUpperCase()).join('');
  return <div className="shell">
    <aside className={menuOpen?'sidebar open':'sidebar'}>
      <a href="#/" className="brand"><span className="logo" aria-hidden="true">{initials}</span><span className="brand-text"><strong>{school?.name??'Veloxa SmartSchool'}</strong><span>{roleName||'Signed in'}</span></span></a>
      {session.schools.length>1&&<label className="school-picker">School<select value={school?.id??''} disabled={busy} onChange={e=>{setBusy(true);selectSchool(e.target.value).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>{!school&&<option value="">Loading…</option>}{session.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {school&&<nav aria-label="Sections">{groups.map(g=><div key={g.items[0].id} className="nav-section">{g.group&&<p className="nav-group">{g.group}</p>}{g.items.map(item=><a key={item.id} href={`#/${item.id}`} aria-current={item.id===current?.id?'page':undefined}><Icon name={item.icon}/><span className="label">{item.label}</span></a>)}</div>)}</nav>}
      <p className="sidebar-foot">Veloxa SmartSchool</p>
    </aside>
    {menuOpen&&<div className="scrim" onClick={()=>setMenuOpen(false)}/>}
    <div className="content">
      <header className="topbar"><button type="button" className="icon-button menu-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}><Icon name="menu"/></button>{school&&<h1>{school.name}</h1>}{school&&<em className="role-chip">{roleName}</em>}<div className="user"><span className="avatar" aria-hidden="true">{session.displayName.charAt(0).toUpperCase()}</span><span className="name">{session.displayName}</span></div><button className="secondary sign-out" disabled={busy} onClick={signOut}>Sign out</button></header>
      <main>{session.platformAdmin&&<PlatformAdmin csrfToken={session.csrfToken} onEnter={enterSchool}/>}{school&&<>{meta&&<PageHeader eyebrow={meta.eyebrow} title={meta.title} blurb={meta.blurb}/>}<Suspense fallback={<p role="status">Loading…</p>}>{current&&views[current.id]()}</Suspense></>}{!school&&<p role="status">{status||'Select an available school to continue.'}</p>}{LOCAL&&<p className="muted local-note">Local foundation build · Synthetic schools</p>}</main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
