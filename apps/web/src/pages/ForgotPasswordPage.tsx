import { useState } from 'react';
import { Link } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field } from '../components/ui';
import { ApiError, api } from '../lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AuthLayout
      title={sent ? 'Check your inbox' : 'Reset your password'}
      subtitle={sent ? undefined : 'We will email you a link to choose a new password.'}
      footer={
        <Link className="text-brand-600 underline" to="/login">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          If <strong>{email}</strong> has a Pingexa account, a reset link is on its way. It expires
          in one hour and can be used once.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setSubmitting(true);
            try {
              await api.post('/api/auth/password-reset/request', { email: email.trim() });
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
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
