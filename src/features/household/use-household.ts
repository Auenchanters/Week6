/**
 * The household's state: who they are, the air forecast for their place, which day is shown, and
 * the day plan the engine builds from those.
 * Does: load the saved profile, save every accepted change, fetch the forecast whenever the place
 * changes (aborting a stale request), and rebuild the plan with `useMemo`; any edit to the
 * household recomputes the plan locally.
 * Never does: call the AI; that is the dashboard's explicit, one-click action.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildDayPlan, type DayIndex, type DayPlan } from '../../domain/plan.js';
import type { Forecast, Profile } from '../../shared/schema.js';
import { fetchForecast } from '../client/api.js';
import { loadProfile, saveProfile } from './storage.js';

/** A forecast, or the reason there is none, for one place. */
interface Fetched {
  readonly key: string;
  readonly forecast: Forecast | null;
  readonly error: string;
}

export interface Household {
  readonly profile: Profile | null;
  readonly forecast: Forecast | null;
  readonly plan: DayPlan | null;
  readonly dayIndex: DayIndex;
  /** The setup form is open, whether or not a household is saved. */
  readonly editing: boolean;
  readonly loading: boolean;
  /** Why the forecast could not be loaded; empty when it can. */
  readonly error: string;
  readonly setDayIndex: (day: DayIndex) => void;
  /** Save a household and show its dashboard. */
  readonly save: (profile: Profile) => void;
  readonly edit: () => void;
  readonly closeEditor: () => void;
  readonly retry: () => void;
}

/** The household state for the whole page. */
export function useHousehold(): Household {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [dayIndex, setDayIndex] = useState<DayIndex>(0);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latitude = profile?.place.latitude;
  const longitude = profile?.place.longitude;
  const key = `${latitude},${longitude}`;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) return;
    const controller = new AbortController();
    void fetchForecast(latitude, longitude, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setFetched(
        result.ok
          ? { key, forecast: result.value, error: '' }
          : { key, forecast: null, error: result.error.message },
      );
    });
    return () => {
      controller.abort();
    };
  }, [latitude, longitude, key, attempt]);

  const current = fetched?.key === key ? fetched : null;
  const forecast = current?.forecast ?? null;
  const plan = useMemo(
    () => (profile && forecast ? buildDayPlan(profile, forecast, dayIndex) : null),
    [profile, forecast, dayIndex],
  );

  const save = useCallback((next: Profile) => {
    saveProfile(next);
    setProfile(next);
    setEditing(false);
  }, []);
  const retry = useCallback(() => {
    setFetched(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    profile,
    forecast,
    plan,
    dayIndex,
    editing,
    loading: profile !== null && current === null,
    error: current?.error ?? '',
    setDayIndex,
    save,
    edit: () => {
      setEditing(true);
    },
    closeEditor: () => {
      setEditing(false);
    },
    retry,
  };
}
