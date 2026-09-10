import clsx from 'clsx';
import { useId } from 'react';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

/**
 * Light / Dark / System selector.
 *
 * Built on native radio inputs inside a fieldset rather than on buttons with
 * `aria-pressed`. Three mutually exclusive options *are* a radio group, and
 * using the real control means arrow-key navigation, the single-tab-stop
 * roving focus, and the "3 of 3" announcement all come from the platform
 * instead of from hand-written key handlers that would drift.
 *
 * The input is stretched over its whole segment and made invisible with
 * `appearance-none` plus transparent colours — deliberately *not* with
 * `opacity: 0`, and deliberately not shrunk to a screen-reader-only pixel.
 *
 * That combination is what makes the control both usable and accessible with
 * one mechanism: the whole segment is the pointer hit target, and because the
 * input keeps real dimensions and full opacity, the app-wide
 * `:focus-visible { outline: ... }` rule paints its focus ring at exactly the
 * segment's shape. Hiding the input with opacity hides its outline too, and
 * mirroring the ring onto the label with `:has(:focus-visible)` turned out not
 * to paint at all. One rule, verified by sampling the painted pixels.
 */
const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    value: 'light',
    label: 'Light',
    hint: 'Always use the light theme',
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
        <circle cx="10" cy="10" r="3.6" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M10 2.2v1.9M10 15.9v1.9M2.2 10h1.9M15.9 10h1.9M4.5 4.5l1.3 1.3M14.2 14.2l1.3 1.3M15.5 4.5l-1.3 1.3M5.8 14.2l-1.3 1.3" />
        </g>
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'Always use the dark theme',
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
        <path
          d="M16.3 12.7A6.9 6.9 0 0 1 7.3 3.7a7 7 0 1 0 9 9Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    hint: 'Follow the theme set by your operating system',
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
        <rect x="2.2" y="3.4" width="15.6" height="10.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6.8 16.6h6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function ThemeSelector({
  /** `compact` drops the text labels, for the app header where space is tight. */
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { preference, setPreference } = useTheme();
  const groupName = useId();

  return (
    <fieldset
      className={clsx(
        'flex items-center gap-0.5 rounded-lg border border-[var(--border-subtle)]',
        'bg-[var(--surface-sunken)] p-0.5',
        className,
      )}
      data-testid="theme-selector"
    >
      {/*
        The legend is the group's accessible name. It is visually hidden because
        the three icons plus the surrounding header already make the purpose
        obvious on screen, but a screen reader needs it announced.
      */}
      <legend className="sr-only">Colour theme</legend>

      {OPTIONS.map((option) => {
        const checked = preference === option.value;
        return (
          <label
            key={option.value}
            title={option.hint}
            className={clsx(
              'relative flex cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium',
              'transition-colors select-none',
              compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
              checked
                ? 'bg-[var(--surface-raised)] text-strong shadow-sm'
                : 'text-muted hover:text-strong',
            )}
          >
            <input
              type="radio"
              name={`theme-${groupName}`}
              value={option.value}
              checked={checked}
              onChange={() => setPreference(option.value)}
              /*
               * Invisible but fully present: no native rendering, no colour,
               * but real dimensions and full opacity, so its focus ring paints.
               */
              className="absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-md border-0 bg-transparent text-transparent outline-offset-0"
            />
            {option.icon}
            {compact ? (
              <span className="sr-only">{option.label}</span>
            ) : (
              <span>{option.label}</span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
