import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { signupSchema } from '@pingexa/shared';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../state/AuthContext';

export function SignupPage() {
  const navigate = useNavigate();
  const { meta } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    // Validate with the same schema the API uses, so the messages match.
    const parsed = signupSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!(key in fields)) fields[key] = issue.message;
      }
      setErrors(fields);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.post('/api/auth/signup', parsed.data);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        if (Object.keys(error.fields).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle={
          <>
            If <strong>{email}</strong> does not already have an account, we have sent it a
            confirmation link. Open it to start monitoring.
          </>
        }
        footer={
          <>
            Already confirmed? <Link className="text-brand-600 underline" to="/login">Sign in</Link>
          </>
        }
      >
        <Alert tone="info">
          The link expires in 24 hours and can be used once. Nothing is monitored and no alerts are
          sent until the address is confirmed.
        </Alert>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your Pingexa account"
      subtitle={`Monitor up to ${meta?.monitorLimit ?? 3} sites, checked every ${(meta?.intervalSeconds ?? 300) / 60} minutes.`}
      footer={
        <>
          Already have an account?{' '}
          <Link className="text-brand-600 underline" to="/login">
            Sign in
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
          error={errors['email']}
          placeholder="you@example.com"
          required
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors['password']}
          hint={`At least ${meta?.minPasswordLength ?? 10} characters, with a letter and a number.`}
          required
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
