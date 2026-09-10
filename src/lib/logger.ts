type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[configuredLevel()];
}

function write(level: LogLevel, message: string, extra?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) =>
    write("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>) =>
    write("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>) =>
    write("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>) =>
    write("error", message, extra),
};
