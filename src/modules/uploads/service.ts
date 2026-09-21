import type { Actor } from "../../lib/authorization.js";
import { badRequest } from "../../lib/errors.js";
import { createPresignedPutUrl } from "../../lib/r2.js";
import {
  assertAllowedMinutesUpload,
  buildWeeklyReviewMinutesKey,
  type PresignUploadInput,
} from "./schemas.js";

export async function presignUpload(actor: Actor, input: PresignUploadInput) {
  try {
    assertAllowedMinutesUpload({
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Invalid upload");
  }

  if (input.purpose !== "weekly-review-minutes") {
    throw badRequest("Unsupported upload purpose");
  }

  const key = buildWeeklyReviewMinutesKey(actor.id, input.fileName);
  const uploadUrl = await createPresignedPutUrl({
    key,
    contentType: input.contentType,
  });

  return {
    key,
    uploadUrl,
    headers: {
      "Content-Type": input.contentType,
    },
    expiresInSeconds: 600,
  };
}
