/**
 * The home editor: floor area, how air-tight the home is, and every indoor air source.
 * Does: render the shared air-source controls plus area, tightness, indoor smoking, waste burning
 * and N95 use, and report each change as a patch to the home.
 * Never does: validate; the setup form does, with the whole draft.
 */
import type { ReactElement } from 'react';
import { LIMITS } from '../../shared/limits.js';
import { TIGHTNESS, type Home } from '../../shared/schema.js';
import { CheckField, NumberField, SelectField } from '../../ui/fields.js';
import { HomeSourceFields } from '../../ui/home-fields.js';
import { TIGHTNESS_LABELS } from '../../ui/labels.js';

/** The editor for the household's home. */
export function HomeEditor(props: {
  readonly home: Home;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (patch: Partial<Home>) => void;
}): ReactElement {
  const { home, errors, onChange } = props;
  return (
    <fieldset className="group">
      <legend>Your home</legend>
      <div className="row">
        <NumberField
          id="f-home-areaM2"
          label="Floor area (m²)"
          value={home.areaM2}
          min={LIMITS.profile.areaMinM2}
          max={LIMITS.profile.areaMaxM2}
          error={errors['f-home-areaM2']}
          onChange={(areaM2) => {
            onChange({ areaM2 });
          }}
        />
        <SelectField
          id="f-home-tightness"
          label="How air-tight is it?"
          value={home.tightness}
          values={TIGHTNESS}
          labels={TIGHTNESS_LABELS}
          onChange={(tightness) => {
            onChange({ tightness });
          }}
        />
      </div>
      <div className="row">
        <HomeSourceFields
          prefix="f-home"
          home={home}
          heaterHoursError={errors['f-home-heaterHours']}
          onChange={onChange}
        />
      </div>
      <div className="checks">
        <CheckField
          id="f-home-smokingIndoors"
          label="Someone smokes indoors"
          checked={home.smokingIndoors}
          onChange={(smokingIndoors) => {
            onChange({ smokingIndoors });
          }}
        />
        <CheckField
          id="f-home-burnsWaste"
          label="Garden or kitchen waste is burned"
          checked={home.burnsWaste}
          onChange={(burnsWaste) => {
            onChange({ burnsWaste });
          }}
        />
        <CheckField
          id="f-home-n95Outdoors"
          label="People wear a fitted N95 mask outdoors"
          checked={home.n95Outdoors}
          onChange={(n95Outdoors) => {
            onChange({ n95Outdoors });
          }}
        />
      </div>
    </fieldset>
  );
}
