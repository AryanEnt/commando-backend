import { randomUUID } from "node:crypto";
import { z } from "zod";

const MAX_MINUTES_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const presignUploadSchema = z
  .object({
    purpose: z.literal("weekly-review-minutes"),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    contentLength: z.number().int().positive().max(MAX_MINUTES_BYTES),
  })
  .strict();

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export function assertAllowedMinutesUpload(input: {
  contentType: string;
  contentLength: number;
}): void {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    throw new Error(
      "Unsupported file type. Use PDF, Word, text, PNG, JPEG, or WebP.",
    );
  }
  if (input.contentLength > MAX_MINUTES_BYTES) {
    throw new Error("File must be 10 MB or smaller.");
  }
}

export function buildWeeklyReviewMinutesKey(
  userId: string,
  fileName: string,
): string {
  const safe = fileName
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return `weekly-reviews/minutes/${userId}/${randomUUID()}-${safe || "minutes"}`;
}

export function isOwnedWeeklyReviewMinutesKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`weekly-reviews/minutes/${userId}/`);
}

export const MAX_MINUTES_BYTES_EXPORT = MAX_MINUTES_BYTES;
