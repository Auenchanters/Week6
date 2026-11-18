/**
 * The page behind the shell: the household form, a wait for the air forecast, or the dashboard.
 * Does: pick the view from the household state, load the dashboard code only when a plan exists
 * (so the first page stays small), show the forecast error with a retry, and move keyboard focus to
 * the main region whenever the view changes.
 * Never does: call the AI, or build the plan (`useHousehold` does).
 */
import { lazy, Suspense, useEffect, useRef, type ReactElement } from 'react';
import { SetupPage } from '../setup/setup-page.js';
import { useHousehold } from './use-household.js';

const Dashboard = lazy(() => import('../dashboard/dashboard.js'));

/** Moves focus to `<main>` when `view` changes, but not on the first render. */
function useFocusOnViewChange(view: string): void {
  const previous = useRef(view);
  useEffect(() => {
    if (previous.current === view) return;
    previous.current = view;
    document.getElementById('main')?.focus();
  }, [view]);
}

/** The household form, the wait, or the dashboard. */
export default function Workspace(): ReactElement {
  const household = useHousehold();
  const { profile, forecast, plan, editing } = household;
  let view = 'dashboard';
  if (!profile || editing) view = 'setup';
  else if (!plan) view = household.error ? 'error' : 'loading';
  useFocusOnViewChange(view);

  if (!profile || editing)
    return (
      <SetupPage
        saved={profile}
        editing={editing}
        onSave={household.save}
        onCancel={household.closeEditor}
      />
    );
  if (!plan || !forecast)
    return (
      <section aria-labelledby="wait-title" className="wait">
        <h1 id="wait-title">{profile.place.name}</h1>
        {household.error ? (
          <div role="alert">
            <p>{household.error}</p>
            <div className="actions">
              <button type="button" className="btn btn--primary" onClick={household.retry}>
                Try again
              </button>
              <button type="button" className="btn" onClick={household.edit}>
                Edit household
              </button>
            </div>
          </div>
        ) : (
          <p role="status">Loading the air forecast for {profile.place.name}…</p>
        )}
      </section>
    );
  return (
    <Suspense fallback={<p role="status">Preparing your plan…</p>}>
      <Dashboard
        profile={profile}
        forecast={forecast}
        plan={plan}
        onDay={household.setDayIndex}
        onEdit={household.edit}
        onSave={household.save}
      />
    </Suspense>
  );
}
