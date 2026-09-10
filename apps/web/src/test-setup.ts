import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * Testing Library only auto-cleans when vitest globals are enabled. They are
 * not (explicit imports are clearer), so unmount between tests here — otherwise
 * every render in a file stacks up and text queries match several times.
 */
afterEach(() => {
  cleanup();
});
