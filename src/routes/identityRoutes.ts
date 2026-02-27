/**
 * @file src/routes/identityRoutes.ts
 * @description Express router for identity-related endpoints.
 *
 * Keeping routes in a separate file from the app setup allows:
 *  - Clean mounting under a versioned prefix (e.g. /api/v1) if needed later.
 *  - Easy unit-testing of individual route handlers.
 */

import { Router } from "express";
import { identifyController } from "../controllers/identifyController";

const router = Router();

/**
 * POST /identify
 * Reconcile an incoming contact with existing records and return a
 * consolidated identity profile.
 */
router.post("/identify", identifyController);

export default router;
