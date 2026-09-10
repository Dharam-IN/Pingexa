import { z } from 'zod';
import {
  MAX_MONITOR_NAME_LENGTH,
  MAX_MONITOR_URL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_STATUS_PAGE_TITLE_LENGTH,
  MIN_PASSWORD_LENGTH,
  UPTIME_WINDOWS,
} from './constants.js';

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Enter your email address')
  .max(254, 'Email address is too long')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, 'Password is too long')
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number');

export const opaqueTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,200}$/, 'This link is not valid');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(MAX_PASSWORD_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestEmailSchema = z.object({ email: emailSchema });
export type RequestEmailInput = z.infer<typeof requestEmailSchema>;

export const verifyEmailSchema = z.object({ token: opaqueTokenSchema });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resetPasswordSchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const monitorNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the monitor a name')
  .max(MAX_MONITOR_NAME_LENGTH, `Keep the name under ${MAX_MONITOR_NAME_LENGTH} characters`);

/**
 * Shape-only URL validation, safe to run in the browser. The authoritative
 * security check (scheme, credentials, port, DNS resolution and address policy)
 * always runs again server-side in the SSRF guard.
 */
export const monitorUrlSchema = z
  .string()
  .trim()
  .min(1, 'Enter the URL you want to monitor')
  .max(MAX_MONITOR_URL_LENGTH, 'URL is too long')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a full http:// or https:// URL');

export const createMonitorSchema = z.object({
  name: monitorNameSchema,
  url: monitorUrlSchema,
  isPublic: z.boolean().optional(),
});
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

export const updateMonitorSchema = z
  .object({
    name: monitorNameSchema.optional(),
    url: monitorUrlSchema.optional(),
    paused: z.boolean().optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

export const uptimeWindowSchema = z.enum(UPTIME_WINDOWS).default('24h');

export const updateStatusPageSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give your status page a title')
      .max(MAX_STATUS_PAGE_TITLE_LENGTH, 'Title is too long')
      .optional(),
    published: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateStatusPageInput = z.infer<typeof updateStatusPageSchema>;
