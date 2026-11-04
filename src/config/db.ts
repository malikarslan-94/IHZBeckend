import { PrismaClient } from '@prisma/client';
import './env.js';
export const db = new PrismaClient({ transactionOptions: { maxWait: 30000, timeout: 15000 } });
