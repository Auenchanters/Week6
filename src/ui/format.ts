/**
 * Number, hour and date wording for the screen.
 * Does: group numbers the Indian way (en-IN), show µg and cigarettes with their units, write hours
 * as "07:00" and a plan date as "Wed 18 Nov".
 * Never does: read the clock, or round the engine's numbers before the caller asks to show them.
 */

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** A whole number with en-IN grouping: 12,34,567. */
export const whole = (n: number): string => grouped.format(n);

/** One decimal place with en-IN grouping: 3.0. */
export const tenths = (n: number): string => oneDecimal.format(n);

/** Micrograms: "1,234 µg". */
export const micrograms = (n: number): string => `${whole(n)} µg`;

/** "07:00" for hour 7; hour 24 reads "24:00". */
export const clock = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** "07:00–09:00" for the two hours that start at 7 and 8. */
export const hourSpan = (first: number, last: number): string =>
  `${clock(first)}–${clock(last + 1)}`;

/** "1.0 cigarette" or "2.4 cigarettes". */
export function cigarettes(n: number): string {
  const text = tenths(n);
  return `${text} ${text === '1.0' ? 'cigarette' : 'cigarettes'}`;
}

/** "Wed 18 Nov" for `2026-11-18`. */
export const dayLabel = (isoDate: string): string =>
  dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
