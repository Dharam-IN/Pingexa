import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Transient confirmations and failures.
 *
 * Rendered in an `aria-live` region so a screen reader announces the result of
 * an action that has no other visible consequence (pausing a monitor, copying a
 * link, resending an email).
 */
export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  show(tone: Toast['tone'], message: string): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: Toast['tone'], message: string) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
