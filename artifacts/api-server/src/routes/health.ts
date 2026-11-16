/*
 * © 2026 Age thirty4 technologies. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
