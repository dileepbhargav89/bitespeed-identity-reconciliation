/**
 * @file src/types/identity.types.ts
 * @description Shared TypeScript types and interfaces for the Identity
 * Reconciliation feature. Keeping types in a dedicated file decouples
 * the controller, service, and repository layers, making each easier
 * to test and refactor independently.
 */

import { Contact, LinkPrecedence } from "@prisma/client";

// ─── Re-export Prisma types we use throughout the app ───────────────────────

export { Contact, LinkPrecedence };

// ─── Request / Response shapes ───────────────────────────────────────────────

/**
 * The validated, normalised body of a POST /identify request.
 * At least one of `email` or `phoneNumber` must be present (enforced
 * by the controller before it reaches the service).
 */
export interface IdentifyRequest {
  email?: string | null;
  phoneNumber?: string | null; // Always stored as a string internally
}

/**
 * The consolidated contact payload returned to the caller.
 * Note: the spec spells "primaryContatctId" (single-t typo kept intentionally
 * to match the required API contract).
 */
export interface ConsolidatedContact {
  primaryContatctId: number;
  emails: string[];        // Primary email first, then secondary emails (unique)
  phoneNumbers: string[];  // Primary phone first, then secondary phones (unique)
  secondaryContactIds: number[];
}

/**
 * The top-level HTTP response envelope for POST /identify.
 */
export interface IdentifyResponse {
  contact: ConsolidatedContact;
}

// ─── Internal service types ───────────────────────────────────────────────────

/**
 * The resolved "root" of a contact cluster: the definitive primary contact
 * and every secondary contact linked to it (including transitively-linked ones).
 */
export interface ContactCluster {
  primary: Contact;
  secondaries: Contact[];
}
