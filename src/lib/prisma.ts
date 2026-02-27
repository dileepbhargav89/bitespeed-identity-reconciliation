/**
 * @file src/lib/prisma.ts
 * @description Singleton Prisma Client instance.
 *
 * In development, Next.js hot-reloading (and ts-node-dev restarts) can create
 * multiple PrismaClient instances, exhausting the connection pool. The global
 * singleton pattern ensures only one instance exists across the entire process
 * lifetime, regardless of how many times this module is imported.
 */

import { PrismaClient } from "@prisma/client";

// Extend the NodeJS global type to hold our singleton safely
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * The single, shared PrismaClient instance for the application.
 * In production it is created fresh. In development it is reused
 * across hot-reloads via the global object.
 */
const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
