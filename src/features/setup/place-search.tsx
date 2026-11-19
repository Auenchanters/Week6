/**
 * Place search: a text box that offers matching places in a list you pick from.
 * Does: wait 400 ms after typing stops, ask the API for places once there are 2 or more characters
 * (cancelling the earlier request), show the matches as a listbox with arrow-key, Enter and Escape
 * support, announce the result count politely, and offer the bundled New Delhi sample so setup
 * works without typing.
 * Never does: search on every keystroke, or keep a place the person did not pick.
 */
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { LIMITS } from '../../shared/limits.js';
import { SAMPLE_PROFILE } from '../../shared/samples.js';
import type { Place } from '../../shared/schema.js';
import { FieldError } from '../../ui/fields.js';
import { searchPlaces, type PlaceHit } from '../client/api.js';

const DEBOUNCE_MS = 400;
const MIN_QUERY = 2;

/** What the polite live region announces: a failure, the result count once a search is done, or nothing. */
function searchStatus(failed: string, done: boolean, count: number): string {
  if (failed) return failed;
  if (!done) return '';
  return count === 0 ? 'No places found.' : `${count} places found. Use the arrow keys to choose.`;
}

/** The search box for the household's place; `id` is the field id errors link to. */
export function PlaceSearch(props: {
  readonly id: string;
  readonly place: Place | null;
  readonly error: string | undefined;
  readonly onPick: (place: Place) => void;
}): ReactElement {
  const { id, place, error, onPick } = props;
  const [query, setQuery] = useState(place?.name ?? '');
  const [hits, setHits] = useState<readonly PlaceHit[]>([]);
  const [searched, setSearched] = useState('');
  const [failed, setFailed] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const text = query.trim();
  const searching = text.length >= MIN_QUERY && text !== place?.name;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPlaces(text, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setSearched(text);
        setFailed(result.ok ? '' : result.error.message);
        setHits(result.ok ? result.value : []);
        setActive(0);
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, text]);

  const choose = (hit: PlaceHit): void => {
    const picked = { ...hit, name: hit.name.slice(0, LIMITS.profile.placeNameMax) };
    onPick(picked);
    setQuery(picked.name);
    setOpen(false);
  };
  const shown = open && searching && searched === text ? hits : [];
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) =>
        Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
      );
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && shown.length > 0) {
      e.preventDefault();
      shown.slice(active, active + 1).forEach(choose);
    }
  };

  const status = searchStatus(failed, searching && searched === text, hits.length);

  return (
    <div className="field place">
      <label htmlFor={id}>Where do you live?</label>
      <p className="field__hint" id={`${id}-hint`}>
        Type at least 2 letters of your city or town, then choose it from the list.
      </p>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={shown.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown.length > 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        className="place__list"
        id={`${id}-list`}
        role="listbox"
        aria-label="Matching places"
        hidden={shown.length === 0}
      >
        {shown.map((hit, i) => (
          <div
            key={`${hit.name}-${hit.latitude}-${hit.longitude}`}
            id={`${id}-opt-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(hit);
            }}
          >
            {hit.name}
          </div>
        ))}
      </div>
      <p className="visually-hidden" role="status">
        {status}
      </p>
      <FieldError id={id} error={error} />
      <ChosenPlace
        place={place}
        onSample={() => {
          choose({ ...SAMPLE_PROFILE.place });
        }}
      />
    </div>
  );
}

/** The place picked so far, with a shortcut to the bundled sample. */
function ChosenPlace(props: {
  readonly place: Place | null;
  readonly onSample: () => void;
}): ReactElement {
  const { place, onSample } = props;
  return (
    <p className="place__chosen">
      {place ? (
        <>
          Chosen place: <strong>{place.name}</strong>
        </>
      ) : (
        'No place chosen yet.'
      )}{' '}
      <button type="button" className="link" onClick={onSample}>
        Use sample: New Delhi
      </button>
    </p>
  );
}
