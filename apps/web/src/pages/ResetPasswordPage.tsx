import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { passwordSchema } from '@pingexa/shared';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../state/AuthContext';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { meta } = useAuth();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthLayout
        title="Reset link needed"
        subtitle="Open the link from your reset email."
        footer={
          <Link className="text-brand-600 underline" to="/forgot-password">
            Request a new link
          </Link>
        }
      >
        <Alert tone="warning">This page needs the token from the email we sent you.</Alert>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" subtitle="You have been signed out everywhere else.">
        <Alert tone="success">
          Your new password is active and every other session has been signed out.
        </Alert>
        <Button className="mt-4 w-full" onClick={() => navigate('/login')}>
          Sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFormError(null);

          const parsed = passwordSchema.safeParse(password);
          const next: Record<string, string> = {};
          if (!parsed.success) next['password'] = parsed.error.issues[0]?.message ?? 'Invalid';
          if (password !== confirm) next['confirm'] = 'The two passwords do not match';
          if (Object.keys(next).length > 0) {
            setErrors(next);
            return;
          }
          setErrors({});
          setSubmitting(true);
          try {
            await api.post('/api/auth/password-reset/confirm', { token, password });
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
        }}
      >
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors['password']}
          hint={`At least ${meta?.minPasswordLength ?? 10} characters, with a letter and a number.`}
          required
        />
        <Field
          label="Confirm new password"
          type="password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors['confirm']}
          required
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
