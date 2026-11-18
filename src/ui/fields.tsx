/**
 * The small form controls every editor uses: a labelled text box, number box, select, checkbox and
 * the error line under a field.
 * Does: tie each label to its control, point `aria-describedby` at the error, and mark
 * an invalid control with `aria-invalid`.
 * Never does: validate (the caller passes the error text) or own any value (every control is controlled).
 */
import type { ReactElement, ReactNode } from 'react';

interface BaseProps {
  readonly id: string;
  readonly label: string;
  readonly error?: string | undefined;
}

/** Points a control's description at its error line, when there is one. */
const describedBy = ({ id, error }: BaseProps): string | undefined =>
  error ? `${id}-error` : undefined;

/** The red line under a field; renders nothing without a message. */
export function FieldError({
  id,
  error,
}: {
  id: string;
  error?: string | undefined;
}): ReactElement | null {
  return error ? (
    <p className="field__error" id={`${id}-error`}>
      <span aria-hidden="true">! </span>
      {error}
    </p>
  ) : null;
}

/** A label, its control and the hint and error around it. */
function Shell(props: BaseProps & { readonly children: ReactNode }): ReactElement {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      <FieldError id={props.id} error={props.error} />
    </div>
  );
}

/** A single-line text box. */
export function TextField(
  props: BaseProps & {
    readonly value: string;
    readonly maxLength: number;
    readonly onChange: (value: string) => void;
  },
): ReactElement {
  return (
    <Shell {...props}>
      <input
        id={props.id}
        type="text"
        value={props.value}
        maxLength={props.maxLength}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props)}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </Shell>
  );
}

/** A number box; an empty box reports NaN, which validation rejects. */
export function NumberField(
  props: BaseProps & {
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step?: number;
    readonly onChange: (value: number) => void;
  },
): ReactElement {
  return (
    <Shell {...props}>
      <input
        id={props.id}
        type="number"
        inputMode="decimal"
        value={Number.isNaN(props.value) ? '' : props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props)}
        onChange={(e) => {
          props.onChange(e.target.valueAsNumber);
        }}
      />
    </Shell>
  );
}

/** A drop-down over `values`, worded by `labels`; `onChange` gets one of `values`. */
export function SelectField<T extends string>(
  props: BaseProps & {
    readonly value: T;
    readonly values: readonly T[];
    readonly labels: Readonly<Record<T, string>>;
    readonly onChange: (value: T) => void;
  },
): ReactElement {
  return (
    <Shell {...props}>
      <select
        id={props.id}
        value={props.value}
        aria-describedby={describedBy(props)}
        onChange={(e) => {
          props.values.filter((v) => v === e.target.value).forEach(props.onChange);
        }}
      >
        {props.values.map((v) => (
          <option key={v} value={v}>
            {props.labels[v]}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/** A checkbox with its label beside it. */
export function CheckField(props: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className="check" htmlFor={props.id}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}
