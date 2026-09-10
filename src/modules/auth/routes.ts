import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAuthentication } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { loginSchema, refreshSchema } from "./schemas.js";
import * as controller from "./controller.js";
import { env } from "../../config/env.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  rateLimit({
    windowMs: env.loginRateLimitWindowMs,
    max: env.loginRateLimitMax,
    keyPrefix: "login",
  }),
  validate(loginSchema),
  controller.login,
);
authRouter.post(
  "/refresh",
  rateLimit({
    windowMs: env.loginRateLimitWindowMs,
    max: env.loginRateLimitMax * 3,
    keyPrefix: "refresh",
  }),
  validate(refreshSchema),
  controller.refresh,
);
authRouter.post("/logout", requireAuthentication, controller.logout);
authRouter.get("/me", requireAuthentication, controller.me);
