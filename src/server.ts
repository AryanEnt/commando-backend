import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { disconnectPrisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.port, "0.0.0.0", () => {
  logger.info("api_started", {
    port: env.port,
    host: "0.0.0.0",
    env: env.nodeEnv,
  });
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_start", { signal });

  server.close((closeErr) => {
    void (async () => {
      try {
        await disconnectPrisma();
      } catch (err) {
        logger.error("prisma_disconnect_failed", { error: String(err) });
      }
      if (closeErr) {
        logger.error("http_close_failed", { error: String(closeErr) });
        process.exit(1);
      }
      logger.info("shutdown_complete");
      process.exit(0);
    })();
  });

  setTimeout(() => {
    logger.error("shutdown_timeout", { ms: env.shutdownTimeoutMs });
    process.exit(1);
  }, env.shutdownTimeoutMs).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
