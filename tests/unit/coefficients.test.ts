/**
 * Sanity invariants for the coefficient tables: every value is finite and physically sensible, and
 * the orderings the model relies on (effort, tightness, purifier size, fuel cleanliness) hold.
 */
import { describe, expect, it } from 'vitest';
import * as c from '../../src/domain/coefficients.js';
import { AGE_BANDS, MODES } from '../../src/shared/schema.js';

describe('coefficients', () => {
  it('breathing rates rise with effort for every age band', () => {
    for (const age of AGE_BANDS) {
      const r = c.BREATHING_M3_PER_H[age];
      expect(r.rest).toBeGreaterThan(0);
      expect(r.rest).toBeLessThan(r.light);
      expect(r.light).toBeLessThan(r.moderate);
      expect(r.moderate).toBeLessThan(r.vigorous);
    }
  });

  it('every mode has a positive exposure ratio, an effort and a non-negative CO2 factor', () => {
    for (const mode of MODES) {
      expect(c.MODE_EXPOSURE_RATIO[mode]).toBeGreaterThan(0);
      expect(c.MODE_CO2_KG_PER_KM[mode]).toBeGreaterThanOrEqual(0);
      expect(['light', 'moderate']).toContain(c.MODE_EFFORT[mode]);
    }
    expect(c.MODE_EXPOSURE_RATIO['car-recirculation']).toBeLessThan(
      c.MODE_EXPOSURE_RATIO['car-windows-open'],
    );
    expect(c.MODE_CO2_KG_PER_KM.walk).toBe(0);
  });

  it('tighter homes leak less', () => {
    expect(c.INFILTRATION_ACH.leaky).toBeGreaterThan(c.INFILTRATION_ACH.average);
    expect(c.INFILTRATION_ACH.average).toBeGreaterThan(c.INFILTRATION_ACH.tight);
  });

  it('purifier sizes are ordered and none does nothing', () => {
    expect(c.PURIFIER_CADR_M3_PER_H.none).toBe(0);
    expect(c.PURIFIER_WATTS.none).toBe(0);
    expect(c.PURIFIER_CADR_M3_PER_H.small).toBeLessThan(c.PURIFIER_CADR_M3_PER_H.medium);
    expect(c.PURIFIER_CADR_M3_PER_H.medium).toBeLessThan(c.PURIFIER_CADR_M3_PER_H.large);
    expect(c.PURIFIER_WATTS.small).toBeLessThan(c.PURIFIER_WATTS.large);
  });

  it('fuels are ordered from cleanest to dirtiest', () => {
    const e = c.COOKING_EMISSION_MG_PER_H;
    expect(e.induction).toBeLessThan(e.lpg);
    expect(e.lpg).toBeLessThan(e.kerosene);
    expect(e.kerosene).toBeLessThan(e.biomass);
    expect(c.HEATER_EMISSION_MG_PER_H.none).toBe(0);
    expect(c.HEATER_EMISSION_MG_PER_H.electric).toBe(0);
    expect(c.HEATER_EMISSION_MG_PER_H.kerosene).toBeLessThan(
      c.HEATER_EMISSION_MG_PER_H['coal-wood'],
    );
    expect(c.HEATER_CO2_KG_PER_H.none).toBe(0);
  });

  it('scalars are in range', () => {
    expect(c.PENETRATION).toBeGreaterThan(0);
    expect(c.PENETRATION).toBeLessThanOrEqual(1);
    expect(c.N95_REDUCTION).toBeGreaterThan(0);
    expect(c.N95_REDUCTION).toBeLessThan(1);
    expect(c.AWAY_INDOOR_RATIO).toBeGreaterThan(0);
    expect(c.AWAY_INDOOR_RATIO).toBeLessThan(1);
    expect(c.CIGARETTE_EQUIVALENT_UG_M3).toBe(22);
    expect(c.DAYS_PER_WEEK).toBe(7);
    expect(c.CEILING_M).toBeGreaterThan(2);
    expect(c.DEPOSITION_PER_H).toBeGreaterThan(0);
    expect(c.OPEN_WINDOW_ACH).toBeGreaterThan(c.INFILTRATION_ACH.leaky);
    expect(c.GRID_KG_PER_KWH).toBeGreaterThan(0);
    expect(c.WASTE_BURNING_PM_G_PER_KG * c.WASTE_BURNED_KG_PER_WEEK).toBeCloseTo(19.6);
  });

  it('every tabulated number is finite and non-negative', () => {
    const tables: Record<string, number>[] = [
      { ...c.MODE_EXPOSURE_RATIO },
      { ...c.MODE_CO2_KG_PER_KM },
      { ...c.INFILTRATION_ACH },
      { ...c.PURIFIER_WATTS },
      { ...c.PURIFIER_CADR_M3_PER_H },
      { ...c.COOKING_EMISSION_MG_PER_H },
      { ...c.HEATER_EMISSION_MG_PER_H },
      { ...c.COOKING_CO2_KG_PER_H },
      { ...c.HEATER_CO2_KG_PER_H },
      { ...c.INCENSE_HOURS },
      ...AGE_BANDS.map((a) => ({ ...c.BREATHING_M3_PER_H[a] })),
    ];
    for (const table of tables)
      for (const value of Object.values(table)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
  });

  it('hour tables stay inside the day', () => {
    const hours = [
      ...c.COOKING_HOURS,
      ...c.SMOKING_HOURS,
      ...Object.values(c.WINDOW_HOURS).flat(),
      ...Object.keys(c.INCENSE_HOURS).map(Number),
      c.HEATER_LAST_HOUR,
    ];
    for (const h of hours) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(23);
    }
    expect(c.WINDOW_HOURS.closed).toEqual([]);
  });
});
