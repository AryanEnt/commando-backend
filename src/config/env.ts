import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

function jwtSecret(name: string, fallback: string): string {
  const value = required(name, isProd ? undefined : fallback);
  if (isProd) {
    if (value.length < 32) {
      throw new Error(`${name} must be at least 32 characters in production`);
    }
    if (value.includes("change-me") || value.startsWith("dev-")) {
      throw new Error(
        `${name} must not use a development default in production`,
      );
    }
  }
  return value;
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    "DATABASE_URL",
    isProd
      ? undefined
      : "postgresql://commando:commando@localhost:5432/commando?schema=public",
  ),
  jwtAccessSecret: jwtSecret(
    "JWT_ACCESS_SECRET",
    "dev-access-secret-change-me",
  ),
  jwtRefreshSecret: jwtSecret(
    "JWT_REFRESH_SECRET",
    "dev-refresh-secret-change-me",
  ),
  accessTokenTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  refreshTokenTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  cookieSecure: process.env.COOKIE_SECURE === "true" || isProd,
  corsOrigin: isProd
    ? required("CORS_ORIGIN")
    : (process.env.CORS_ORIGIN ?? "http://localhost:3000"),
  accessCookieMaxAgeMs: Number(
    process.env.ACCESS_COOKIE_MAX_AGE_MS ?? 15 * 60 * 1000,
  ),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
  logLevel: (process.env.LOG_LEVEL ?? (isProd ? "info" : "debug")).toLowerCase(),
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000),
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 20),
  loginRateLimitWindowMs: Number(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000,
  ),
  apiRateLimitMax: Number(process.env.API_RATE_LIMIT_MAX ?? 300),
  apiRateLimitWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000),
  /** Cloudflare R2 (S3-compatible). Optional until upload is used. */
  r2AccountId: process.env.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2BucketName: process.env.R2_BUCKET_NAME ?? "",
  /** Optional public/custom domain base (no trailing slash). */
  r2PublicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
};

export { isProd };
