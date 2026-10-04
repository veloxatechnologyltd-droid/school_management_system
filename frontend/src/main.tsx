import React, { FormEvent, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { request } from './lib/api';
import { Mfa } from './modules/Mfa';
import { PlatformAdmin } from './modules/PlatformAdmin';
// Local synthetic hints show only on the dev server unless it runs against the cloud database (npm run dev:cloud).
const LOCAL=import.meta.env.DEV&&import.meta.env.VITE_APP_MODE!=='cloud';
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
const tabsByRole:Record<string,{id:string;label:string}[]>={
  headteacher:[{id:'today',label:'Today'},{id:'learners',label:'Learners'},{id:'learning',label:'Learning'},{id:'fees',label:'Fees'},{id:'notices',label:'Notices'},{id:'school',label:'School'}],
  teacher:[{id:'today',label:'Today'},{id:'learning',label:'Learning'}],
  accountant:[{id:'fees',label:'Fees'}],
  frontdesk:[{id:'learners',label:'Learners'}],
  guardian:[{id:'children',label:'My children'},{id:'fees',label:'Fees'},{id:'notices',label:'Notices'}]
};
type School = {id:string;name:string;role:string;version:number};
type Session = {displayName:string;csrfToken:string;schools:School[];platformAdmin:boolean;mustChangePassword:boolean;mfaRequired:boolean;mfaEnrolled:boolean;mfaVerified:boolean};
type AuditPage = {items:Audit[];total:number};
type Audit = {id:string;action:string;created_at:string;metadata:{version?:number}};
function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [school,setSchool] = useState<School|null>(null);
  const [audit,setAudit] = useState<Audit[]>([]);
  const [auditTotal,setAuditTotal] = useState(0);
  const [email,setEmail] = useState(LOCAL?'head@example.test':'');
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
  useEffect(()=>{const change=()=>setTab(location.hash.replace(/^#\//,''));addEventListener('hashchange',change);return ()=>removeEventListener('hashchange',change);},[]);
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
  if(!session&&registering)return <main className="login"><p className="eyebrow">School workspace</p><h1>Create your account</h1><p>Set up your school and become its headteacher. You can add staff and guardians afterwards.</p><form onSubmit={register}><label>Your full name<input autoComplete="name" minLength={2} maxLength={120} value={fullName} onChange={e=>setFullName(e.target.value)} required/></label><label>School name<input minLength={3} maxLength={120} value={schoolName} onChange={e=>setSchoolName(e.target.value)} required/></label><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password (at least 12 characters)<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Creating…':'Create account'}</button></form><p role="status">{status}</p><p className="muted">Already have an account? <button type="button" className="secondary" onClick={()=>{setRegistering(false);setStatus('');setPassword('')}}>Sign in</button></p></main>;
  if(!session)return <main className="login"><p className="eyebrow">{LOCAL?'School workspace · Local development':'School workspace'}</p><h1>Welcome back</h1><p>{LOCAL?'Use a synthetic staff account to open your school.':'Sign in with the account your school administrator created for you.'}</p><form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p role="status">{status}</p><p className="muted">New here? <button type="button" className="secondary" onClick={()=>{setRegistering(true);setStatus('');setPassword('');if(LOCAL)setEmail('')}}>Create an account</button></p><p className="muted">{LOCAL?'Synthetic data only. Password: Synthetic-only-2026!':'Forgot your password? Ask your school administrator to reset it.'}</p></main>;
  if(session.mustChangePassword)return <main className="login"><p className="eyebrow">School workspace</p><h1>Choose a new password</h1><p>Your account was created with a temporary password. Choose your own to continue (at least 12 characters).</p><form onSubmit={changePassword}><label>Temporary password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Saving…':'Save new password'}</button></form><p role="status">{status}</p></main>;
  if(session.mfaRequired&&!session.mfaVerified)return <Mfa csrfToken={session.csrfToken} enrolled={session.mfaEnrolled} onDone={restore} onSignOut={()=>void signOut()}/>;
  const schoolDetails=school&&<><section><h2>School details</h2>{school.role==='headteacher'?<form onSubmit={save}><label>School name<input value={name} minLength={3} maxLength={120} onChange={e=>setName(e.target.value)} required/></label><div className="actions"><button disabled={busy||name===school.name}>{busy?'Saving…':'Save details'}</button><button className="secondary" type="button" disabled={busy} onClick={()=>selectSchool(school.id).catch(error=>setStatus(error.message))}>Reload details</button></div><p className="muted">{name!==school.name?'Unsaved changes':`Saved version ${school.version}`}</p></form>:<p>School details are maintained by the headteacher.</p>}<p role="status" aria-live="polite">{status}</p></section></>;
  const recentChanges=school&&<section><h2>Recent changes</h2><AuditExport key={school.id} schoolId={school.id} csrfToken={session.csrfToken}/>{audit.length?<><ul className="history">{audit.map(item=><li key={item.id}><strong>{({"school.details.updated":"School details saved","audit.export.requested":"Audit export requested"} as Record<string,string>)[item.action]??item.action.replaceAll("."," ")}</strong><span>{item.metadata.version?`Version ${item.metadata.version} · `:""}{new Date(item.created_at).toLocaleString('en-GH',{timeZone:'Africa/Accra'})}</span></li>)}</ul>{audit.length<auditTotal&&<p>Showing {audit.length} of {auditTotal} changes. <button type="button" className="secondary" onClick={()=>void moreAudit()}>Show older changes</button></p>}</>:<p>No changes recorded yet.</p>}</section>;
  const sid=school?.id??'',csrf=session.csrfToken,role=school?.role??'';
  const views:Record<string,()=>React.ReactNode>={
    today:()=><>{role==='headteacher'&&<AttendanceFollowUp key={`followup:${sid}`} schoolId={sid}/>}<Attendance key={`attendance:${sid}`} schoolId={sid} csrfToken={csrf} role={role} accessRefresh={teacherAccessRefresh}/>{role==='teacher'&&<Teaching key={`teaching:${sid}`} schoolId={sid} csrfToken={csrf} role={role} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>}</>,
    learners:()=><>{['headteacher','frontdesk'].includes(role)&&<Admissions key={sid} schoolId={sid} csrfToken={csrf} role={role}/>}{['headteacher','frontdesk'].includes(role)&&<Collection key={'collection:'+sid} schoolId={sid} csrfToken={csrf} role={role}/>}{role==='headteacher'&&<Guardians key={`guardians:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/>}{role==='headteacher'&&<Promotion key={`promotion:${sid}`} schoolId={sid} csrfToken={csrf}/>}</>,
    learning:()=><>{role==='headteacher'&&<Teaching key={`teaching:${sid}`} schoolId={sid} csrfToken={csrf} role={role} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>}<Assessment key={`assessment:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/><EarlyYears key={`early-years:${sid}:${role}`} schoolId={sid} csrfToken={csrf} role={role}/><EarlyYearsReports key={`early-years-reports:${sid}:${role}`} schoolId={sid} csrfToken={csrf} role={role}/></>,
    fees:()=>role==='guardian'?<GuardianStatement key={`statement:${sid}`} schoolId={sid}/>:<Finance key={`finance:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/>,
    notices:()=>role==='guardian'?<GuardianNotices key={`gnotices:${sid}`} schoolId={sid}/>:<Notices key={`notices:${sid}`} schoolId={sid} csrfToken={csrf}/>,
    children:()=><><Guardians key={`guardians:${sid}`} schoolId={sid} csrfToken={csrf} role={role}/><EarlyYearsReports key={`early-years-reports:${sid}:${role}`} schoolId={sid} csrfToken={csrf} role={role}/><GuardianTerminalReports key={`terminal:${sid}`} schoolId={sid}/></>,
    school:()=><><Accounts key={`accounts:${sid}`} schoolId={sid} csrfToken={csrf}/><AiSettings key={`ai:${sid}`} schoolId={sid} csrfToken={csrf}/>{schoolDetails}{recentChanges}</>,
  };
  const tabs=(tabsByRole[role]??[]),current=tabs.find(item=>item.id===tab)??tabs[0];
  return <><header><a href="/" className="brand">School workspace</a><span>{session.displayName}</span><button className="secondary" disabled={busy} onClick={signOut}>Sign out</button></header><main>{session.platformAdmin&&<PlatformAdmin csrfToken={session.csrfToken} onEnter={enterSchool}/>}<p className="eyebrow">Your school</p><label className="school-picker">School<select value={school?.id??''} disabled={busy} onChange={e=>{setBusy(true);selectSchool(e.target.value).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>{!school&&<option value="">Loading…</option>}{session.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{school&&<><h1>{school.name}</h1><p className="muted">Signed in as {school.role}. All records are scoped to this school.</p><nav className="tabs" aria-label="Sections">{tabs.map(item=><a key={item.id} href={`#/${item.id}`} aria-current={item.id===current?.id?'page':undefined}>{item.label}</a>)}</nav><Suspense fallback={<p role="status">Loading…</p>}>{current&&views[current.id]()}</Suspense></>}{!school&&<p role="status">{status||'Select an available school to continue.'}</p>}{LOCAL&&<p className="muted">Local foundation build · Synthetic schools</p>}</main></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
