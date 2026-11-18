/**
 * The air ribbon: the day's 24 hourly PM2.5 levels as bars coloured by India AQI category, the
 * cleanest airing hours highlighted, and a marker where each activity is moved to.
 * Does: draw one inline SVG with `role="img"` and a written summary, step the bar opacity up with
 * the category (so colour is never the only signal), list the categories in a legend, and offer
 * the same numbers as a real table inside a `<details>`.
 * Never does: use external images or inline styles; bars are styled by category classes.
 */
import type { ReactElement } from 'react';
import { NAQI_CATEGORIES } from '../../domain/aqi.js';
import type { DayPlan } from '../../domain/plan.js';
import { clock, hourSpan, whole } from '../../ui/format.js';
import { CATEGORY_LABELS, KIND_LABELS } from '../../ui/labels.js';

const BAR = 24;
const STEP = 29;
const LEFT = 8;
const TOP = 40;
const HEIGHT = 150;
const WIDTH = LEFT + 24 * STEP;
const xOf = (hour: number): number => LEFT + hour * STEP;

/** The ribbon section. */
export function AirRibbon({ plan }: { readonly plan: DayPlan }): ReactElement {
  const peak = Math.max(1, ...plan.hours.map((h) => h.pm25));
  const [first, last] = plan.airing.hours;
  // Each hour with its AQI, paired by position.
  const rows = plan.hours.flatMap((h, hour) =>
    plan.hourlyNaqi.slice(hour, hour + 1).map((n) => ({ h, hour, n })),
  );
  const present = NAQI_CATEGORIES.filter((c) => plan.hourlyNaqi.some((n) => n.category === c));
  const summary = `Hourly PM2.5 for ${plan.date}. Worst at ${clock(plan.worst.hour)} with ${whole(plan.worst.pm25)} micrograms per cubic metre. Cleanest two hours ${hourSpan(first, last)}.`;
  return (
    <section className="ribbon" aria-labelledby="ribbon-title">
      <h2 id="ribbon-title">The air hour by hour</h2>
      <svg
        className="ribbon__svg"
        viewBox={`0 0 ${WIDTH} ${TOP + HEIGHT + 30}`}
        role="img"
        aria-label={summary}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect
          className="ribbon__clean"
          x={xOf(first) - 2}
          y={TOP - 14}
          width={2 * STEP + 1}
          height={HEIGHT + 14}
          rx={6}
        />
        <text className="ribbon__note" x={xOf(first)} y={TOP - 22}>
          cleanest
        </text>
        {rows.map(({ h, hour, n }) => {
          const bar = Math.max(2, (h.pm25 / peak) * HEIGHT);
          const { category } = n;
          return (
            <g key={h.time}>
              <rect
                className={`bar cat-${category}`}
                x={xOf(hour)}
                y={TOP + HEIGHT - bar}
                width={BAR}
                height={bar}
                rx={3}
              >
                <title>{`${clock(hour)}: PM2.5 ${whole(h.pm25)} µg/m³, ${CATEGORY_LABELS[category]}`}</title>
              </rect>
              {hour % 3 === 0 ? (
                <text className="ribbon__hour" x={xOf(hour) + BAR / 2} y={TOP + HEIGHT + 22}>
                  {String(hour).padStart(2, '0')}
                </text>
              ) : null}
            </g>
          );
        })}
        {plan.moves.map((m) => (
          <g key={m.activity.id}>
            <circle className="ribbon__move" cx={xOf(m.toHour) + BAR / 2} cy={TOP - 4} r={6}>
              <title>{`${KIND_LABELS[m.activity.kind]} moves to ${clock(m.toHour)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <ul className="legend" aria-label="Colour key">
        {present.map((c) => (
          <li key={c}>
            <span className={`swatch cat-${c}`} aria-hidden="true" /> {CATEGORY_LABELS[c]}
          </li>
        ))}
        <li>
          <span className="swatch swatch--clean" aria-hidden="true" /> Cleanest hours to air the
          home
        </li>
        <li>
          <span className="swatch swatch--move" aria-hidden="true" /> A suggested new start time
        </li>
      </ul>
      <details>
        <summary>Show the hourly numbers as a table</summary>
        <table>
          <caption>Outdoor air by hour for {plan.date}</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">PM2.5 (µg/m³)</th>
              <th scope="col">India AQI</th>
              <th scope="col">Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ h, hour, n }) => (
              <tr key={h.time}>
                <th scope="row">{clock(hour)}</th>
                <td>{whole(h.pm25)}</td>
                <td>{n.value}</td>
                <td>{CATEGORY_LABELS[n.category]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
