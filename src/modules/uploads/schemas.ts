import { randomUUID } from "node:crypto";
import { z } from "zod";

const MAX_MINUTES_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MINUTES_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/** Content type → allowed file extensions for intervention supporting evidence. */
const EVIDENCE_TYPES: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-excel": ["xls", "csv"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/msword": ["doc"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

export const UPLOAD_PURPOSES = [
  "weekly-review-minutes",
  "support-task-image",
  "action-item-image",
  "daily-log-image",
  "daily-work-log-image",
  "intervention-evidence",
  "handoff-report",
] as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const presignUploadSchema = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    contentLength: z.number().int().positive().max(MAX_MINUTES_BYTES),
  })
  .strict();

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

export function assertAllowedMinutesUpload(input: {
  contentType: string;
  contentLength: number;
}): void {
  if (!MINUTES_CONTENT_TYPES.has(input.contentType)) {
    throw new Error(
      "Unsupported file type. Use PDF, Word, text, PNG, JPEG, or WebP.",
    );
  }
  if (input.contentLength > MAX_MINUTES_BYTES) {
    throw new Error("File must be 10 MB or smaller.");
  }
}

export function assertAllowedImageUpload(input: {
  contentType: string;
  contentLength: number;
}): void {
  if (!IMAGE_CONTENT_TYPES.has(input.contentType)) {
    throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF.");
  }
  if (input.contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Image must be 10 MB or smaller.");
  }
}

/** @deprecated use assertAllowedImageUpload */
export const assertAllowedSupportTaskImageUpload = assertAllowedImageUpload;

export function buildWeeklyReviewMinutesKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `weekly-reviews/minutes/${userId}/${randomUUID()}-${safe || "minutes"}`;
}

export function isOwnedWeeklyReviewMinutesKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`weekly-reviews/minutes/${userId}/`);
}

export function buildSupportTaskImageKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `support-tasks/images/${userId}/${randomUUID()}-${safe || "screenshot"}`;
}

export function isOwnedSupportTaskImageKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`support-tasks/images/${userId}/`);
}

export function buildActionItemImageKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `action-items/images/${userId}/${randomUUID()}-${safe || "screenshot"}`;
}

export function isOwnedActionItemImageKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`action-items/images/${userId}/`);
}

export function buildDailyLogImageKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `daily-logs/images/${userId}/${randomUUID()}-${safe || "screenshot"}`;
}

export function isOwnedDailyLogImageKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`daily-logs/images/${userId}/`);
}

export function buildDailyWorkLogImageKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `daily-work-logs/images/${userId}/${randomUUID()}-${safe || "screenshot"}`;
}

export function isOwnedDailyWorkLogImageKey(
  key: string,
  userId: string,
): boolean {
  return key.startsWith(`daily-work-logs/images/${userId}/`);
}

export function assertAllowedEvidenceUpload(input: {
  contentType: string;
  contentLength: number;
  fileName?: string;
}): void {
  const extensions = EVIDENCE_TYPES[input.contentType];
  const ext = input.fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (!extensions || (input.fileName !== undefined && !extensions.includes(ext))) {
    throw new Error(
      "Unsupported file type. Use PDF, Excel (XLSX/XLS), CSV, Word (DOCX/DOC), JPG, or PNG.",
    );
  }
  if (input.contentLength > MAX_EVIDENCE_BYTES) {
    throw new Error("File must be 10 MB or smaller.");
  }
}

export function buildInterventionEvidenceKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `interventions/evidence/${userId}/${randomUUID()}-${safe || "document"}`;
}

export function isOwnedInterventionEvidenceKey(
  key: string,
  userId: string,
): boolean {
  return (
    key.startsWith(`interventions/evidence/${userId}/`) && !key.includes("..")
  );
}

export function buildHandoffReportKey(
  userId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `interventions/handoff-reports/${userId}/${randomUUID()}-${safe || "document"}`;
}

export function isOwnedHandoffReportKey(
  key: string,
  userId: string,
): boolean {
  return (
    key.startsWith(`interventions/handoff-reports/${userId}/`) &&
    !key.includes("..")
  );
}

export const MAX_MINUTES_BYTES_EXPORT = MAX_MINUTES_BYTES;
export const MAX_IMAGE_BYTES_EXPORT = MAX_IMAGE_BYTES;
