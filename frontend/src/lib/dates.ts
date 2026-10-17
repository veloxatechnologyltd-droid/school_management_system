// Dates families and staff read, in one style: "8 Sept 2025". Stored days are ISO (yyyy-mm-dd), stored moments are timestamps.
const style = { day: 'numeric', month: 'short', year: 'numeric' } as const;
export const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...style });
export const momentLabel = (stamp: string) => new Date(stamp).toLocaleDateString('en-GB', { timeZone: 'Africa/Accra', ...style });
// Class and year end dates are stored as the first day after the period; people expect the last day in it.
export const lastDayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
// +233241234567 as 024 123 4567, the way people write it.
export const localPhone = (phone: string) => phone.replace(/^\+233(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');
