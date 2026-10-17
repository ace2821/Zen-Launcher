import { useId, type ComponentProps, type ReactNode } from "react";
import styles from "./ui.module.css";

interface FieldChromeProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** Rendered next to the label, e.g. a save indicator. */
  action?: ReactNode;
}

function FieldShell({
  label,
  hint,
  error,
  action,
  htmlFor,
  children,
}: FieldChromeProps & { htmlFor: string; children: ReactNode }) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        <span>{label}</span>
        {action}
      </label>
      <div aria-describedby={describedBy}>{children}</div>
      {error ? (
        <span className={styles.fieldError} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className={styles.fieldHint} id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<ComponentProps<"input">, "id">,
    FieldChromeProps {
  mono?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  action,
  mono = false,
  className,
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} action={action} htmlFor={id}>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        className={[
          styles.input,
          mono ? styles.inputMono : "",
          error ? styles.inputInvalid : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </FieldShell>
  );
}

export interface TextAreaFieldProps
  extends Omit<ComponentProps<"textarea">, "id">,
    FieldChromeProps {
  mono?: boolean;
}

export function TextAreaField({
  label,
  hint,
  error,
  action,
  mono = false,
  className,
  ...textAreaProps
}: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} action={action} htmlFor={id}>
      <textarea
        {...textAreaProps}
        id={id}
        aria-invalid={error ? true : undefined}
        className={[
          styles.textarea,
          mono ? styles.textareaMono : "",
          error ? styles.inputInvalid : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps
  extends Omit<ComponentProps<"select">, "id">,
    FieldChromeProps {
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  action,
  className,
  children,
  ...selectProps
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} action={action} htmlFor={id}>
      <select
        {...selectProps}
        id={id}
        className={[styles.select, className ?? ""].filter(Boolean).join(" ")}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export interface SwitchFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
}

export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: SwitchFieldProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchTrack}>
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchText}>
        <span className={styles.switchLabel}>{label}</span>
        {hint ? <span className={styles.switchHint}>{hint}</span> : null}
      </span>
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentProps<"button">["children"];
  /** Accessible name when the label is icon-only. */
  ariaLabel?: string;
  /** Native tooltip; falls back to the label. */
  title?: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(next: T): void;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  const move = (direction: 1 | -1) => {
    const index = options.findIndex((option) => option.value === value);
    if (index === -1) return;
    const next = options[(index + direction + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel ?? option.label}
            title={option.title ?? option.label}
            tabIndex={active ? 0 : -1}
            className={[styles.segment, active ? styles.segmentActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label ? <span>{option.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
