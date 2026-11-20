/**
 * UI tests for the dashboard, from the sample family's click to the AI panels.
 * Does: render the whole `App` with a fake API, then check what a person sees and which requests
 * were sent: the air and the people, the day switch, the what-if (no network), the ledger's sort
 * and filter, advice and questions with their cited facts, failures, and the AI-at-work panel.
 * Never does: reach the network or a real model.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app.js';
import { ADVICE, bodyOf, json, META, paths, stubApi, urlOf } from '../support/api.js';

/** Renders the app and opens the sample family's dashboard. */
async function openSample(): Promise<ReturnType<typeof userEvent.setup>> {
  if (!vi.isMockFunction(fetch)) stubApi();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
  await screen.findByRole('heading', { level: 2, name: /^Today's air/u });
  return user;
}

describe('the sample family', () => {
  it('shows the air, the people and no AI call', async () => {
    const fake = stubApi();
    await openSample();
    expect(screen.getAllByText('India AQI').length).toBeGreaterThan(0);
    expect(screen.getByText('Sample data')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: /^Today's air is like smoking/u }),
    ).toBeTruthy();
    for (const name of ['Ravi', 'Asha', 'Kabir', 'Nani'])
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(paths(fake)).toEqual(['/api/air']);
  });

  it('describes the ribbon in words and offers the hourly table', async () => {
    await openSample();
    const ribbon = screen.getByRole('img', { name: /^Hourly PM2.5 for 2026-11-18/u });
    expect(ribbon).toBeTruthy();
    const table = screen.getByRole('table', { name: /Outdoor air by hour/u });
    expect(within(table).getAllByRole('row')).toHaveLength(25);
  });

  it('re-plans the day with moves and an airing time', async () => {
    await openSample();
    expect(screen.getByText(/Nani's walk/u)).toBeTruthy();
    expect(screen.getByText(/Open the windows at/u)).toBeTruthy();
  });

  it('switches between Today and Tomorrow', async () => {
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(screen.getByRole('button', { name: 'Tomorrow' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { level: 2, name: /^Tomorrow's air/u })).toBeTruthy();
    expect(screen.getByText('Thu, 19 Nov')).toBeTruthy();
  });

  it('restores the saved household on the next visit without asking again', async () => {
    await openSample();
    cleanup();
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'New Delhi, India' })).toBeTruthy();
  });
});

describe('the home air what-if', () => {
  it('changes the indoor number with no request, and keeps or resets the draft', async () => {
    const fake = stubApi();
    const user = await openSample();
    const calls = fake.mock.calls.length;
    const keep = screen.getByRole('button', { name: 'Keep these changes' });
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(keep).toHaveProperty('disabled', true);

    await user.selectOptions(
      screen.getByLabelText('Air purifier', { selector: '#wi-purifier' }),
      'large',
    );
    expect(await screen.findByText(/lower than now/u)).toBeTruthy();
    expect(keep).toHaveProperty('disabled', false);
    expect(fake.mock.calls.length).toBe(calls);

    await user.click(reset);
    expect(screen.queryByText(/than now/u)).toBeNull();

    await user.selectOptions(
      screen.getByLabelText('Air purifier', { selector: '#wi-purifier' }),
      'large',
    );
    await user.click(
      screen.getByLabelText('Incense or dhoop indoors', { selector: '#wi-incense' }),
    );
    await user.click(screen.getByRole('button', { name: 'Keep these changes' }));
    await waitFor(() => {
      expect(localStorage.getItem('clearday.v1')).toContain('"purifier":"large"');
    });
    expect(screen.queryByText(/than now/u)).toBeNull();
  });

  it('says so when a change makes the air worse', async () => {
    const user = await openSample();
    await user.clear(screen.getByLabelText('Heater hours a day', { selector: '#wi-heaterHours' }));
    await user.type(
      screen.getByLabelText('Heater hours a day', { selector: '#wi-heaterHours' }),
      '12',
    );
    expect(await screen.findByText(/higher than now/u)).toBeTruthy();
  });
});

describe('the choices ledger', () => {
  it('sorts by lungs or climate and filters by kind of change', async () => {
    const user = await openSample();
    const titles = (): string[] =>
      within(screen.getByRole('region', { name: 'Choices and their impact' }))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
    const byLungs = titles();
    expect(byLungs.length).toBeGreaterThan(3);

    await user.selectOptions(screen.getByLabelText('Sort by'), 'climate');
    expect(titles()).not.toEqual(byLungs);
    expect(titles().sort()).toEqual([...byLungs].sort());

    const all = titles().length;
    await user.click(screen.getByRole('button', { name: 'Cooking' }));
    expect(titles().length).toBeLessThan(all);
    expect(screen.getByRole('button', { name: 'Cooking' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText(/choices? shown/u).textContent).toContain(String(titles().length));

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(titles()).toHaveLength(all);
  });

  it('shows extra CO2 in a warning tone and explains the units', async () => {
    await openSample();
    expect(document.querySelector('.ledger .warn')).not.toBeNull();
    expect(screen.getAllByText(/not medical advice/u).length).toBeGreaterThan(1);
  });
});

describe('personal advice', () => {
  it('makes one call, labels the AI text and reveals the cited fact', async () => {
    const fake = stubApi();
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    expect(await screen.findByText(ADVICE.summary, { selector: '.advice__summary' })).toBeTruthy();
    const plans = fake.mock.calls.filter(([url]) => urlOf(url) === '/api/plan');
    expect(plans).toHaveLength(1);
    const init = plans[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(bodyOf(init)).toMatchObject({ dayIndex: 0 });
    expect(screen.getAllByText('AI · personalized').length).toBeGreaterThan(1);
    expect(screen.getByText('Routine')).toBeTruthy();
    expect(screen.getByText('Indoor hacks')).toBeTruthy();
    expect(screen.queryByText('Sustainable alternatives')).toBeNull();

    const chip = screen.getAllByRole('button', { name: /^Fact \d+$/u })[0];
    if (!chip) throw new Error('no fact chip');
    await user.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.cites__fact')?.textContent).toContain('Cleanest daytime hours');
    await user.click(chip);
    expect(document.querySelector('.cites__fact')).toBeNull();

    await user.click(screen.getByText('See exactly what the AI is told'));
    expect(screen.getByText('gemini-test')).toBeTruthy();
  });

  it('disables the button while the call runs', async () => {
    let finish: (r: Response) => void = () => undefined;
    stubApi({
      '/api/plan': () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    expect(screen.getByRole('button', { name: 'Getting advice…' })).toHaveProperty(
      'disabled',
      true,
    );
    finish(Response.json({ advice: ADVICE, meta: META }));
    expect(await screen.findByText(ADVICE.summary, { selector: '.advice__summary' })).toBeTruthy();
  });

  it('shows the API message when the AI is not configured', async () => {
    stubApi({
      '/api/plan': () =>
        json(
          { error: { code: 'AI_NOT_CONFIGURED', message: 'AI advice is not set up yet.' } },
          503,
        ),
    });
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    expect(await screen.findByText('AI advice is not set up yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get personal advice' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('hides advice once the plan changes, and changing language saves it', async () => {
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    await screen.findByText(ADVICE.summary, { selector: '.advice__summary' });
    await user.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(screen.queryByText(ADVICE.summary, { selector: '.advice__summary' })).toBeNull();
    expect(localStorage.getItem('clearday.v1')).toContain('"language":"hi"');
  });

  it('shows the AI summary in the hero with its language', async () => {
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Get personal advice' }));
    const summary = await screen.findAllByText(ADVICE.summary);
    expect(summary.length).toBeGreaterThan(1);
    expect(document.querySelector('.hero__text p[lang="en"]')).not.toBeNull();
  });
});

describe('Ask Clearday', () => {
  it('fills the box from a suggestion, sends the question and shows the answer', async () => {
    const fake = stubApi();
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: "Is 17:00 OK for Kabir's outdoor play?" }));
    const box = screen.getByLabelText('Your question about this day');
    expect(box).toHaveProperty('value', "Is 17:00 OK for Kabir's outdoor play?");
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Yes, late afternoon is fine.')).toBeTruthy();
    expect(bodyOf(fake.mock.calls.find(([u]) => urlOf(u) === '/api/ask')?.[1])).toMatchObject({
      question: "Is 17:00 OK for Kabir's outdoor play?",
    });
    expect(box).toHaveProperty('value', '');
    expect(screen.getByRole('button', { name: /^Fact \d+$/u })).toBeTruthy();

    await user.type(box, 'Another one?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => {
      expect(screen.getAllByText('Yes, late afternoon is fine.')).toHaveLength(2);
    });
  });

  it('ignores an empty question and reports a failed one', async () => {
    stubApi({
      '/api/ask': () => json({ error: { code: 'AI_BUSY', message: 'The AI is busy.' } }, 503),
    });
    const user = await openSample();
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.queryByText('You asked:')).toBeNull();
    await user.type(screen.getByLabelText('Your question about this day'), 'Is it safe?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('The AI is busy.')).toBeTruthy();
  });

  it('suggests a general question when there are no outings', async () => {
    stubApi();
    localStorage.setItem(
      'clearday.v1',
      JSON.stringify({
        place: { name: 'Pune', latitude: 18.5, longitude: 73.8 },
        language: 'en',
        members: [{ id: 'm1', name: 'Mira', age: 'adult', conditions: [], away: null }],
        home: {
          areaM2: 50,
          tightness: 'average',
          cookingFuel: 'induction',
          heater: 'none',
          heaterHours: 0,
          purifier: 'none',
          windows: 'closed',
          exhaustFan: false,
          incense: false,
          smokingIndoors: false,
          burnsWaste: false,
          n95Outdoors: false,
        },
        activities: [],
      }),
    );
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Is it safe for Mira to go outside today?' }),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing to move today/u)).toBeTruthy();
  });
});

describe('AI at work', () => {
  it('shows the instruction and data with focusable text and no call yet', async () => {
    await openSample();
    const system = screen.getByText(/You are Clearday/u);
    expect(system.tagName).toBe('PRE');
    expect(system.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText(/"language":"English"/u).getAttribute('tabindex')).toBe('0');
    expect(screen.getByText(/No AI call yet/u)).toBeTruthy();
  });
});

describe('when the forecast fails', () => {
  it('explains, retries, and lets the person edit the household', async () => {
    let ok = false;
    stubApi({
      '/api/air': () =>
        ok ? json(sampleOk()) : json({ error: { code: 'X', message: 'No forecast.' } }, 502),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    expect(await screen.findByText('No forecast.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit household' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Edit your household' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    ok = true;
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: /^Today's air/u })).toBeTruthy();
  });

  it('names a live source and says when its data was fetched', async () => {
    const fetchedAt = '2026-11-18T08:35:00.000Z';
    stubApi({ '/api/air': () => json({ ...sampleOkObject(), fetchedAt }) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    expect(await screen.findByText('Live · Open-Meteo (CAMS)')).toBeTruthy();
    const stamp = screen.getByText(/^\d{2}:\d{2}$/u, { selector: 'time' });
    expect(stamp.getAttribute('datetime')).toBe(fetchedAt);
    expect(stamp.parentElement?.textContent).toMatch(/^Updated /u);
  });

  it('shows a loading line while the forecast is on its way', async () => {
    stubApi({ '/api/air': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'See the sample family' }));
    expect(await screen.findByText(/Loading the air forecast/u)).toBeTruthy();
  });
});

/** The sample forecast, imported lazily so the failing-route test reads top to bottom. */
function sampleOk(): unknown {
  return sampleOkObject();
}

/** A live-labelled 48-hour forecast. */
function sampleOkObject(): Record<string, unknown> {
  return {
    source: 'open-meteo',
    timezone: 'Asia/Kolkata',
    hours: Array.from({ length: 48 }, (_, i) => ({
      time: `2026-11-${i < 24 ? '18' : '19'}T${String(i % 24).padStart(2, '0')}:00`,
      pm25: 60 + (i % 24) * 3,
      pm10: 90,
      no2: 30,
      o3: 20,
      co: 1,
      so2: 10,
    })),
  };
}
