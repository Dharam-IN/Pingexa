import clsx from 'clsx';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { useId } from 'react';

/* ---------------------------------------------------------------- Brand ---- */

/**
 * The Pingexa mark: a filled dot inside two fading rings — a ping leaving the
 * monitor. `live` adds the one animation in the product, used only where
 * something really is being checked right now.
 */
export function Logo({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <rect width="32" height="32" rx="8" className="fill-brand-600" />
        <circle cx="16" cy="16" r="4" fill="#fff" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" />
        <circle cx="16" cy="16" r="12.5" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" />
      </svg>
      {live ? (
        <span className="animate-ping-ring absolute inset-2 rounded-full border-2 border-brand-400" />
      ) : null}
    </span>
  );
}

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg';
  return (
    <span className="inline-flex items-center gap-2">
      <Logo size={size === 'lg' ? 34 : size === 'sm' ? 22 : 28} />
      <span className={clsx('font-semibold tracking-tight text-strong', text)}>Pingexa</span>
    </span>
  );
}

/* --------------------------------------------------------------- Button ---- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 dark:disabled:bg-brand-800',
  secondary:
    'surface text-strong hover:bg-[var(--surface-sunken)] disabled:opacity-50',
  ghost: 'text-muted hover:text-strong hover:bg-[var(--surface-sunken)] disabled:opacity-50',
  danger:
    'bg-down-600 text-white hover:bg-down-700 disabled:bg-down-500/50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      // A loading button must not be clickable twice, and must still announce
      // that something is happening.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        // A wrapped button label looks broken; let the surrounding layout wrap instead.
        'whitespace-nowrap disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5',
        'text-sm font-medium text-white transition-colors hover:bg-brand-700',
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}

/* -------------------------------------------------------------- Spinner ---- */

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="animate-spin"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="text-sm text-muted">{label}</span> : null}
    </span>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-muted" role="status">
      <Spinner size={22} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- Card ---- */

export function Card({
  className,
  children,
  as: Tag = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={clsx('surface rounded-xl', className)}>{children}</Tag>;
}

export function SectionHeading({
  title,
  description,
  action,
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={id} className="text-base font-semibold text-strong">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- Alert ---- */

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'error' | 'warning';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'bg-brand-50 border-brand-200 text-brand-900 dark:bg-brand-900/25 dark:border-brand-700 dark:text-brand-100',
    success:
      'bg-up-50 border-up-500/40 text-up-700 dark:bg-up-700/20 dark:border-up-600 dark:text-up-50',
    error:
      'bg-down-50 border-down-500/40 text-down-700 dark:bg-down-700/20 dark:border-down-600 dark:text-down-50',
    warning:
      'bg-warn-50 border-warn-500/40 text-warn-700 dark:bg-warn-700/25 dark:border-warn-600 dark:text-warn-50',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx('rounded-lg border px-4 py-3 text-sm', tones[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={clsx(title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------- Form field ---- */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

/**
 * Every input in the app goes through this, so a label, a description and an
 * error message are always wired to the control with real ids rather than
 * placed near it visually.
 */
export function Field({ label, error, hint, className, id, ...rest }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-strong">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={clsx(
          'w-full rounded-lg border bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-strong',
          'placeholder:text-muted/70 transition-colors',
          error
            ? 'border-down-500 focus:border-down-600'
            : 'border-[var(--border-subtle)] focus:border-brand-500',
        )}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-down-600 dark:text-down-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  name,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-strong">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        name={name}
        aria-checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-[var(--border-subtle)]',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- EmptyState ---- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Logo size={40} />
      <h3 className="text-base font-semibold text-strong">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
