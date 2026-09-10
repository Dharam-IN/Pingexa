import { Link } from 'react-router';
import { Card, Logo, Wordmark } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <Link to="/" aria-label="Pingexa home">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <Card className="max-w-md p-8 text-center">
          <Logo size={40} />
          <h1 className="mt-3 text-lg font-semibold text-strong">Page not found</h1>
          <p className="mt-1.5 text-sm text-muted">
            That address does not exist in Pingexa.
          </p>
          <Link
            to="/"
            className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Back to the start
          </Link>
        </Card>
      </main>
    </div>
  );
}
