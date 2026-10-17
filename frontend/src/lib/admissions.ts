import type { Tone } from './ui';

// The stages of an application, shared by the Admissions list and an application's own page.
export const statusNames: Record<string, string> = { application: 'Application', review: 'Under review', offered: 'Offered a place', waitlisted: 'Waitlisted', declined: 'Declined', accepted: 'Accepted', enrolled: 'Enrolled' };
export const statusTone: Record<string, Tone> = { application: 'info', review: 'info', offered: 'caution', waitlisted: 'neutral', declined: 'critical', accepted: 'caution', enrolled: 'positive' };

export function actionsFor(status: string) {
  if (status === 'application') return ['review'];
  if (status === 'review') return ['offer', 'waitlist', 'decline'];
  if (status === 'offered') return ['accept'];
  if (status === 'waitlisted') return ['offer', 'decline'];
  if (status === 'accepted') return ['enrol'];
  return [];
}
// The one thing to do next on an application, in a line.
export function nextStep(status: string, className: string) {
  return ({ application: 'Start the review.', review: 'Decide: offer a place, put on the waitlist, or decline.', offered: 'Waiting for the family. Record their acceptance when they confirm.',
    waitlisted: 'Offer a place when one opens, or decline.', accepted: `Enrol into ${className}.`, enrolled: 'Nothing more. The student is on the roll.', declined: 'Nothing more. The application is closed.' } as Record<string, string>)[status] ?? '';
}
// What each recorded step of an application reads as on a timeline.
export type Step = 'created' | 'review' | 'offered' | 'waitlisted' | 'declined' | 'accepted' | 'enrolled';
export const stepNames: Record<Step, string> = { created: 'Application received', review: 'Review started', offered: 'Place offered', waitlisted: 'Put on the waitlist', declined: 'Declined', accepted: 'Family accepted the place', enrolled: 'Enrolled' };
