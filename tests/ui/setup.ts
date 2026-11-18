/**
 * Setup for the jsdom UI tests: unmount whatever a test rendered, undo stubbed globals (`fetch`),
 * empty browser storage so tests never share a household, and give async queries (`findBy*`,
 * `waitFor`) five seconds instead of one, since a plan renders a few hundred elements and the
 * first render after a lazy import can pass the one-second default.
 * Never does: add globals or matchers; tests import what they use.
 */
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

configure({ asyncUtilTimeout: 5000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
