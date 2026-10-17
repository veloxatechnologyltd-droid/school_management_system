import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../lib/ui';
import './auth.css';
import { help, modules, production, roles, shots, strip, tour, type Shot } from './content';

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

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// In-page jumps use buttons: a #fragment link would be read by the app as a page address.
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
const IMG = '/auth/';

/* A real page of the product in a browser frame, or a phone frame for the parent's screens. */
function Screen({ shot, eager = false, decorative = false }: { shot: Shot; eager?: boolean; decorative?: boolean }) {
  const image = <img src={`${IMG}${shot.file}.webp`} alt={decorative ? '' : shot.alt} width={shot.phone ? 390 : 1100} height={shot.phone ? 780 : 720} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  return shot.phone
    ? <figure className="au-phone">{image}</figure>
    : <figure className="au-browser"><div className="au-browser-bar" aria-hidden="true"><i /><i /><i /><span>Sunrise International School · demo school</span></div>{image}</figure>;
}

/* Tabs with arrow-key movement; the panel is the content passed in. */
function useTabs(count: number) {
  const [index, setIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + count) % count;
    setIndex(next); refs.current[next]?.focus();
  };
  return { index, setIndex, refs, onKey };
}

function Nav({ mode, onSwitch }: Pick<AuthProps, 'mode' | 'onSwitch'>) {
  const other: AuthMode = mode === 'signin' ? 'register' : 'signin';
  const links: [string, string][] = mode === 'signin' ? [['tour', 'Inside the product'], ['roles', 'Who signs in'], ['spec', 'Specification']] : [];
  return <nav className="au-nav" aria-label="Main">
    <a className="au-brand" href="#"><span className="logo" aria-hidden="true">V</span>Veloxa SmartSchool</a>
    <div className="au-links">{links.map(([id, label]) => <button key={id} type="button" onClick={() => jump(id)}>{label}</button>)}</div>
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

function Strip() {
  return <section className="au-strip" aria-label="Why schools trust it"><div className="au-wrap"><ul>{strip.map(item => <li key={item.title}><span className="au-ico"><Icon name={item.icon} /></span><span><b>{item.title}</b>{item.text}</span></li>)}</ul></div></section>;
}

/* The product, one real page at a time. */
function Tour() {
  const { index, setIndex, refs, onKey } = useTabs(tour.length);
  const item = tour[index];
  return <section className="au-section" id="tour" aria-labelledby="tour-h">
    <div className="au-wrap">
      <p className="au-kicker">Inside the product</p>
      <h2 className="au-h2" id="tour-h">Everything the school does, behind one sign-in.</h2>
      <p className="au-sub">These are real pages of the Sunrise demo school, with sample learners. Choose one.</p>
      <div className="au-tour">
        <div className="au-tablist" role="tablist" aria-label="Pages of the product" onKeyDown={onKey}>
          {tour.map((t, i) => <button key={t.id} ref={el => { refs.current[i] = el; }} type="button" role="tab" id={`tour-tab-${t.id}`} aria-selected={i === index} aria-controls="tour-panel" tabIndex={i === index ? 0 : -1} onClick={() => setIndex(i)}><Icon name={t.icon} />{t.label}</button>)}
        </div>
        <div className="au-tourpanel" role="tabpanel" id="tour-panel" aria-labelledby={`tour-tab-${item.id}`}>
          <div className="au-tourtext">
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <ul>{item.points.map(point => <li key={point}><Icon name="check" />{point}</li>)}</ul>
          </div>
          <Screen shot={item.shot} />
        </div>
      </div>
    </div>
  </section>;
}

/* The parent's side, on the phone they already own. */
function Families() {
  const list: [Shot, string, string][] = [
    [shots.parentHome, 'Home', "How their child is doing, at a glance."],
    [shots.parentLearn, 'Learn at home', 'Practice and lessons on the topics the school is teaching, approved by teachers.'],
    [shots.parentProgress, 'Progress', 'Marks and trends, term by term.'],
    [shots.parentReports, 'Report cards', 'Published report cards, kept as issued.'],
  ];
  return <section className="au-section dark" aria-labelledby="fam-h">
    <div className="au-wrap">
      <p className="au-kicker light">For families</p>
      <h2 className="au-h2" id="fam-h">A teacher at home in the evening, on the phone they already have.</h2>
      <p className="au-sub">Children never get their own logins. A parent signs in once and sees their children, their fees and their notices, in plain words.</p>
      <ul className="au-phones">{list.map(([shot, title, text]) => <li key={title}><Screen shot={shot} /><b>{title}</b><span>{text}</span></li>)}</ul>
    </div>
  </section>;
}

function Roles() {
  return <section className="au-section" id="roles" aria-labelledby="roles-h">
    <div className="au-wrap">
      <p className="au-kicker">Who signs in</p>
      <h2 className="au-h2" id="roles-h">Everyone gets a front door that shows only their part.</h2>
      <ul className="au-roles">{roles.map(role => <li key={role.name}><span className="au-ico"><Icon name={role.icon} /></span><h3>{role.name}</h3><p>{role.text}</p><small>Opens on {role.first}</small></li>)}</ul>
    </div>
  </section>;
}

function Help() {
  return <section className="au-section tint" aria-labelledby="help-h">
    <div className="au-wrap">
      <p className="au-kicker">Signing in</p>
      <h2 className="au-h2" id="help-h">Stuck at the door? Start here.</h2>
      <ul className="au-help">{help.map(item => <li key={item.title}><span className="au-ico"><Icon name={item.icon} /></span><h3>{item.title}</h3><p>{item.text}</p></li>)}</ul>
    </div>
  </section>;
}

// Open by default on a wide screen and closed on a phone, so the page stays short there; a visitor can open or close either.
const wideScreen = () => typeof matchMedia !== 'function' || matchMedia('(min-width: 700px)').matches;
function Fold({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  const [open] = useState(wideScreen);
  return <details className="au-fold" open={open}><summary><span className="au-ico"><Icon name={icon} /></span><h4>{title}</h4></summary>{children}</details>;
}

function Spec() {
  return <section className="au-section" id="spec" aria-labelledby="spec-h">
    <div className="au-wrap">
      <p className="au-kicker">Specification</p>
      <h2 className="au-h2" id="spec-h">What is in the system, and what it runs on.</h2>
      <p className="au-sub">Every line describes what is built and running today. Where something is a target, optional, or not built yet, the line says so.</p>
      <h3 className="au-specsub">System</h3>
      <ul className="au-modules">{modules.map(m => <li key={m.title}><Fold icon={m.icon} title={m.title}><ul>{m.items.map(item => <li key={item}>{item}</li>)}</ul></Fold></li>)}</ul>
      <h3 className="au-specsub">Production</h3>
      <div className="au-prod">{production.map(group => <div className="au-prodgroup" key={group.group}>
        <Fold icon={group.icon} title={group.group}>
          <dl>{group.rows.map(row => <div key={row.title}><dt><span className={`au-tag ${row.tag.replace(/\s+/g, '-').toLowerCase()}`}>{row.tag}</span>{row.title}</dt><dd>{row.text}</dd></div>)}</dl>
        </Fold>
      </div>)}</div>
      <p className="au-fine">Source of record: the project's architecture and deployment documents. Sample figures and pictures come from the Sunrise demo school, whose learners are not real.</p>
    </div>
  </section>;
}

function Close({ onSwitch }: { onSwitch: (to: AuthMode) => void }) {
  return <section className="au-close" aria-labelledby="close-h">
    <div className="au-wrap">
      <h2 className="au-h2" id="close-h">New to Veloxa SmartSchool?</h2>
      <p>Set up your school this afternoon: create the headteacher account, add your classes and invite your teachers.</p>
      <div className="au-closebtns"><button type="button" className="au-big" onClick={() => onSwitch('register')}>Set up your school free</button></div>
    </div>
  </section>;
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
      {!registering && <><Strip /><Tour /><Roles /><Families /><Help /><Spec /><Close onSwitch={onSwitch} /></>}
    </main>
    {!registering && <footer className="au-foot"><span>© 2026 Veloxa SmartSchool</span><span>Made for schools in Ghana</span></footer>}
  </div>;
}
