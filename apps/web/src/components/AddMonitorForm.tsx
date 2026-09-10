import { useState } from 'react';
import { createMonitorSchema } from '@pingexa/shared';
import { Alert, Button, Field, Toggle } from './ui';

export interface NewMonitor {
  name: string;
  url: string;
  isPublic: boolean;
}

/**
 * Add-monitor form.
 *
 * Client validation uses the shared schema, so the browser and the API agree on
 * what a valid URL looks like. It only checks shape: the address policy (public
 * DNS, standard port, no credentials) is decided server-side and its message is
 * surfaced here verbatim.
 */
export function AddMonitorForm({
  onSubmit,
  onCancel,
  disabled,
}: {
  onSubmit(monitor: NewMonitor): Promise<void>;
  onCancel(): void;
  disabled?: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setFormError(null);
        const parsed = createMonitorSchema.safeParse({ name, url, isPublic });
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
          await onSubmit({ name: parsed.data.name, url: parsed.data.url, isPublic });
          setName('');
          setUrl('');
          setIsPublic(false);
        } catch (error) {
          const withFields = error as { fields?: Record<string, string>; message?: string };
          if (withFields.fields && Object.keys(withFields.fields).length > 0) {
            setErrors(withFields.fields);
          } else {
            setFormError(withFields.message ?? 'Could not add the monitor.');
          }
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <Field
        label="Name"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors['name']}
        placeholder="Marketing site"
        maxLength={60}
        required
      />
      <Field
        label="URL to monitor"
        name="url"
        type="url"
        inputMode="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        error={errors['url']}
        placeholder="https://example.com"
        hint="A public http:// or https:// address on its standard port. Redirects are not followed, so use the final URL."
        required
      />
      <Toggle
        label="Show on my status page"
        description="You can change this at any time. Your URL is never published."
        checked={isPublic}
        onChange={setIsPublic}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={disabled}>
          Add monitor
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
