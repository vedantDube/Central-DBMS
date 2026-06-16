import { PrismaClient } from '@prisma/client';
import { PrismaClient as AmazonPrismaClient } from '@prisma/client-amazon';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __supabasePrismaClient: AmazonPrismaClient | undefined;
}

export const prisma = globalThis.__prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = prisma;
}

export const supabasePrisma = globalThis.__supabasePrismaClient ?? (
  process.env.SUPABASE_DB_URL
    ? new AmazonPrismaClient({
        datasources: {
          db: {
            url: process.env.SUPABASE_DB_URL,
          },
        },
      })
    : null
);

if (process.env.NODE_ENV !== 'production' && supabasePrisma) {
  globalThis.__supabasePrismaClient = supabasePrisma;
}