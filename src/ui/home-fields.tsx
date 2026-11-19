/**
 * The home settings that change indoor air the most, as form controls: purifier, window habit,
 * kitchen exhaust fan, incense, heater and its hours, and cooking fuel.
 * Does: render them from a `Home` and report each change as a patch; the setup form and the
 * "what if" panel both use it, so a setting reads the same everywhere.
 * Never does: keep state, validate, or touch the profile (the caller applies the patch).
 */
import type { ReactElement } from 'react';
import { LIMITS } from '../shared/limits.js';
import { COOKING_FUELS, HEATERS, PURIFIERS, WINDOW_HABITS, type Home } from '../shared/schema.js';
import { CheckField, NumberField, SelectField } from './fields.js';
import { FUEL_LABELS, HEATER_LABELS, PURIFIER_LABELS, WINDOW_LABELS } from './labels.js';

/** The two yes-or-no habits: the kitchen exhaust fan and incense. */
function HomeHabits(props: {
  readonly prefix: string;
  readonly home: Home;
  readonly onChange: (patch: Partial<Home>) => void;
}): ReactElement {
  const { prefix, home, onChange } = props;
  return (
    <div className="checks">
      <CheckField
        id={`${prefix}-exhaustFan`}
        label="Kitchen exhaust fan while cooking"
        checked={home.exhaustFan}
        onChange={(exhaustFan) => {
          onChange({ exhaustFan });
        }}
      />
      <CheckField
        id={`${prefix}-incense`}
        label="Incense or dhoop indoors"
        checked={home.incense}
        onChange={(incense) => {
          onChange({ incense });
        }}
      />
    </div>
  );
}

/** The seven air-source controls for `home`; ids start with `prefix`. */
export function HomeSourceFields(props: {
  readonly prefix: string;
  readonly home: Home;
  readonly heaterHoursError?: string | undefined;
  readonly onChange: (patch: Partial<Home>) => void;
}): ReactElement {
  const { prefix, home, heaterHoursError, onChange } = props;
  return (
    <>
      <SelectField
        id={`${prefix}-purifier`}
        label="Air purifier"
        value={home.purifier}
        values={PURIFIERS}
        labels={PURIFIER_LABELS}
        onChange={(purifier) => {
          onChange({ purifier });
        }}
      />
      <SelectField
        id={`${prefix}-windows`}
        label="Windows"
        value={home.windows}
        values={WINDOW_HABITS}
        labels={WINDOW_LABELS}
        onChange={(windows) => {
          onChange({ windows });
        }}
      />
      <SelectField
        id={`${prefix}-cookingFuel`}
        label="Cooking fuel"
        value={home.cookingFuel}
        values={COOKING_FUELS}
        labels={FUEL_LABELS}
        onChange={(cookingFuel) => {
          onChange({ cookingFuel });
        }}
      />
      <SelectField
        id={`${prefix}-heater`}
        label="Heater"
        value={home.heater}
        values={HEATERS}
        labels={HEATER_LABELS}
        onChange={(heater) => {
          onChange({ heater });
        }}
      />
      <NumberField
        id={`${prefix}-heaterHours`}
        label="Heater hours a day"
        value={home.heaterHours}
        min={0}
        max={LIMITS.profile.heaterHoursMax}
        error={heaterHoursError}
        onChange={(heaterHours) => {
          onChange({ heaterHours });
        }}
      />
      <HomeHabits prefix={prefix} home={home} onChange={onChange} />
    </>
  );
}
