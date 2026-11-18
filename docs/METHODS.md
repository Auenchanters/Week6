# Methods: how Clearday computes every number

Clearday's rule is **the engine computes, the AI explains**. Every figure a person sees (AQI, indoor
PM2.5, inhaled dose, cigarette equivalents, CO2) comes from the deterministic engine in
[`src/domain/`](../src/domain). Gemini gets those figures as numbered facts and may only cite them.
This page lists the models, the coefficients and where each coefficient comes from.

All figures are **estimates for a typical home and person**, not measurements, and not medical
advice. Where the literature gives a range, the engine uses its midpoint and says so in
[`coefficients.ts`](../src/domain/coefficients.ts).

## 1. Air quality indices ([`aqi.ts`](../src/domain/aqi.ts))

| Index | Pollutants | Averaging | Source |
| --- | --- | --- | --- |
| India National AQI (NAQI) | PM2.5, PM10, NO2, O3, CO, SO2 | 24-h mean (PM, NO2, SO2), max 8-h rolling mean (O3, CO) | CPCB, *National Air Quality Index* (2014), Table 3 |
| US AQI (PM2.5 only) | PM2.5 | 24-h mean, truncated to 0.1 µg/m³ | US EPA, Technical Assistance Document EPA-454/B-24-002 (2024 breakpoints) |

Each sub-index is a linear interpolation inside its breakpoint band; the AQI is the worst
sub-index, and the pollutant that set it is reported as dominant. CPCB leaves the top "Severe" band
open, so Clearday extends it by the width of the band below and caps the index at 500.

The hourly chart shows a per-hour NAQI from that hour's concentrations; that is an indication of
how the day moves, not an official 24-hour index.

Tests: every official band edge for all six pollutants and every EPA band edge is asserted exactly
in [`tests/unit/aqi.test.ts`](../tests/unit/aqi.test.ts), plus property tests that both indices are
monotone and bounded.

## 2. Indoor air ([`indoor.ts`](../src/domain/indoor.ts))

One well-mixed zone with a first-order PM2.5 mass balance:

```
dC/dt = (P·a + v)·C_out + S/V − (a + v + k + CADR/V)·C
```

| Symbol | Meaning | Value | Source |
| --- | --- | --- | --- |
| P | shell penetration | 0.8 | Chen & Zhao, *Atmos. Environ.* 2011 |
| a | infiltration (air changes/h) | leaky 1.0, average 0.5, tight 0.25 | ASHRAE Fundamentals ch. 16 |
| v | open windows / exhaust fan (ACH) | 5 / 2 | ASHRAE ranges 2–8 / 1–3, midpoints |
| k | deposition (per h) | 0.2 | Chen & Zhao 2011 |
| CADR | purifier clean air delivery rate | 150 / 300 / 450 m³/h | AHAM-rated typical units |
| V | volume | floor area × 2.8 m | typical apartment ceiling |
| S | indoor sources (mg/h) | induction 1.5, LPG 4, kerosene stove 25, biomass 200; kerosene heater 8, coal/wood heater 60; incense 20; one cigarette 12 | WHO Household Fuel Combustion guidelines 2014; Abdullahi et al. 2013; Lee & Wang 2004; Klepeis et al. 2003 |

Inputs are constant within an hour, so the equation is solved **exactly** per hour (exponential
decay toward that hour's steady state) and the hour's mean is reported. The day runs twice so the
morning starts from the previous night's air. Because the equation is linear, the share of indoor
PM2.5 that came from outdoors is exact: the model is run again with S = 0.

## 3. Personal exposure and dose ([`exposure.ts`](../src/domain/exposure.ts))

Each member's 24 hours are split into slices: activities (possibly part of an hour), time away
indoors (office, school: 0.6 × outdoor) and time at home (indoor model). For each slice:

```
dose (µg) = concentration (µg/m³) × inhalation rate (m³/h) × time (h)
```

- **Inhalation rates** by age band and effort: US EPA *Exposure Factors Handbook* (2011),
  Table 6-2.
- **Travel modes** relative to background PM2.5: walk/cycle 1.3, two-wheeler 1.4, auto-rickshaw
  1.5, car windows open 1.1, car on recirculation 0.55, bus 1.1, metro 0.6 (midpoints from Goel et
  al. 2015, Kumar et al. 2018, de Nazelle et al. 2017).
- **N95 outdoors**: 70% real-world reduction (Cherrie et al. 2018).
- **Cigarette equivalent**: time-weighted mean exposure ÷ 22 µg/m³ (Berkeley Earth, Muller &
  Muller 2015). It makes a number relatable; it is not a clinical measure.

## 4. Routine planning ([`routine.ts`](../src/domain/routine.ts))

For each activity the household marked flexible, the engine tries every whole-hour start inside
its window, re-runs the whole household model, and keeps the start with the lowest total inhaled
PM2.5 (ties: nearest the usual time, then earliest). Moves are applied one after another in the
order the household listed them, so the result is deterministic. The airing suggestion is the
pair of consecutive daytime hours (07:00–21:00) with the lowest outdoor PM2.5.

## 5. Choices and impact ([`swaps.ts`](../src/domain/swaps.ts))

Every change in the catalog (cleaner travel mode per trip, purifier sized by AHAM's two-thirds
rule, exhaust fan, cleaner cooking fuel, electric heating, fewer heater hours, N95 outdoors, no
incense or smoking indoors, composting instead of burning) is measured the same way: **apply the
one change to the profile, re-run the same model, take the difference.** Reported per change:

- PM2.5 not breathed by the household, µg/day, and cigarette equivalents;
- CO2 per week, kg: DEFRA/DESNZ 2024 transport factors, ICCT for two-wheelers and autos, India's
  grid factor 0.716 kg/kWh (CEA v19, 2023), IPCC 2006 fuel factors, 30% non-renewable biomass
  (Bailis et al. 2015);
- PM2.5 kept out of the street from not burning waste: 9.8 g/kg (Akagi et al. 2011) × 2 kg/week.

Trade-offs are never netted away: a purifier or electric heater can mean cleaner lungs but more
CO2 on a coal-heavy grid, and Clearday shows both signs.

## 6. Health guidance ([`guidance.ts`](../src/domain/guidance.ts))

A rule table maps the day's NAQI category and whether a member is in a sensitive group (under 12,
over 60, asthma, heart or lung disease, pregnancy) to precautions, following the CPCB health
statements that accompany the NAQI. It never diagnoses; for symptoms it points to a doctor.

## 7. Data

- Live forecast: Open-Meteo Air Quality API (CAMS-based), hourly, 48 hours, the place's time zone.
  CO is converted from µg/m³ to the mg/m³ NAQI uses.
- When Open-Meteo is unreachable the app serves a clearly labelled **sample** forecast shaped like a
  Delhi winter smog day ([`server/sample-forecast.ts`](../server/sample-forecast.ts)).
