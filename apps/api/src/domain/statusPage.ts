import { generateSlug } from '../lib/crypto.js';
import { env } from '../config/env.js';
import { isUniqueViolation, prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import type { StatusPage } from '../generated/prisma/client.js';

/**
 * A status page is created lazily the first time a user opens the settings
 * screen, and starts unpublished. The slug is 16 CSPRNG bytes as hex: the URL is
 * the only access control, so it must not be guessable and must not be derived
 * from anything about the user.
 */
export async function getOrCreateStatusPage(userId: string, email: string): Promise<StatusPage> {
  const existing = await prisma.statusPage.findUnique({ where: { userId } });
  if (existing) return existing;

  const defaultTitle = `${email.split('@')[0] ?? 'My'} status`.slice(0, 60);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.statusPage.create({
        data: { userId, slug: generateSlug(), title: defaultTitle, published: false },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either a slug collision (astronomically unlikely) or a concurrent
      // create for the same user. Re-read before trying again.
      const raced = await prisma.statusPage.findUnique({ where: { userId } });
      if (raced) return raced;
    }
  }
  throw new Error('Could not allocate a status page slug');
}

export async function updateStatusPage(
  userId: string,
  changes: { title?: string; published?: boolean },
): Promise<StatusPage> {
  const page = await prisma.statusPage.findUnique({ where: { userId } });
  if (!page) throw notFound('Status page not found.');

  return prisma.statusPage.update({
    where: { id: page.id },
    data: {
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.published !== undefined ? { published: changes.published } : {}),
    },
  });
}

/**
 * Issues a new slug. The old URL stops working immediately, which is the only
 * way to revoke access for someone who already has the link while keeping the
 * page published.
 */
export async function rotateStatusPageSlug(userId: string): Promise<StatusPage> {
  const page = await prisma.statusPage.findUnique({ where: { userId } });
  if (!page) throw notFound('Status page not found.');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.statusPage.update({
        where: { id: page.id },
        data: { slug: generateSlug() },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error('Could not allocate a status page slug');
}

export function publicStatusUrl(slug: string): string {
  return `${env.PUBLIC_APP_URL}/status/${slug}`;
}

/**
 * Looks up a published page by slug. Returns null for an unknown slug *and* for
 * a page whose owner has unpublished it, so unpublishing genuinely removes
 * public access rather than merely hiding a link.
 */
export async function findPublishedStatusPage(slug: string) {
  if (!/^[0-9a-f]{32}$/.test(slug)) return null;
  return prisma.statusPage.findFirst({
    where: { slug, published: true },
    select: { id: true, title: true, userId: true, slug: true },
  });
}
