import type { Prisma } from '@prisma/client';
export function log(
  tx: Prisma.TransactionClient,
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  details: unknown = {},
) {
  return tx.activityLog.create({
    data: { userId, action, entityType, entityId, details: JSON.parse(JSON.stringify(details)) },
  });
}
