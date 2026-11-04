import type { Prisma } from '@prisma/client';
export async function nextNumber(tx: Prisma.TransactionClient, key: string, prefix: string) {
  const rows = await tx.$queryRaw<
    { value: number }[]
  >`INSERT INTO "Counter" ("key","value") VALUES (${key},1) ON CONFLICT ("key") DO UPDATE SET "value"="Counter"."value"+1 RETURNING "value"`;
  return `${prefix}${String(rows[0].value).padStart(4, '0')}`;
}
export const karachiYear = (date = new Date()) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Karachi' }).format(date);
