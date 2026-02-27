/**
 * @file src/middleware/errorHandler.ts
 * @description Centralised Express error-handling middleware.
 *
 * Any controller or service that calls `next(error)` will land here.
 * This keeps error formatting consistent across the entire API and
 * prevents stack traces from leaking into production responses.
 */

import { Request, Response, NextFunction } from "express";

/**
 * A structured error that services can throw to communicate a specific
 * HTTP status code and message back to the client without exposing
 * internal implementation details.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly isOperational = true
  ) {
    super(message);
    this.name = "AppError";
    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handler. Must be registered AFTER all routes.
 * Express identifies it as an error handler by its 4-argument signature.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === "production";

  // Operational errors (thrown intentionally) — safe to expose message
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
    });
    return;
  }

  // Unexpected / programming errors — log the stack, return generic message
  console.error("[UNHANDLED ERROR]", err);

  res.status(500).json({
    error: "Internal Server Error",
    message: isProduction
      ? "An unexpected error occurred. Please try again later."
      : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

/**
 * Middleware to handle requests for routes that don't exist.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "Not Found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}
