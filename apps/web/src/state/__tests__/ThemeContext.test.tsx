import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, resolveTheme, useTheme, THEME_STORAGE_KEY } from '../ThemeContext';
import { ThemeSelector } from '../../components/ThemeSelector';

/**
 * Theme behaviour that must not regress. The browser-level checks (no flash on
 * first paint, contrast in both themes, persistence across a real reload) live
 * in `e2e/theme.spec.ts`; these cover the logic and the control's semantics.
 */

/** Stands in for `prefers-color-scheme`, which jsdom does not implement. */
function mockMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const query = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );

  return {
    /**
     * Simulate the user changing their OS theme. Wrapped in `act` because the
     * media-query listener fires outside React's event system, exactly as it
     * does in a browser.
     */
    setDark(next: boolean) {
      dark = next;
      act(() => {
        for (const listener of listeners) {
          listener({ matches: next } as MediaQueryListEvent);
        }
      });
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function Probe() {
  const { preference, resolved } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeSelector />
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // The bootstrap script writes these in the browser; mirror it so the tests
  // exercise the same starting conditions as production.
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('passes an explicit preference straight through', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('defers to the OS only for "system"', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('defaults to system and stores nothing until the user chooses', () => {
    mockMatchMedia(false);
    renderTheme();

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    // A default must not masquerade as a choice.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('resolves system against a dark OS', () => {
    mockMatchMedia(true);
    renderTheme();
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('follows a live OS change while system is selected', () => {
    const media = mockMatchMedia(false);
    renderTheme();
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    media.setDark(true);
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    media.setDark(false);
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('ignores the OS once an explicit theme is chosen', async () => {
    const media = mockMatchMedia(false);
    const user = userEvent.setup();
    renderTheme();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    // The OS goes light; an explicit Dark must win.
    media.setDark(false);
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists the choice and reads it back on a later mount', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    const first = renderTheme();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();

    // A fresh mount with no bootstrap attributes must still honour storage.
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    renderTheme();
    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('prefers what the bootstrap script already applied', () => {
    mockMatchMedia(false);
    // The script ran and decided dark; the provider must not undo it.
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-theme-preference', 'dark');
    renderTheme();
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('still applies a theme when storage throws', async () => {
    mockMatchMedia(false);
    const getItem = vi
      .spyOn(window.localStorage, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const user = userEvent.setup();
    renderTheme();
    // Remembering is best-effort; applying is not.
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('ignores a junk stored value rather than breaking', () => {
    mockMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    renderTheme();
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('drops the OS listener when unmounted', () => {
    const media = mockMatchMedia(false);
    const view = renderTheme();
    expect(media.listenerCount).toBeGreaterThan(0);
    view.unmount();
    expect(media.listenerCount).toBe(0);
  });
});

describe('ThemeSelector', () => {
  it('is a labelled radio group with exactly one selected option', () => {
    mockMatchMedia(false);
    renderTheme();

    const group = screen.getByRole('group', { name: 'Colour theme' });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('names every option for assistive technology, even when compact', () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeSelector compact />
      </ThemeProvider>,
    );
    for (const name of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('moves selection with the arrow keys, like a real radio group', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderTheme();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });
});
