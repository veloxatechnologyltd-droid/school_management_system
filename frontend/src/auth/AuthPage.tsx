import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../lib/ui';
import './auth.css';
import { shots, type Shot } from './content';

export type AuthMode = 'signin' | 'register';
export type AuthProps = {
  mode: AuthMode;
  local: boolean;
  busy: boolean;
  status: string;
  email: string; onEmail: (value: string) => void;
  password: string; onPassword: (value: string) => void;
  fullName: string; onFullName: (value: string) => void;
  schoolName: string; onSchoolName: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSwitch: (to: AuthMode) => void;
};

const IMG = '/auth/';

/* A real page of the product in a browser frame, or a phone frame for the parent's screens. */
function Screen({ shot, eager = false, decorative = false }: { shot: Shot; eager?: boolean; decorative?: boolean }) {
  const image = <img src={`${IMG}${shot.file}.webp`} alt={decorative ? '' : shot.alt} width={shot.phone ? 390 : 1100} height={shot.phone ? 780 : 720} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  return shot.phone
    ? <figure className="au-phone">{image}</figure>
    : <figure className="au-browser"><div className="au-browser-bar" aria-hidden="true"><i /><i /><i /><span>Sunrise International School · demo school</span></div>{image}</figure>;
}

function Nav({ mode, onSwitch }: Pick<AuthProps, 'mode' | 'onSwitch'>) {
  const other: AuthMode = mode === 'signin' ? 'register' : 'signin';
  return <nav className="au-nav" aria-label="Main">
    <a className="au-brand" href="#" aria-label="Veloxa SmartSchool home"><img className="logo" src="/brand/mark-white.svg" alt="" /></a>
    <a className="au-nav-cta" href={`#/${other}`} onClick={event => { event.preventDefault(); onSwitch(other); }}>{mode === 'signin' ? 'Create account' : 'Sign in'}</a>
  </nav>;
}

function PasswordField({ id, label, value, onChange, autoComplete, minLength, hint }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete: string; minLength?: number; hint?: ReactNode }) {
  const [shown, setShown] = useState(false);
  // The label is tied by id (not wrapped around the input) so the show/hide button does not become part of the field's name.
  return <div className="au-field">
    <label htmlFor={id}>{label}</label>
    <div className="au-inputwrap">
      <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} required />
      <button type="button" className="au-eye" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown(!shown)}><Icon name={shown ? 'visibility_off' : 'visibility'} /></button>
    </div>
    {hint && <p className="au-hint" id={`${id}-hint`}>{hint}</p>}
  </div>;
}

function Card(props: AuthProps) {
  const { mode, local, busy, status, email, password, fullName, schoolName, onSwitch } = props;
  const registering = mode === 'register';
  return <div className="au-card">
    <h1>{registering ? 'Create your account' : 'Welcome back'}</h1>
    <p className="au-card-sub">{registering ? 'Set up your school and become its headteacher. You can add staff and guardians afterwards.' : local ? 'Use a synthetic staff account to open your school.' : 'Sign in with the account your school administrator created for you.'}</p>
    {registering
      ? <form onSubmit={props.onSubmit}>
        <label>Your full name<input autoComplete="name" minLength={2} maxLength={120} value={fullName} onChange={event => props.onFullName(event.target.value)} required /></label>
        <label>School name<input autoComplete="organization" minLength={3} maxLength={120} value={schoolName} onChange={event => props.onSchoolName(event.target.value)} required /></label>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={event => props.onEmail(event.target.value)} required /></label>
        <PasswordField id="au-password" label="Password (at least 12 characters)" value={password} onChange={props.onPassword} autoComplete="new-password" minLength={12}
          hint={password.length >= 12 ? <><Icon name="check_circle" /> Long enough</> : `${password.length} of 12 characters. A phrase of three or four words works well.`} />
        <button className="au-submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      : <form onSubmit={props.onSubmit}>
        <label>Email or phone number<input autoComplete="username" value={email} onChange={event => props.onEmail(event.target.value)} required /></label>
        <PasswordField id="au-password" label="Password" value={password} onChange={props.onPassword} autoComplete="current-password" />
        <button className="au-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>}
    <p role="status" className="au-status">{status}</p>
    {registering
      ? <p className="au-muted">Already have an account? <button type="button" className="au-textbtn" onClick={() => onSwitch('signin')}>Sign in</button></p>
      : <p className="au-muted">New here? <button type="button" className="au-textbtn" onClick={() => onSwitch('register')}>Create an account</button></p>}
    <p className="au-muted">{registering ? 'Free for schools. No card needed.' : local ? 'Synthetic data only. Password: Synthetic-only-2026!' : 'Forgot your password? Ask your school administrator to reset it.'}</p>
    {(registering || !local) && <p className="au-muted"><a href="#">Back to the home page</a></p>}
  </div>;
}

function Aside() {
  const items: [string, string][] = [
    ['lock', 'Encrypted connection. Sessions end after 8 hours.'],
    ['shield_lock', "Your school's records are sealed from every other school."],
    ['child_care', 'Children never get their own logins. Families use their own phone.'],
  ];
  return <ul className="au-aside">{items.map(([icon, text]) => <li key={icon}><Icon name={icon} />{text}</li>)}</ul>;
}

function Pitch({ mode }: { mode: AuthMode }) {
  const registering = mode === 'register';
  const points = registering
    ? ['Free for your school: no setup fee, no subscription, no card', 'Bring your class lists in from Excel, with a preview first', 'Teachers see only the classes you assign to them']
    : ["Headteachers: today's open items, most urgent first", 'Teachers: your classes, registers and marks', 'Parents: progress, report cards, fees, notices and practice'];
  return <div className="au-pitch">
    <p className="au-kicker">{registering ? 'For Ghanaian basic schools, KG to JHS' : 'Veloxa SmartSchool'}</p>
    <h2 className="au-display">{registering ? 'Your school, set up by the end of the afternoon.' : 'Pick up where you left off.'}</h2>
    <p className="au-lede">{registering
      ? 'Create the headteacher account, add your classes, invite your teachers and bring your learner list in from Excel.'
      : "Registers, fees, report cards and your assistant are all as you left them. Families find their child's progress, notices and practice waiting."}</p>
    <ul className="au-points">{points.map(point => <li key={point}><Icon name="check_circle" />{point}</li>)}</ul>
    <div className="au-visual">
      <Screen shot={shots.home} eager decorative />
      <div className="au-visual-phone"><Screen shot={shots.parentHome} eager decorative /></div>
    </div>
  </div>;
}

export default function AuthPage(props: AuthProps) {
  const { mode, onSwitch } = props;
  const registering = mode === 'register';
  useEffect(() => {
    document.title = `${registering ? 'Create your account' : 'Sign in'} · Veloxa SmartSchool`;
    // Heavier headline face, shared with the home page (Google Sans stops at 700).
    if (!document.getElementById('lp-display-font')) {
      document.head.appendChild(Object.assign(document.createElement('link'), { id: 'lp-display-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@600..1000&display=swap' }));
    }
    window.scrollTo(0, 0);
    return () => { document.title = 'Veloxa SmartSchool'; };
  }, [registering]);
  return <div className="au" data-mode={mode}>
    <header className="au-header"><Nav mode={mode} onSwitch={onSwitch} /></header>
    <main id="main">
      <div className="au-hero">
        <Card {...props} />
        <Aside />
        <Pitch mode={mode} />
      </div>
    </main>
  </div>;
}
