import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Per-user cache for authenticated GET responses.
 *
 * Correctness rests on the data epoch: every Prisma write that changes rows bumps it
 * (see lib/prisma.ts), which invalidates all entries at once, and a response is only
 * stored if no such write happened, and none was still running, while it was produced. Entries are keyed by user and role, so a
 * cached body is only ever replayed to the user it was built for, after that user
 * has passed live authentication again.
 *
 * State is per process: with several API processes, writes on one would not
 * invalidate another, so run a single API process or move this to a shared store.
 */

let epoch = 0;
let pendingWrites = 0;

/** Call around every DB write; responses are never stored while one is in flight. */
export function beginWrite(): void {
  pendingWrites += 1;
}

export function endWrite(changed: boolean): void {
  pendingWrites = Math.max(0, pendingWrites - 1);
  if (changed) epoch += 1;
}

type Entry = { epoch: number; expiresAt: number; body: unknown };

const MAX_ENTRIES = 2000;
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();

const UNCACHEABLE_PREFIXES = ["/api/auth", "/api/uploads"];

function isCacheable(req: Request): boolean {
  if (env.readCacheTtlMs <= 0 || req.method !== "GET") return false;
  return !UNCACHEABLE_PREFIXES.some((p) => req.originalUrl.startsWith(p));
}

function store(key: string, entry: Entry): void {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, e] of entries) {
    if (e.expiresAt <= now || e.epoch !== epoch) entries.delete(k);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function fresh(entry: Entry | null | undefined): entry is Entry {
  return Boolean(entry && entry.epoch === epoch && entry.expiresAt > Date.now());
}

function replay(res: Response, entry: Entry): void {
  res.setHeader("X-Read-Cache", "hit");
  res.status(200).json(entry.body);
}

/** Runs after authentication has set req.user; replays or records the response. */
export async function readThroughCache(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user || !isCacheable(req) || res.locals.readCacheSeen) {
    next();
    return;
  }
  res.locals.readCacheSeen = true;

  const key = `${req.user.id}:${req.user.roleId}:${req.originalUrl}`;
  const cached = entries.get(key);
  if (fresh(cached)) {
    replay(res, cached);
    return;
  }

  const startEpoch = epoch;
  const flightKey = `${startEpoch}:${key}`;
  const pending = inflight.get(flightKey);
  if (pending) {
    const shared = await pending;
    if (fresh(shared)) {
      replay(res, shared);
      return;
    }
    next();
    return;
  }

  let settle: (entry: Entry | null) => void = () => undefined;
  inflight.set(
    flightKey,
    new Promise<Entry | null>((resolve) => {
      settle = resolve;
    }),
  );
  const finish = (entry: Entry | null) => {
    inflight.delete(flightKey);
    settle(entry);
  };

  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode === 200 && epoch === startEpoch && pendingWrites === 0) {
      const entry: Entry = {
        epoch: startEpoch,
        expiresAt: Date.now() + env.readCacheTtlMs,
        body,
      };
      store(key, entry);
      finish(entry);
    } else {
      finish(null);
    }
    return json(body);
  };
  res.once("close", () => finish(null));

  next();
}

/** Test helper — drop all cached responses. */
export function clearReadCache(): void {
  entries.clear();
  inflight.clear();
}
