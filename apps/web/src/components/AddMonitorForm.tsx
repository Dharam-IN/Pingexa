import { useState } from 'react';
import { createMonitorSchema, ALLOWED_MONITOR_PORTS } from '@pingexa/shared';
import { Alert, Button, Field, Hint, Toggle } from './ui';
import { normaliseMonitorUrl } from '../lib/format';

export interface NewMonitor {
  name: string;
  url: string;
  isPublic: boolean;
}

/**
 * Add-monitor form.
 *
 * Client validation uses the shared schema, so the browser and the API agree on
 * what a valid URL *looks* like. It only ever checks shape.
 *
 * The address policy — public DNS, standard port, no credentials, no internal
 * hostname — is decided **server-side and only server-side**, and its message is
 * surfaced here verbatim. Nothing in this file may grow into a second opinion
 * about whether a URL is safe to monitor: a client-side copy of that logic would
 * drift from the guard, and a reader would reasonably assume the version they
 * can see is the one that decides. It is not. See `docs/DECISIONS.md` D9.
 */
export function AddMonitorForm({
  onSubmit,
  onCancel,
  onCreated,
  disabled,
}: {
  onSubmit(monitor: NewMonitor): Promise<void>;
  onCancel(): void;
  /** Called with the new monitor's id, when the caller wants to navigate to it. */
  onCreated?: (id: string) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // What the URL will become once normalised, shown only when it differs from
  // what was typed, so the reader is never surprised by what got stored.
  const normalised = normaliseMonitorUrl(url);
  const showsNormalisation = normalised !== null && normalised !== url.trim() && url.trim() !== '';

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        // Guard against a double submit that slips past the disabled button —
        // a second Enter while the first request is still in flight.
        if (submitting) return;
        setFormError(null);

        const candidate = normalised ?? url.trim();
        const parsed = createMonitorSchema.safeParse({ name, url: candidate, isPublic });
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
          // Only cleared on success. A recoverable error must leave every field
          // exactly as typed, or a rejected URL costs the user the whole form.
          setName('');
          setUrl('');
          setIsPublic(false);
        } catch (error) {
          const withFields = error as {
            fields?: Record<string, string>;
            message?: string;
            monitorId?: string;
          };
          if (withFields.fields && Object.keys(withFields.fields).length > 0) {
            setErrors(withFields.fields);
          } else {
            setFormError(withFields.message ?? 'Could not add the monitor.');
          }
        } finally {
          setSubmitting(false);
        }
        void onCreated;
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
        hint="Shown in your dashboard, in alert emails, and on your status page if you publish it."
        maxLength={60}
        autoComplete="off"
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
        autoComplete="url"
        spellCheck={false}
        hint={
          <>
            A public <code className="font-mono">http://</code> or{' '}
            <code className="font-mono">https://</code> address on its standard port (
            {ALLOWED_MONITOR_PORTS.join(' or ')}). No username or password in the URL.
            Redirects are not followed, so enter the final address.
          </>
        }
        required
      />

      {showsNormalisation ? (
        <Hint className="-mt-2">
          Will be saved as <span className="font-mono text-strong">{normalised}</span>
        </Hint>
      ) : null}

      <Toggle
        label="Show on my status page"
        description="Publishes the name, state and uptime only — never the URL. You can change this at any time."
        checked={isPublic}
        onChange={setIsPublic}
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" loading={submitting} disabled={disabled}>
          Add monitor
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>

      <Hint>
        The first result appears within one check interval. Until then the monitor shows as
        pending — that is normal, not an error.
      </Hint>
    </form>
  );
}
