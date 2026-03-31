import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL || "file:./dev.db";
  // libSQL requires absolute file:// URL for local SQLite
  const absoluteUrl = dbUrl.startsWith("file:")
    ? `file:${path.resolve(process.cwd(), dbUrl.slice(5))}`
    : dbUrl;

  const adapter = new PrismaLibSql({ url: absoluteUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
