import { Router } from "express";

export const readiness = { isReady: false };

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  if (readiness.isReady) {
    res.status(200).json({ status: "ok" });
  } else {
    res.status(503).json({ status: "not_ready" });
  }
});
