/**
 * Tests for saving the household on this device (src/features/household/storage.ts).
 * Does: round-trip a profile, discard anything that fails the schema, and survive a browser that
 * refuses storage in every way (missing, throwing, full).
 * Never does: touch a real `localStorage`; each test passes its own fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserStorage,
  loadProfile,
  saveProfile,
  STORAGE_KEY,
  type StorageLike,
} from '../../src/features/household/storage.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';

/** An in-memory store. */
function memory(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('household storage', () => {
  it('round-trips a profile under clearday.v1', () => {
    const store = memory();
    expect(STORAGE_KEY).toBe('clearday.v1');
    expect(saveProfile(SAMPLE_PROFILE, store)).toBe(true);
    expect(store.data.has('clearday.v1')).toBe(true);
    expect(loadProfile(store)).toEqual(SAMPLE_PROFILE);
  });

  it('loads nothing when nothing is saved', () => {
    expect(loadProfile(memory())).toBeNull();
    expect(loadProfile(null)).toBeNull();
  });

  it('discards a profile that fails validation, and unparseable text', () => {
    const invalid = memory({ [STORAGE_KEY]: JSON.stringify({ ...SAMPLE_PROFILE, members: [] }) });
    expect(loadProfile(invalid)).toBeNull();
    expect(invalid.data.has(STORAGE_KEY)).toBe(false);
    expect(loadProfile(memory({ [STORAGE_KEY]: '{not json' }))).toBeNull();
  });

  it('never throws when the browser refuses storage', () => {
    expect(loadProfile(throwing)).toBeNull();
    expect(saveProfile(SAMPLE_PROFILE, throwing)).toBe(false);
    expect(saveProfile(SAMPLE_PROFILE, null)).toBe(false);
  });

  it('finds localStorage, or null when touching it throws', () => {
    vi.stubGlobal('window', { localStorage: memory() });
    expect(browserStorage()).not.toBeNull();
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('denied');
      },
    });
    expect(browserStorage()).toBeNull();
  });
});
