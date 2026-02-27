/**
 * @file src/services/identityService.ts
 * @description Core business logic for Identity Reconciliation.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  RECONCILIATION ALGORITHM — HIGH LEVEL                         │
 * │                                                                 │
 * │  1. Find all contacts matching the incoming email OR phone.     │
 * │  2. Resolve the absolute "root" primary of every match by       │
 * │     walking up the linkedId chain until we hit a primary with   │
 * │     linkedId = null.                                            │
 * │  3. Decide what to do:                                          │
 * │     a) No matches  → create a brand-new primary contact.        │
 * │     b) One cluster → new info? create secondary. else no-op.   │
 * │     c) Two clusters → merge: older primary wins, newer primary  │
 * │        (and all its secondaries) become secondaries of older.   │
 * │  4. Build & return the consolidated response.                   │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { Contact, LinkPrecedence, PrismaClient } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  ContactCluster,
  ConsolidatedContact,
  IdentifyRequest,
} from "../types/identity.types";

// ─── Repository helpers (thin DB access layer) ───────────────────────────────

/**
 * Finds all non-deleted contacts whose email OR phoneNumber matches
 * at least one of the provided values. Returns an empty array when
 * both arguments are null/undefined.
 */
async function findMatchingContacts(
  db: PrismaClient,
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<Contact[]> {
  const conditions: { email?: string; phoneNumber?: string }[] = [];

  if (email) conditions.push({ email });
  if (phoneNumber) conditions.push({ phoneNumber });

  if (conditions.length === 0) return [];

  return db.contact.findMany({
    where: {
      deletedAt: null,
      OR: conditions,
    },
    orderBy: { createdAt: "asc" }, // Oldest first — primary candidate is always first
  });
}

/**
 * Resolves the absolute root primary contact for a given contact row.
 *
 * A contact is a root primary when:
 *   - linkPrecedence === "primary" AND linkedId === null
 *
 * If the contact is itself a secondary, we look up its linkedId.
 * We recurse (or iterate) upward until we find the root. In a
 * well-maintained DB this is at most 2 hops, but we guard against
 * cycles with a visited-set just in case.
 */
async function resolveRootPrimary(
  db: PrismaClient,
  contact: Contact
): Promise<Contact> {
  const visited = new Set<number>();
  let current = contact;

  while (current.linkedId !== null || current.linkPrecedence !== LinkPrecedence.primary) {
    // Guard: if already a primary with no linkedId, we're done
    if (current.linkPrecedence === LinkPrecedence.primary && current.linkedId === null) {
      break;
    }

    const parentId = current.linkedId;

    if (parentId === null) {
      // Inconsistent state: secondary with no linkedId — treat it as primary
      break;
    }

    if (visited.has(parentId)) {
      // Cycle guard — should never happen in a healthy DB
      break;
    }

    visited.add(current.id);

    const parent = await db.contact.findUnique({ where: { id: parentId } });

    if (!parent) {
      // Orphaned secondary — treat current as root
      break;
    }

    current = parent;
  }

  return current;
}

/**
 * Fetches all secondary contacts whose root primary is `primaryId`.
 * This includes contacts that directly point to `primaryId` and any
 * that might (due to past merges) point to a secondary that points
 * to `primaryId` — we flatten the entire cluster here.
 */
async function fetchAllSecondaries(
  db: PrismaClient,
  primaryId: number
): Promise<Contact[]> {
  // Direct secondaries
  const direct = await db.contact.findMany({
    where: {
      linkedId: primaryId,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });

  // Recursively fetch any "orphaned" secondaries that point to one of the direct secondaries
  // (can happen when two clusters are merged and some rows still have stale linkedIds)
  const nested: Contact[] = [];
  for (const sec of direct) {
    const children = await db.contact.findMany({
      where: {
        linkedId: sec.id,
        deletedAt: null,
      },
    });
    nested.push(...children);
  }

  return [...direct, ...nested];
}

// ─── Cluster builder ──────────────────────────────────────────────────────────

/**
 * Given a root primary contact, loads the full cluster (primary + all secondaries).
 */
async function buildCluster(
  db: PrismaClient,
  primary: Contact
): Promise<ContactCluster> {
  const secondaries = await fetchAllSecondaries(db, primary.id);
  return { primary, secondaries };
}

// ─── Response formatter ───────────────────────────────────────────────────────

/**
 * Converts a ContactCluster into the API response shape.
 *
 * Rules:
 *  - Primary's email/phone come FIRST in their respective arrays.
 *  - All values are unique (deduped with a Set).
 *  - Null / undefined values are excluded.
 */
function formatClusterResponse(cluster: ContactCluster): ConsolidatedContact {
  const { primary, secondaries } = cluster;

  // Start with primary's values (they must appear first)
  const emailSet = new Set<string>();
  const phoneSet = new Set<string>();

  if (primary.email) emailSet.add(primary.email);
  if (primary.phoneNumber) phoneSet.add(primary.phoneNumber);

  for (const sec of secondaries) {
    if (sec.email) emailSet.add(sec.email);
    if (sec.phoneNumber) phoneSet.add(sec.phoneNumber);
  }

  return {
    primaryContatctId: primary.id, // Intentional typo — matches the API spec
    emails: Array.from(emailSet),
    phoneNumbers: Array.from(phoneSet),
    secondaryContactIds: secondaries.map((s) => s.id),
  };
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Reconciles an incoming identify request against existing contacts.
 *
 * All DB mutations are wrapped in a serializable transaction to prevent
 * race conditions when two concurrent requests arrive with overlapping
 * contact information.
 *
 * @param request - Validated identify request (email and/or phoneNumber)
 * @returns The consolidated contact response payload
 */
export async function reconcileIdentity(
  request: IdentifyRequest
): Promise<ConsolidatedContact> {
  const { email, phoneNumber } = request;

  return prisma.$transaction(
    async (tx) => {
      // Cast tx to PrismaClient — the interactive transaction client is
      // fully compatible; this cast avoids TypeScript inference issues.
      const db = tx as unknown as PrismaClient;

      // ── Step 1: Find all contacts that match on email OR phone ──────────
      const matches = await findMatchingContacts(db, email, phoneNumber);

      // ── Step 2: Brand-new customer — no matches at all ──────────────────
      if (matches.length === 0) {
        const newContact = await db.contact.create({
          data: {
            email: email ?? null,
            phoneNumber: phoneNumber ?? null,
            linkPrecedence: LinkPrecedence.primary,
            linkedId: null,
          },
        });

        return formatClusterResponse({ primary: newContact, secondaries: [] });
      }

      // ── Step 3: Resolve root primaries for every matched contact ─────────
      // Multiple matches may belong to different clusters. We collect unique
      // root primaries using a Map keyed by primary ID.
      const rootPrimaryMap = new Map<number, Contact>();

      for (const match of matches) {
        const root = await resolveRootPrimary(db, match);
        rootPrimaryMap.set(root.id, root);
      }

      const rootPrimaries = Array.from(rootPrimaryMap.values()).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      // ── Step 4: Determine the definitive primary (oldest) ─────────────────
      const truePrimary = rootPrimaries[0]; // Oldest contact always wins

      // ── Step 5: Merge any additional root primaries into the true primary ─
      // If the request bridged two previously separate clusters (e.g., email
      // from cluster A and phoneNumber from cluster B), we must demote all
      // other root primaries (and re-link their secondaries) to the true primary.
      if (rootPrimaries.length > 1) {
        for (let i = 1; i < rootPrimaries.length; i++) {
          const demoted = rootPrimaries[i];

          // Demote the root primary itself
          await db.contact.update({
            where: { id: demoted.id },
            data: {
              linkPrecedence: LinkPrecedence.secondary,
              linkedId: truePrimary.id,
              updatedAt: new Date(),
            },
          });

          // Re-link all direct secondaries of the demoted primary to truePrimary
          await db.contact.updateMany({
            where: {
              linkedId: demoted.id,
              deletedAt: null,
            },
            data: {
              linkedId: truePrimary.id,
              updatedAt: new Date(),
            },
          });
        }
      }

      // ── Step 6: Check whether the request introduces new information ──────
      // Reload the full cluster now that merges (if any) have been applied.
      const cluster = await buildCluster(db, truePrimary);
      const allInCluster = [cluster.primary, ...cluster.secondaries];

      const emailKnown =
        !email || allInCluster.some((c) => c.email === email);
      const phoneKnown =
        !phoneNumber || allInCluster.some((c) => c.phoneNumber === phoneNumber);

      if (!emailKnown || !phoneKnown) {
        // The request contains at least one piece of contact info not yet
        // recorded — create a secondary contact to capture it.
        const newSecondary = await db.contact.create({
          data: {
            email: email ?? null,
            phoneNumber: phoneNumber ?? null,
            linkPrecedence: LinkPrecedence.secondary,
            linkedId: truePrimary.id,
          },
        });

        cluster.secondaries.push(newSecondary);
      }

      // ── Step 7: Build and return the consolidated response ────────────────
      return formatClusterResponse(cluster);
    },
    {
      // Serializable isolation prevents phantom reads / write skews
      // when two concurrent requests touch overlapping contacts.
      isolationLevel: "Serializable",
    }
  );
}
