/**
 * UI tests for the landing and the household form.
 * Does: check validation (an error summary whose links focus the field), the place search (debounce,
 * minimum length, keyboard and mouse picking, failures), every editor of the form, and the way a
 * valid household reaches the dashboard and back into the form for editing.
 * Never does: reach the network.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app.js';
import { json, paths, stubApi } from '../support/api.js';

/** Renders the app on the landing page. */
async function openLanding(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Breathe easier through smog season' });
  return user;
}

describe('validation', () => {
  it('lists every problem and moves focus to the field from its link', async () => {
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'Show my plan' }));
    const summary = await screen.findByRole('alert');
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getByRole('heading', { level: 2 }).textContent).toMatch(
      /things? to fix/u,
    );
    const link = within(summary).getByRole('link', { name: /Search for your place/u });
    await user.click(link);
    expect(document.activeElement).toBe(screen.getByLabelText('Where do you live?'));
    expect(screen.getByLabelText('Where do you live?').getAttribute('aria-invalid')).toBe('true');
    expect(within(summary).getByRole('link', { name: /Enter a name/u })).toBeTruthy();
  });

  it('points at the right field for every kind of mistake', async () => {
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'Use sample: New Delhi' }));
    await user.type(screen.getAllByLabelText('Name')[0] ?? document.body, 'Mira');
    await user.click(screen.getByLabelText(/Away from home for part/u));
    await user.clear(screen.getByLabelText(/Leaves at/u));
    await user.type(screen.getByLabelText(/Leaves at/u), '20');
    await user.clear(screen.getByLabelText('Floor area (m²)'));
    await user.clear(screen.getByLabelText('Heater hours a day'));
    await user.click(screen.getByRole('button', { name: 'Add an outing' }));
    await user.click(screen.getByLabelText('Mira'));
    await user.clear(screen.getByLabelText('Minutes'));
    await user.clear(screen.getByLabelText('One-way distance (km)'));
    await user.clear(screen.getByLabelText('Days a week'));
    await user.clear(screen.getByLabelText(/Starts at/u));
    await user.click(screen.getByRole('button', { name: 'Show my plan' }));
    const summary = await screen.findByRole('alert');
    for (const text of [
      /Enter the floor area/u,
      /Enter whole hours from 0 to 16/u,
      /Pick at least one person/u,
      /Enter whole minutes/u,
      /Enter a distance/u,
      /Enter whole days/u,
      /Enter an hour from 0 to 23\./u,
      /Enter hours from 0 to 24/u,
    ])
      expect(within(summary).getByRole('link', { name: text })).toBeTruthy();

    await user.click(within(summary).getByRole('link', { name: /Pick at least one person/u }));
    expect(document.activeElement?.closest('fieldset')?.id).toContain('memberIds');
    await user.click(within(summary).getByRole('link', { name: /Enter hours from 0 to 24/u }));
    expect(document.activeElement?.id).toBe('f-members-0-away-from');
  });

  it('flags a flexible window that runs backwards', async () => {
    stubApi();
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'See the sample family' }));
    await screen.findByRole('heading', { level: 2, name: /^Today's air/u });
    await user.click(screen.getByRole('button', { name: 'Edit household' }));
    const earliest = screen.getAllByLabelText('Flexible between (hour)')[0] ?? document.body;
    await user.clear(earliest);
    await user.type(earliest, '20');
    await user.click(screen.getByRole('button', { name: 'Save household' }));
    const link = await screen.findByRole('link', { name: /earliest hour must not be after/u });
    await user.click(link);
    expect(document.activeElement?.id).toMatch(/-earliest$/u);
  });

  it('says there is one thing to fix when there is one', async () => {
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'Use sample: New Delhi' }));
    await user.click(screen.getByRole('button', { name: 'Show my plan' }));
    expect(await screen.findByText('There is 1 thing to fix')).toBeTruthy();
  });
});

describe('place search', () => {
  it('waits for the typing to stop, needs two letters and cancels stale searches', async () => {
    const fake = stubApi();
    const user = await openLanding();
    const box = screen.getByLabelText('Where do you live?');
    await user.type(box, 'N');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(paths(fake)).not.toContain('/api/places');
    await user.type(box, 'ew');
    expect(paths(fake)).not.toContain('/api/places');
    const list = await screen.findByRole('listbox', { name: 'Matching places' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    expect(paths(fake).filter((p) => p === '/api/places')).toHaveLength(1);
    expect(screen.getByText(/2 places found/u)).toBeTruthy();
    expect(box.getAttribute('aria-expanded')).toBe('true');
  });

  it('picks with the keyboard', async () => {
    stubApi();
    const user = await openLanding();
    const box = screen.getByLabelText('Where do you live?');
    await user.type(box, 'New');
    await screen.findByRole('option', { name: 'New Town, India' });
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('option', { name: 'New Town, India' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe('f-place-opt-1');
    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
    expect(screen.getByText('New Town, India', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Matching places' })).toBeNull();
  });

  it('picks with the mouse, closes on Escape', async () => {
    stubApi();
    const user = await openLanding();
    const box = screen.getByLabelText('Where do you live?');
    await user.type(box, 'New');
    await screen.findByRole('option', { name: 'New Delhi, India' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Matching places' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'New Delhi, India' }));
    expect(screen.getByText('New Delhi, India', { selector: 'strong' })).toBeTruthy();
    await user.click(box);
    await user.keyboard('{x}');
    expect(screen.queryByRole('listbox', { name: 'Matching places' })).toBeNull();
  });

  it('reports no matches and a failed search', async () => {
    stubApi({ '/api/places': () => json({ places: [] }) });
    const user = await openLanding();
    await user.type(screen.getByLabelText('Where do you live?'), 'Zzzz');
    expect(await screen.findByText('No places found.')).toBeTruthy();
    stubApi({
      '/api/places': () =>
        json({ error: { code: 'PLACES_UNAVAILABLE', message: 'Search is down.' } }, 502),
    });
    await user.type(screen.getByLabelText('Where do you live?'), 'y');
    expect(await screen.findByText('Search is down.')).toBeTruthy();
  });

  it('shortens a very long place name to what the profile allows', async () => {
    const long = `${'A'.repeat(100)}, India`;
    stubApi({ '/api/places': () => json({ places: [{ name: long, latitude: 1, longitude: 2 }] }) });
    const user = await openLanding();
    await user.type(screen.getByLabelText('Where do you live?'), 'Aaa');
    await user.click(within(await screen.findByRole('listbox')).getByRole('option'));
    expect(screen.getByText('A'.repeat(80), { selector: 'strong' })).toBeTruthy();
  });
});

describe('the household form', () => {
  it('builds a household from scratch and shows its dashboard', async () => {
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'Use sample: New Delhi' }));
    await user.type(screen.getAllByLabelText('Name')[0] ?? document.body, 'Mira');
    await user.selectOptions(screen.getAllByLabelText('Age')[0] ?? document.body, 'senior');
    await user.click(screen.getByLabelText('Asthma'));
    await user.click(screen.getByLabelText('Asthma'));
    await user.click(screen.getByLabelText('Pregnant'));

    await user.click(screen.getByRole('button', { name: 'Add a person' }));
    await user.type(screen.getAllByLabelText('Name')[1] ?? document.body, 'Tara');
    await user.click(screen.getAllByLabelText(/Away from home for part/u)[1] ?? document.body);
    await user.clear(screen.getByLabelText(/Back at/u));
    await user.type(screen.getByLabelText(/Back at/u), '15');
    await user.clear(screen.getByLabelText(/Leaves at/u));
    await user.type(screen.getByLabelText(/Leaves at/u), '8');
    await user.click(screen.getByRole('button', { name: 'Add a person' }));
    await user.click(screen.getByRole('button', { name: 'Remove person 3' }));
    expect(screen.queryByText('Person 3')).toBeNull();

    await user.clear(screen.getByLabelText('Floor area (m²)'));
    await user.type(screen.getByLabelText('Floor area (m²)'), '80');
    await user.selectOptions(screen.getByLabelText('How air-tight is it?'), 'tight');
    await user.selectOptions(screen.getByLabelText('Cooking fuel'), 'induction');
    await user.click(screen.getByLabelText('Someone smokes indoors'));
    await user.click(screen.getByLabelText(/Garden or kitchen waste/u));
    await user.click(screen.getByLabelText(/fitted N95 mask outdoors/u));

    await user.click(screen.getByRole('button', { name: 'Add an outing' }));
    await user.selectOptions(screen.getByLabelText('What is it?'), 'commute');
    await user.selectOptions(screen.getByLabelText('How do they get there?'), 'metro');
    await user.click(screen.getByLabelText('Tara'));
    await user.click(screen.getByLabelText('Tara'));
    await user.type(screen.getByLabelText('One-way distance (km)'), '9');
    await user.click(screen.getByLabelText(/Flexible: it could/u));
    await user.clear(screen.getByLabelText('and (hour)'));
    await user.type(screen.getByLabelText('and (hour)'), '19');
    await user.click(screen.getByRole('button', { name: 'Add an outing' }));
    await user.click(screen.getByRole('button', { name: 'Remove walk 2' }));
    await user.selectOptions(screen.getByLabelText('Language for AI advice'), 'ta');
    stubApi();
    await user.click(screen.getByRole('button', { name: 'Show my plan' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: /^Today's air is like smoking/u }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Tara' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('clearday.v1') ?? '{}')).toMatchObject({
      language: 'ta',
    });
  });

  it('removes a person from the outings they were on', async () => {
    stubApi();
    const user = await openLanding();
    await user.click(screen.getByRole('button', { name: 'See the sample family' }));
    await screen.findByRole('heading', { level: 2, name: /^Today's air/u });
    await user.click(screen.getByRole('button', { name: 'Edit household' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Edit your household' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See the sample family' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove Nani' }));
    await user.click(screen.getByRole('button', { name: 'Remove Kabir' }));
    expect(screen.queryByLabelText('Kabir')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save household' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ravi' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Kabir' })).toBeNull();
    await waitFor(() => {
      expect(localStorage.getItem('clearday.v1')).not.toContain('kabir');
    });
  });

  it('keeps at least one person and at most eight', async () => {
    const user = await openLanding();
    expect(screen.getByRole('button', { name: 'Remove person 1' })).toHaveProperty(
      'disabled',
      true,
    );
    for (let i = 0; i < 7; i += 1)
      await user.click(screen.getByRole('button', { name: 'Add a person' }));
    expect(screen.getByRole('button', { name: 'Add a person' })).toHaveProperty('disabled', true);
  });

  it('ignores a corrupt saved household and starts at the landing', async () => {
    localStorage.setItem('clearday.v1', '{"place": 3}');
    await openLanding();
    expect(localStorage.getItem('clearday.v1')).toBeNull();
  });
});
