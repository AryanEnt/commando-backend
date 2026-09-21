import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env, isProd } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { requestTimeout } from "./middleware/requestTimeout.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { authRouter } from "./modules/auth/routes.js";
import {
  permissionsRouter,
  rolesRouter,
  usersRouter,
} from "./modules/users/routes.js";
import { teamsRouter } from "./modules/teams/routes.js";
import { profilesRouter } from "./modules/profiles/routes.js";
import { assignmentsRouter } from "./modules/assignments/routes.js";
import { referralsRouter } from "./modules/referrals/routes.js";
import { swotRouter } from "./modules/swot/routes.js";
import { activityTypesRouter } from "./modules/activity-types/routes.js";
import { dailyLogsRouter } from "./modules/daily-logs/routes.js";
import { weeklyReviewsRouter } from "./modules/weekly-reviews/routes.js";
import { uploadsRouter } from "./modules/uploads/routes.js";
import { monitoringRouter } from "./modules/monitoring/routes.js";
import { syncEvaluationsRouter } from "./modules/sync-evaluations/routes.js";
import { eisenhowerRouter } from "./modules/eisenhower/routes.js";
import { actionItemsRouter } from "./modules/action-items/routes.js";
import { supportTasksRouter } from "./modules/support-tasks/routes.js";
import { salesSupportLinksRouter } from "./modules/sales-support-links/routes.js";
import { feedbackRouter } from "./modules/feedback/routes.js";
import { performanceRouter } from "./modules/performance/routes.js";
import { reportsRouter } from "./modules/reports/routes.js";
import { auditLogsRouter } from "./modules/audit-logs/routes.js";
import { interventionsRouter } from "./modules/interventions/routes.js";
import { dashboardRouter } from "./modules/dashboard/routes.js";
import { workspaceEventsRouter } from "./modules/workspace-events/routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(requestTimeout);
  app.use(requestLogger);
  app.use(
    cors({
      origin: (origin, callback) => {
        const allowed = env.corsOrigin
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        // Same-origin / non-browser tools (no Origin header)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowed.includes(origin) || (!isProd && allowed.includes("*"))) {
          callback(null, true);
          return;
        }
        // Internal mesh / LAN Next.js on :3000|:3001 (e.g. http://10.80.80.225:3001)
        // Allowed even when NODE_ENV=production so HTTP mesh hosts keep working.
        if (
          /^http:\/\/(localhost|127\.0\.0\.1):(3000|3001)$/.test(origin) ||
          /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):(3000|3001)$/.test(
            origin,
          )
        ) {
          callback(null, true);
          return;
        }
        // Deny without throwing — throwing skips CORS headers and looks like a blank preflight failure
        logger.warn("cors_blocked", { origin });
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ready" });
    } catch (err) {
      logger.error("readiness_failed", { error: String(err) });
      res.status(503).json({ status: "not_ready" });
    }
  });

  app.use(
    "/api",
    rateLimit({
      windowMs: env.apiRateLimitWindowMs,
      max: env.apiRateLimitMax,
      keyPrefix: "api",
    }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/permissions", permissionsRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/profiles", profilesRouter);
  app.use("/api/assignments", assignmentsRouter);
  app.use("/api/referrals", referralsRouter);
  app.use("/api/swot", swotRouter);
  app.use("/api/activity-types", activityTypesRouter);
  app.use("/api/daily-logs", dailyLogsRouter);
  app.use("/api/weekly-reviews", weeklyReviewsRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/monitoring", monitoringRouter);
  app.use("/api/sync-evaluations", syncEvaluationsRouter);
  app.use("/api/eisenhower", eisenhowerRouter);
  app.use("/api/action-items", actionItemsRouter);
  app.use("/api/support-tasks", supportTasksRouter);
  app.use("/api/sales-support-links", salesSupportLinksRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/performance", performanceRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/audit-logs", auditLogsRouter);
  app.use("/api/interventions", interventionsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/workspace-events", workspaceEventsRouter);

  app.use(errorHandler);
  return app;
}
