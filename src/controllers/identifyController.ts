/**
 * @file src/controllers/identifyController.ts
 * @description HTTP controller for the POST /identify endpoint.
 *
 * Responsibilities:
 *  1. Parse and validate the incoming request body.
 *  2. Normalise types (phoneNumber may arrive as a number or string).
 *  3. Delegate business logic to the identity service.
 *  4. Format and send the HTTP response.
 *  5. Handle errors gracefully (validation vs. unexpected).
 *
 * The controller is intentionally "thin" — it contains no business logic.
 * All reconciliation decisions live in `identityService.ts`.
 */

import { Request, Response, NextFunction } from "express";
import { reconcileIdentity } from "../services/identityService";
import { IdentifyRequest, IdentifyResponse } from "../types/identity.types";

// ─── Type guard helpers ───────────────────────────────────────────────────────

/**
 * Returns true when `value` is a non-empty string after trimming.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Normalises a phoneNumber field that the spec says may be sent
 * as either a number (e.g. 123456) or a string ("123456").
 * Returns a trimmed string, or null if the value is absent / invalid.
 */
function normalisePhoneNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    return String(raw).trim();
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  return null;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * POST /identify
 *
 * Accepts a JSON body with optional `email` and `phoneNumber` fields.
 * At least one must be present.
 *
 * Returns 200 with a consolidated contact object on success.
 * Returns 400 for bad input, 500 for unexpected server errors.
 */
export async function identifyController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email: rawEmail, phoneNumber: rawPhone } = req.body as Record<
      string,
      unknown
    >;

    // ── Normalise ──────────────────────────────────────────────────────────
    const email: string | null = isNonEmptyString(rawEmail)
      ? rawEmail.trim().toLowerCase()
      : null;

    const phoneNumber: string | null = normalisePhoneNumber(rawPhone);

    // ── Validate: at least one identifier must be provided ─────────────────
    if (!email && !phoneNumber) {
      res.status(400).json({
        error: "Bad Request",
        message:
          "At least one of 'email' or 'phoneNumber' must be provided in the request body.",
      });
      return;
    }

    // ── Basic email format check (lightweight — not RFC 5321 pedantic) ─────
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: "Bad Request",
        message: "The provided 'email' value is not a valid email address.",
      });
      return;
    }

    // ── Delegate to service ────────────────────────────────────────────────
    const request: IdentifyRequest = { email, phoneNumber };
    const consolidatedContact = await reconcileIdentity(request);

    const responseBody: IdentifyResponse = { contact: consolidatedContact };

    res.status(200).json(responseBody);
  } catch (error) {
    // Forward to the global error handler (defined in index.ts)
    next(error);
  }
}
