/**
 * @file src/app.ts
 * @description Express application factory.
 *
 * Separating the app construction from the server startup (src/index.ts)
 * is a standard practice that makes the app easy to import in tests
 * without actually binding to a port.
 */

import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import identityRoutes from "./routes/identityRoutes";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./middleware/errorHandler";

/**
 * Builds and configures the Express application instance.
 * @returns Configured Express app (not yet listening on a port)
 */
export function createApp(): Application {
  const app = express();

  // ── Security middleware ─────────────────────────────────────────────────
  // helmet sets sensible HTTP security headers (HSTS, XSS filter, etc.)
  app.use(helmet());

  // cors allows cross-origin requests; tighten allowedOrigins in production
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",")
        : "*",
      methods: ["GET", "POST"],
    })
  );

  // ── Logging ─────────────────────────────────────────────────────────────
  const logFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
  app.use(morgan(logFormat));

  // ── Body parsing ────────────────────────────────────────────────────────
  app.use(express.json({ limit: "10kb" })); // 10 kb body limit as a safeguard
  app.use(express.urlencoded({ extended: true }));

  // ── Health check ────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      service: "bitespeed-identity-reconciliation",
      timestamp: new Date().toISOString(),
    });
  });

  // ── API routes ──────────────────────────────────────────────────────────
  app.use("/", identityRoutes);

  // ── 404 handler (must come after all routes) ────────────────────────────
  app.use(notFoundHandler);

  // ── Global error handler (must be last, 4-argument signature) ───────────
  app.use(globalErrorHandler);

  return app;
}
