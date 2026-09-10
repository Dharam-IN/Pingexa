import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../state/AuthContext';

type Phase = 'verifying' | 'verified' | 'failed' | 'missing-token';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh, status } = useAuth();
  const token = params.get('token');
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'missing-token');
  const [message, setMessage] = useState<string | null>(null);
  // The token is single use, so React must not verify it twice in dev StrictMode.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await api.post('/api/auth/verify-email', { token });
        await refresh();
        setPhase('verified');
      } catch (error) {
        setMessage(
          error instanceof ApiError ? error.message : 'This link could not be confirmed.',
        );
        setPhase('failed');
      }
    })();
  }, [token, refresh]);

  if (phase === 'verifying') {
    return (
      <AuthLayout title="Confirming your email address">
        <LoadingBlock label="Confirming…" />
      </AuthLayout>
    );
  }

  if (phase === 'verified') {
    return (
      <AuthLayout
        title="Email confirmed"
        subtitle="Monitoring and alerts are now active for your account."
      >
        <Alert tone="success">
          Any monitors you already added have been scheduled and will be checked within five
          minutes.
        </Alert>
        <Button
          className="mt-4 w-full"
          onClick={() => navigate(status === 'authenticated' ? '/app' : '/login')}
        >
          {status === 'authenticated' ? 'Go to your monitors' : 'Sign in'}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={phase === 'missing-token' ? 'Confirmation link needed' : 'That link did not work'}
      subtitle={
        phase === 'missing-token'
          ? 'Open the link from your confirmation email, or request a new one below.'
          : message ?? undefined
      }
      footer={
        <Link className="text-brand-600 underline" to="/login">
          Back to sign in
        </Link>
      }
    >
      <ResendForm />
    </AuthLayout>
  );
}

function ResendForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <Alert tone="success">
        If that address has an unconfirmed Pingexa account, a new link is on its way.
      </Alert>
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
          await api.post('/api/auth/verify-email/resend', { email: email.trim() });
          setSent(true);
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : 'Could not send the email.');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <Button type="submit" className="w-full" loading={submitting}>
        Send a new confirmation link
      </Button>
    </form>
  );
}
