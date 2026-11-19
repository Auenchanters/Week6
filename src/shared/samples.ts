/**
 * The sample household, so anyone can see a full plan in one click: a Delhi family of four with a
 * pregnant parent, a child with asthma and a grandparent with a heart condition, living through a
 * smog week with a coal heater, incense, a car commute and an auto-rickshaw school run.
 * Never does: describe a real family; names and habits are illustrative.
 */
import type { Profile } from './schema.js';

/**
 * A Delhi family of four with a pregnant parent, a child with asthma and a grandparent with a
 * heart-lung condition: the sample that shows every kind of guidance.
 */
export const SAMPLE_PROFILE: Profile = {
  place: { name: 'New Delhi, India', latitude: 28.61, longitude: 77.21 },
  language: 'en',
  members: [
    { id: 'ravi', name: 'Ravi', age: 'adult', conditions: [], away: { from: 10, to: 18 } },
    { id: 'asha', name: 'Asha', age: 'adult', conditions: ['pregnant'], away: null },
    { id: 'kabir', name: 'Kabir', age: 'child', conditions: ['asthma'], away: { from: 8, to: 14 } },
    { id: 'nani', name: 'Nani', age: 'senior', conditions: ['heart-lung'], away: null },
  ],
  home: {
    areaM2: 75,
    tightness: 'leaky',
    cookingFuel: 'lpg',
    heater: 'coal-wood',
    heaterHours: 4,
    purifier: 'none',
    windows: 'morning',
    exhaustFan: false,
    incense: true,
    smokingIndoors: false,
    burnsWaste: true,
    n95Outdoors: false,
  },
  activities: [
    {
      id: 'ravi-to-work',
      kind: 'commute',
      memberIds: ['ravi'],
      startHour: 9,
      durationMinutes: 50,
      mode: 'car-windows-open',
      distanceKm: 14,
      daysPerWeek: 5,
      window: null,
    },
    {
      id: 'ravi-to-home',
      kind: 'commute',
      memberIds: ['ravi'],
      startHour: 18,
      durationMinutes: 50,
      mode: 'car-windows-open',
      distanceKm: 14,
      daysPerWeek: 5,
      window: null,
    },
    {
      id: 'school-run',
      kind: 'school-run',
      memberIds: ['kabir', 'asha'],
      startHour: 7,
      durationMinutes: 25,
      mode: 'auto-rickshaw',
      distanceKm: 3,
      daysPerWeek: 6,
      window: null,
    },
    {
      id: 'nani-walk',
      kind: 'walk',
      memberIds: ['nani'],
      startHour: 7,
      durationMinutes: 45,
      mode: 'walk',
      distanceKm: 0,
      daysPerWeek: 7,
      window: { earliest: 6, latest: 17 },
    },
    {
      id: 'kabir-play',
      kind: 'play',
      memberIds: ['kabir'],
      startHour: 17,
      durationMinutes: 60,
      mode: 'walk',
      distanceKm: 0,
      daysPerWeek: 7,
      window: { earliest: 14, latest: 18 },
    },
  ],
};
