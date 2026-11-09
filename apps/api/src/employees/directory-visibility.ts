import type { Prisma } from '@prisma/client';

/** The bootstrap account remains usable, but is not a member of the staff directory. */
function bootstrapLogin() {
  return (process.env.SEED_OWNER_LOGIN?.trim() || 'owner').toLowerCase();
}

export function isBootstrapAccount(login?: string) {
  return typeof login === 'string' && login.toLowerCase() === bootstrapLogin();
}

export function employeeDirectoryWhere(): Prisma.UserWhereInput {
  return { deletedAt: null, NOT: { login: { equals: bootstrapLogin(), mode: 'insensitive' } } };
}
