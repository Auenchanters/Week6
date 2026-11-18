/**
 * The application shell: skip link, brand header and the single `<main>`.
 * Does: render the page frame at once and load the workspace (household form and dashboard, with
 * zod and the engine) on demand, so the first paint stays small.
 * Never does: import the engine, schemas or the API client (they would break the entry-size budget
 * in `scripts/bundle-budget.ts`), call the AI, or render a second `<main>` or `<h1>`.
 */
import { lazy, Suspense, type ReactElement } from 'react';

const Workspace = lazy(() => import('./features/household/workspace.js'));

/** The application shell. */
export function App(): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <p className="brand">
          <span className="brand__name">Clearday</span>
          <span className="brand__tagline">Cleaner air choices for your family</span>
        </p>
      </header>
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<p role="status">Loading Clearday…</p>}>
          <Workspace />
        </Suspense>
      </main>
      <footer className="site-footer">
        <p>
          Clearday gives estimates for a typical home, not medical advice. Air data: Open-Meteo.
          Your household stays on this device; only the AI buttons send it to be answered.
        </p>
      </footer>
    </>
  );
}
