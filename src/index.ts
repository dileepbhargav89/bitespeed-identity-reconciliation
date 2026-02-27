/**
 * @file src/index.ts
 * @description Application entry point.
 *
 * Responsible for:
 *  1. Loading environment variables from .env
 *  2. Verifying the database connection at startup
 *  3. Starting the HTTP server
 *  4. Handling graceful shutdown on SIGTERM / SIGINT
 */

import "dotenv/config"; // Must be the very first import
import { createApp } from "./app";
import prisma from "./lib/prisma";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function bootstrap(): Promise<void> {
  // ── Verify DB connectivity before accepting traffic ─────────────────────
  try {
    await prisma.$connect();
    console.log("✅ Database connection established.");
  } catch (error) {
    console.error("❌ Failed to connect to the database:", error);
    process.exit(1); // Exit immediately — no point starting without a DB
  }

  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Bitespeed Identity Service running on port ${PORT}`);
    console.log(`   Environment : ${process.env.NODE_ENV ?? "development"}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Endpoint    : POST http://localhost:${PORT}/identify`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────
  // Render.com (and Kubernetes) send SIGTERM when shutting down a container.
  // We stop accepting new connections, finish in-flight requests, then exit.
  async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n⚠️  Received ${signal}. Shutting down gracefully…`);

    server.close(async () => {
      console.log("   HTTP server closed.");

      try {
        await prisma.$disconnect();
        console.log("   Database disconnected.");
      } catch (err) {
        console.error("   Error disconnecting from database:", err);
      }

      console.log("👋 Process exiting cleanly.");
      process.exit(0);
    });

    // Force-exit if graceful shutdown takes too long (30 s)
    setTimeout(() => {
      console.error("⛔ Graceful shutdown timed out — forcing exit.");
      process.exit(1);
    }, 30_000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle unhandled promise rejections (last resort)
  process.on("unhandledRejection", (reason) => {
    console.error("🔥 Unhandled Rejection:", reason);
    // In production, let the process crash so the container restarts cleanly
    if (process.env.NODE_ENV === "production") process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error("💥 Fatal error during bootstrap:", err);
  process.exit(1);
});
