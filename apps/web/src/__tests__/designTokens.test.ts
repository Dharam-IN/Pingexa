import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The stylesheet source, not Vite's compiled output.
 *
 * `?raw` was the obvious way to load this and is the wrong one: Vite runs the
 * file through Tailwind first, so the import yields generated CSS in which the
 * authored `:root` block no longer appears. The rule being guarded is a
 * property of the source, so the source is what gets read.
 *
 * The candidates cover both ways the suite is started — from `apps/web` via the
 * workspace script, and from the repository root.
 */
function readStylesheet(): string {
  const candidates = [
    resolve(process.cwd(), 'src/index.css'),
    resolve(process.cwd(), 'apps/web/src/index.css'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`index.css not found. Looked in: ${candidates.join(', ')}`);
  return readFileSync(found, 'utf8');
}

const CSS = readStylesheet();

/**
 * Guards the one theming mistake that fails silently.
 *
 * `CLAUDE.md` states the rule: a token added to `:root` must also be added to
 * `:root[data-theme='dark']`. Forget the second one and nothing breaks in the
 * theme you happen to be looking at — the variable simply falls through to the
 * light value, and the bug ships in whichever theme you did not check.
 *
 * A test is the right place for this because it is a property of the file, not
 * of any rendered component: no amount of screenshotting one theme can catch a
 * token that is missing from the other.
 */
/** Extracts the balanced body of the first rule whose selector matches. */
function ruleBody(selector: string): string {
  const selectorIndex = CSS.indexOf(selector);
  expect(selectorIndex, `selector ${selector} not found in index.css`).toBeGreaterThan(-1);

  const open = CSS.indexOf('{', selectorIndex);
  let depth = 0;
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === '{') depth += 1;
    else if (CSS[index] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, index);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

function declaredTokens(selector: string): Set<string> {
  return new Set([...ruleBody(selector).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
}

const light = declaredTokens(':root {');
const dark = declaredTokens(":root[data-theme='dark']");

describe('semantic design tokens', () => {
  it('declares every light token in the dark theme too', () => {
    const missing = [...light].filter((token) => !dark.has(token)).sort();
    expect(missing, 'tokens missing from :root[data-theme="dark"]').toEqual([]);
  });

  it('declares no dark-only token that light would fall back on', () => {
    const extra = [...dark].filter((token) => !light.has(token)).sort();
    expect(extra, 'tokens present only in the dark theme').toEqual([]);
  });

  it('defines the semantic tokens components are required to use', () => {
    // Named explicitly so removing one is a deliberate act with a failing test,
    // not a silent change that leaves call sites resolving to nothing.
    for (const token of [
      '--surface',
      '--surface-raised',
      '--surface-sunken',
      '--surface-overlay',
      '--border-subtle',
      '--border-strong',
      '--text-strong',
      '--text-muted',
      '--text-subtle',
      '--on-brand',
      '--switch-knob',
      '--focus-ring',
      '--status-up-surface',
      '--status-down-surface',
      '--status-warn-surface',
      '--status-info-surface',
      '--status-neutral-surface',
      '--chart-grid',
      '--chart-axis',
      '--chart-line',
      '--chart-fail',
      '--chart-gap',
    ]) {
      expect(light.has(token), `${token} is not declared on :root`).toBe(true);
    }
  });

  it('resolves the theme through an attribute, never a media query', () => {
    // `docs/DECISIONS.md` D21: "system" is resolved before CSS sees it, so a
    // toggle and a media query can never disagree about the active theme.
    expect(CSS).not.toContain('prefers-color-scheme');
  });

  it('keeps reduced-motion support', () => {
    expect(CSS).toContain('prefers-reduced-motion');
  });
});
