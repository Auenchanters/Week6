/**
 * Keeps the household on this device, and only on this device.
 * Does: save the profile as JSON under `clearday.v1`, and load it back only if it still passes
 * `profileSchema` (anything else is discarded); every storage access is guarded, because browsers
 * may refuse it (private modes, blocked site data, full quota).
 * Never does: send the profile anywhere, throw, or keep an invalid value.
 */
import { profileSchema, type Profile } from '../../shared/schema.js';

/** The localStorage key; the version suffix changes when the stored shape does. */
export const STORAGE_KEY = 'clearday.v1';

/** The two `Storage` methods used here, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage`, or `null` when the browser forbids touching it. */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved household, or `null` when there is none or it is unreadable or invalid. */
export function loadProfile(storage: StorageLike | null = browserStorage()): Profile | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Unparseable JSON or a throwing store: start fresh.
  }
  return null;
}

/** Saves the household; returns whether the browser accepted it. */
export function saveProfile(
  profile: Profile,
  storage: StorageLike | null = browserStorage(),
): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(profile));
    return storage !== null;
  } catch {
    return false;
  }
}
