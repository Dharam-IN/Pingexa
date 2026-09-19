import { useEffect, useState } from 'react';

/**
 * The current time, as React state.
 *
 * Two problems, one hook.
 *
 * The first is correctness: calling `Date.now()` during render is impure, so a
 * component that does it can show a different answer every time React happens
 * to re-render it, for reasons unrelated to the clock. The lint rule that
 * catches this is not being pedantic — "3m ago" that updates only when
 * something *else* changes is a real bug people notice.
 *
 * The second is that a monitoring UI is mostly relative timestamps. Without a
 * tick, "last checked 1m ago" stays at "1m ago" until the next poll lands 30
 * seconds later, which is exactly the moment a reader is deciding whether the
 * page is live.
 *
 * The default cadence is 30 seconds because every string this feeds is rounded
 * to at least whole seconds and mostly to minutes; ticking faster would re-render
 * the tree for no visible change.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Set from a timer callback, not synchronously in the effect body, so this
    // does not cascade a render when the component mounts.
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
