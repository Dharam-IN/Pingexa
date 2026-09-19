import clsx from 'clsx';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useCallback, useEffect, useId, useRef } from 'react';

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
      {/*
        The mark itself is fixed white-on-brand in both themes: it is branding,
        not chrome, and an inverted logo would read as a different product.
        These are the only literal colours in the app for that reason.
      */}
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
    'bg-brand-600 text-on-brand hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 dark:disabled:bg-brand-800',
  secondary: 'surface text-strong hover:bg-[var(--surface-sunken)] disabled:opacity-50',
  ghost: 'text-muted hover:text-strong hover:bg-[var(--surface-sunken)] disabled:opacity-50',
  danger: 'bg-down-600 text-on-brand hover:bg-down-700 disabled:bg-down-500/50',
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

/**
 * An icon-only button.
 *
 * Separate from `Button` so the accessible name cannot be forgotten: `label` is
 * required, and it becomes both the `aria-label` and the hover tooltip.
 */
export function IconButton({
  label,
  children,
  className,
  variant = 'ghost',
  ...rest
}: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return (
    <button
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-9 items-center justify-center rounded-lg transition-colors',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
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
        'text-sm font-medium text-on-brand transition-colors hover:bg-brand-700',
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
      <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
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

/* ------------------------------------------------------------- Skeleton ---- */

/**
 * Loading placeholder.
 *
 * Used instead of a spinner wherever the shape of the result is already known,
 * because a block that matches the eventual layout does not make the page jump
 * when the data lands. It is `aria-hidden`: the live region announcing "loading"
 * belongs on the container, said once, not on every grey rectangle.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-skeleton rounded-md bg-[var(--surface-sunken)]', className)}
    />
  );
}

/** A skeleton shaped like a metric card, for the overview's first paint. */
export function SkeletonMetric() {
  return (
    <Card className="p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </Card>
  );
}

/** A skeleton shaped like a monitor row. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <Skeleton className="size-2.5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
      <Skeleton className="hidden h-8 w-24 sm:block" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/* ----------------------------------------------------------------- Card ---- */

export function Card({
  className,
  children,
  as: Tag = 'div',
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
  id?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <Tag className={clsx('surface rounded-xl', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  id,
  level = 'h2',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  level?: 'h2' | 'h3';
}) {
  const Tag = level;
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Tag id={id} className="text-base font-semibold text-strong">
          {title}
        </Tag>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The page-level header every signed-in route uses.
 *
 * One component so the title size, the description, the action placement and
 * the space beneath are identical on every page rather than being re-typed —
 * which is how three pages end up with three different heading sizes.
 */
export function PageHeader({
  title,
  description,
  actions,
  above,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Back link or breadcrumb, rendered above the title. */
  above?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx('mb-6', className)}>
      {above ? <div className="mb-2">{above}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-strong sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- Badge ---- */

export type Tone = 'up' | 'down' | 'warn' | 'info' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  up: 'status-up',
  down: 'status-down',
  warn: 'status-warn',
  info: 'status-info',
  neutral: 'status-neutral',
};

const TONE_DOT: Record<Tone, string> = {
  up: 'bg-up-500',
  down: 'bg-down-500',
  warn: 'bg-warn-500',
  info: 'bg-brand-500',
  neutral: 'bg-[var(--text-subtle)]',
};

/**
 * A small labelled pill.
 *
 * `dot` is decoration only — the label is always rendered, because colour must
 * never be the only thing carrying a status. Someone who cannot distinguish the
 * green from the red still reads "Up" or "Down".
 */
export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  size = 'md',
  title,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? <span className={clsx('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Alert ---- */

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'success' | 'error' | 'warning';
  title?: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const toneClass = {
    info: 'status-info',
    success: 'status-up',
    error: 'status-down',
    warning: 'status-warn',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx('rounded-lg border px-4 py-3 text-sm', toneClass[tone], className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={clsx(title && 'mt-1')}>{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Form field ---- */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  /**
   * Rendered inside the control, before the text. Named `leading` rather than
   * `prefix` because `prefix` is a real HTML attribute typed as a string.
   */
  leading?: ReactNode;
}

/**
 * Every input in the app goes through this, so a label, a description and an
 * error message are always wired to the control with real ids rather than
 * placed near it visually.
 *
 * The hint stays rendered when there is an error: the two say different things
 * ("what is allowed" vs "what went wrong"), and dropping the rule the moment it
 * is broken is precisely when the reader needs it.
 */
export function Field({ label, error, hint, className, id, leading, ...rest }: FieldProps) {
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
      <div
        className={clsx(
          'flex items-center gap-2 rounded-lg border bg-[var(--surface-raised)] transition-colors',
          'focus-within:border-brand-500',
          error ? 'border-down-500' : 'border-[var(--border-subtle)]',
        )}
      >
        {leading ? (
          <span className="pl-3 text-sm text-subtle" aria-hidden="true">
            {leading}
          </span>
        ) : null}
        {/*
          No `outline-none` here. The wrapper exists so a leading icon can sit
          inside the field, and it was briefly suppressing the input's outline so
          only the border changed on focus — which removed the app-wide focus
          ring from every text input in the product. The border tint is a nicety;
          the ring is the accessibility mechanism, and it stays on the real
          control. Same lesson as `docs/DECISIONS.md` D22.
        */}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={clsx(
            'w-full rounded-lg bg-transparent px-3 py-2.5 text-sm text-strong',
            'placeholder:text-subtle',
            leading && 'pl-0',
          )}
          {...rest}
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-[var(--status-down-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; children: ReactNode }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  return (
    <div className={className}>
      <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-strong">
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={hint ? hintId : undefined}
        className={clsx(
          'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]',
          'px-3 py-2.5 text-sm text-strong transition-colors focus:border-brand-500',
        )}
        {...rest}
      >
        {children}
      </select>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
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
  description?: ReactNode;
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
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
          checked ? 'bg-brand-600' : 'bg-[var(--border-strong)]',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-5 rounded-full bg-switch-knob shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* --------------------------------------------------- Segmented control ---- */

/**
 * A small set of mutually exclusive options — a chart range, a list filter.
 *
 * Built on native radios for the same reason `ThemeSelector` is: three
 * exclusive choices *are* a radio group, so arrow-key navigation, the single
 * tab stop and the "2 of 3" announcement come from the platform rather than
 * from hand-written key handlers.
 *
 * The input is stretched over its segment and made invisible with
 * `appearance-none` plus transparent colours — never `opacity: 0`, which would
 * hide its focus ring too. See `docs/DECISIONS.md` D22.
 */
export function SegmentedControl<T extends string>({
  legend,
  options,
  value,
  onChange,
  size = 'md',
  className,
}: {
  legend: string;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange(next: T): void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const groupName = useId();
  return (
    <fieldset
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-subtle)]',
        'bg-[var(--surface-sunken)] p-0.5',
        className,
      )}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            title={option.hint}
            className={clsx(
              'relative cursor-pointer rounded-md font-medium transition-colors select-none',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              checked
                ? 'bg-[var(--surface-raised)] text-strong shadow-raised'
                : 'text-muted hover:text-strong',
            )}
          >
            <input
              type="radio"
              name={`segmented-${groupName}`}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-md border-0 bg-transparent text-transparent outline-offset-0"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/* --------------------------------------------------------------- Metric ---- */

/**
 * One number with its label and the sentence that makes it mean something.
 *
 * `note` is not optional decoration. A bare "97%" invites the reader to supply
 * their own denominator, and this product's whole position on uptime is that
 * the denominator is the interesting part.
 */
export function Metric({
  label,
  value,
  note,
  tone = 'neutral',
  emphasis = false,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  /** Draws the value in the tone colour. For the one number that matters most. */
  emphasis?: boolean;
  className?: string;
}) {
  const toneText: Record<Tone, string> = {
    up: 'text-[var(--status-up-text)]',
    down: 'text-[var(--status-down-text)]',
    warn: 'text-[var(--status-warn-text)]',
    info: 'text-[var(--status-info-text)]',
    neutral: 'text-strong',
  };
  return (
    <div className={className}>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p
        className={clsx(
          'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
          emphasis ? toneText[tone] : 'text-strong',
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

/** A `Metric` in its own card, for a row of summary figures. */
export function MetricCard(props: Parameters<typeof Metric>[0]) {
  return (
    <Card className="p-4">
      <Metric {...props} />
    </Card>
  );
}

/* ----------------------------------------------------------- EmptyState ---- */

export function EmptyState({
  title,
  description,
  action,
  icon = true,
  className,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  icon?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <Logo size={36} /> : null}
      <h3 className="text-base font-semibold text-strong">{title}</h3>
      <div className="max-w-md text-sm text-muted">{description}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Dialog ---- */

/**
 * A modal dialog.
 *
 * Deliberately not a styled `<div>` with `role="dialog"`. The native
 * `<dialog>` element brings the top layer, the backdrop, the inert background
 * and Escape-to-close from the platform, so the only things left to do by hand
 * are the two the platform does not do: closing on a backdrop click, and
 * returning focus somewhere sensible afterwards.
 *
 * Focus is moved into the dialog by the browser on `showModal()`, and the
 * `autofocus` element wins. Destructive dialogs put it on the *cancel* action,
 * so a stray Enter keeps the data.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  tone = 'neutral',
}: {
  open: boolean;
  onClose(): void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Reserved for callers to signal intent; the layout is the same either way. */
  tone?: 'neutral' | 'danger';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = `${titleId}-description`;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  // `cancel` fires for Escape. Route it through the same handler as every other
  // close so the caller's state cannot drift out of sync with the element.
  const handleCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClose={() => {
        if (open) onClose();
      }}
      data-tone={tone}
      onClick={(event) => {
        // A click on the element itself is a click on the backdrop: the content
        // below stops propagation by being a child with its own bounds.
        if (event.target === ref.current) onClose();
      }}
      className={clsx(
        'w-[calc(100vw-2rem)] max-w-md rounded-xl border p-0 backdrop:bg-[var(--scrim)]',
        'border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-strong shadow-overlay',
        'm-auto',
      )}
    >
      {/*
        Contents are rendered only while open. A closed <dialog> keeps its
        children in the DOM, so a form left mounted here duplicates every label
        and hint elsewhere on the page — which makes the page's text ambiguous
        to a screen reader's search and to any test that looks for it.
      */}
      {open ? (
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold text-strong">
          {title}
        </h2>
        {description ? (
          <div id={descriptionId} className="mt-1.5 text-sm text-muted">
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
      ) : null}
    </dialog>
  );
}

/**
 * The destructive-confirmation shape, so every delete in the app asks the same
 * way: what will be lost, spelled out, and the safe choice focused.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
}: {
  open: boolean;
  onClose(): void;
  onConfirm(): void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      tone="danger"
      footer={
        <>
          {/*
            autoFocus on the cancel action, not the confirm: opening a
            destructive dialog and hitting Enter out of habit must not destroy
            anything.
          */}
          <Button variant="secondary" onClick={onClose} autoFocus disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- Table ---- */

/**
 * A scrollable table wrapper.
 *
 * The overflow container is `tabindex=0` with a label so a keyboard user can
 * actually scroll it — an overflowing region that only responds to a mouse is
 * a common and invisible accessibility bug.
 */
export function TableWrap({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={clsx('-mx-1 overflow-x-auto px-1', className)}
    >
      {children}
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={clsx(
        // Column gutters belong on the cell, not on each caller's content: two
        // adjacent columns with no gutter run together into one unreadable
        // string, which is what happened to "Attempts" and "Accepted at".
        'pr-4 pb-2 text-xs font-medium tracking-wide text-muted uppercase last:pr-0',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={clsx(
        'pr-4 py-2.5 text-sm last:pr-0',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------ Hint text ---- */

/** A short explanatory line under a control or beside a figure. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx('text-xs text-muted', className)}>{children}</p>;
}
