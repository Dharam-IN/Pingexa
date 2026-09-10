import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../state/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Where the user was heading before being asked to sign in.
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in to Pingexa"
      footer={
        <>
          No account yet?{' '}
          <Link className="text-brand-600 underline" to="/signup">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <div className="flex items-center justify-between">
          <Link to="/forgot-password" className="text-sm text-brand-600 underline">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
