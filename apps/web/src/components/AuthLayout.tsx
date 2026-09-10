import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Card, Wordmark } from './ui';

/** Shared frame for the signup, login, reset and verification screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <Link to="/" aria-label="Pingexa home">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <Card className="p-6 sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-strong">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </Card>
          {footer ? <div className="mt-4 text-center text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
