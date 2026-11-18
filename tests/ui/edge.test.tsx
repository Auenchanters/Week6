/**
 * UI tests for the corners: a household with nothing left to change, every home control of the
 * what-if, requests that finish after the page has moved on, and blank names in the form.
 * Never does: reach the network.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { ADVICE, FORECAST, json, META, stubApi } from '../support/api.js';

/** A promise a test settles by hand. */
function gate(): { promise: Promise<Response>; open: (response: Response) => void } {
  let open: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** A household with every protection in place and nothing to change. */
const SETTLED = {
  place: { name: 'Pune', latitude: 18.5, longitude: 73.8 },
  language: 'en',
  members: [{ id: 'm1', name: 'Mira', age: 'adult', conditions: [], away: null }],
  home: {
    ...SAMPLE_PROFILE.home,
    cookingFuel: 'induction',
    heater: 'none',
    heaterHours: 0,
    purifier: 'large',
    exhaustFan: true,
    incense: false,
    burnsWaste: false,
    n95Outdoors: true,
  },
  activities: [],
};

describe('a household with nothing left to change', () => {
  it('says so in the hero and the ledger is empty', async () => {
    stubApi();
    localStorage.setItem('clearday.v1', JSON.stringify(SETTLED));
    render(<App />);
    expect(await screen.findByText(/already keeps exposure/u)).toBeTruthy();
    expect(screen.getByText('0 choices shown.')).toBeTruthy();
  });
});

describe('the what-if controls', () => {
  it('reacts to every home setting', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    await screen.findByRole('heading', { level: 2, name: /^Today's air/u });
    await user.selectOptions(
      screen.getByLabelText('Windows', { selector: '#wi-windows' }),
      'closed',
    );
    await user.selectOptions(
      screen.getByLabelText('Cooking fuel', { selector: '#wi-cookingFuel' }),
      'induction',
    );
    await user.selectOptions(
      screen.getByLabelText('Heater', { selector: '#wi-heater' }),
      'electric',
    );
    await user.click(
      screen.getByLabelText('Kitchen exhaust fan while cooking', { selector: '#wi-exhaustFan' }),
    );
    expect((await screen.findAllByText(/than now/u)).length).toBe(2);
  });
});

describe('requests that finish after the person has moved on', () => {
  it('ignores a forecast that arrives after leaving', async () => {
    const forecast = gate();
    stubApi({ '/api/air': () => forecast.promise });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    await screen.findByText(/Loading the air forecast/u);
    cleanup();
    forecast.open(Response.json(FORECAST));
    await waitFor(() => {
      expect(document.body.textContent).toBe('');
    });
  });

  it('ignores advice and answers that arrive after the page is gone', async () => {
    const advice = gate();
    const answer = gate();
    stubApi({ '/api/plan': () => advice.promise, '/api/ask': () => answer.promise });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    await screen.findByRole('heading', { level: 2, name: /^Today's air/u });
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    await user.type(screen.getByLabelText('Your question about this day'), 'Is it safe?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    cleanup();
    advice.open(Response.json({ advice: ADVICE, meta: META }));
    answer.open(Response.json({ answer: { answer: 'Yes.', cites: [] }, meta: META }));
    await waitFor(() => {
      expect(document.body.textContent).toBe('');
    });
  });

  it('replaces a slow place search with the newer one', async () => {
    const slow = gate();
    let calls = 0;
    stubApi({
      '/api/places': () => {
        calls += 1;
        return calls === 1 ? slow.promise : json({ places: [] });
      },
    });
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByLabelText('Where do you live?');
    await user.type(box, 'New');
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    await user.type(box, 'x');
    expect(await screen.findByText('No places found.')).toBeTruthy();
    slow.open(Response.json({ places: [{ name: 'Old result', latitude: 1, longitude: 2 }] }));
    await user.tab();
    expect(screen.queryByText('Old result')).toBeNull();
  });
});

describe('blank names and the away toggle', () => {
  it('labels an unnamed person by id and lets the away hours be switched off again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Add a person' }));
    await user.click(screen.getAllByLabelText(/Away from home for part/u)[1] ?? document.body);
    await user.click(screen.getAllByLabelText(/Away from home for part/u)[1] ?? document.body);
    expect(screen.queryByLabelText(/Leaves at/u)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add an outing' }));
    await user.click(screen.getByLabelText(/Flexible: it could/u));
    await user.click(screen.getByLabelText(/Flexible: it could/u));
    expect(screen.queryByLabelText('and (hour)')).toBeNull();
    expect(screen.getByLabelText('m1')).toBeTruthy();
    expect(screen.getByLabelText('m2')).toBeTruthy();
  });
});

describe('the choices ledger wording', () => {
  it('shows small lung gains without a cigarette figure, and no change as no change', async () => {
    const { Ledger } = await import('../../src/features/dashboard/ledger.js');
    const { buildDayPlan } = await import('../../src/domain/plan.js');
    const { sampleForecast } = await import('../../server/sample-forecast.js');
    const plan = buildDayPlan(SAMPLE_PROFILE, sampleForecast('2026-11-18', '2026-11-19'), 0);
    const base = plan.swaps[0];
    if (!base) throw new Error('the sample plan has swaps');
    const swaps = [
      { ...base, id: 'tiny', doseSavedUg: 5, cigarettesSaved: 0.01 },
      { ...base, id: 'none', doseSavedUg: 0.2, cigarettesSaved: 0 },
    ];
    render(<Ledger plan={{ ...plan, swaps }} members={SAMPLE_PROFILE.members} />);
    expect(screen.getByText('Lungs: 5 µg less a day')).toBeTruthy();
    expect(screen.getByText('Lungs: no measurable change')).toBeTruthy();
    cleanup();
  });
});
