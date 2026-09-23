import type { Actor } from "../../lib/authorization.js";
import { hasPermission } from "../../lib/authorization.js";
import { badRequest, forbidden } from "../../lib/errors.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { createPresignedPutUrl, putObjectBytes } from "../../lib/r2.js";
import {
  assertAllowedImageUpload,
  assertAllowedMinutesUpload,
  buildActionItemImageKey,
  buildSupportTaskImageKey,
  buildWeeklyReviewMinutesKey,
  UPLOAD_PURPOSES,
  type PresignUploadInput,
  type UploadPurpose,
} from "./schemas.js";

function assertCanUpload(actor: Actor, purpose: UploadPurpose) {
  if (purpose === "weekly-review-minutes") {
    if (!hasPermission(actor, PERMISSIONS.WEEKLY_REVIEW_CREATE)) {
      throw forbidden("Not allowed to upload weekly review minutes");
    }
    return;
  }

  if (purpose === "support-task-image") {
    if (!hasPermission(actor, PERMISSIONS.SALES_SUPPORT_TASK_VIEW)) {
      throw forbidden("Not allowed to upload support task images");
    }
    if (
      actor.roleCode !== "SALES_EXECUTIVE" &&
      actor.roleCode !== "SALES_SUPPORT_EXECUTIVE"
    ) {
      throw forbidden(
        "Only Sales Executives and Sales Support may upload screenshots",
      );
    }
    return;
  }

  if (purpose === "action-item-image") {
    if (!hasPermission(actor, PERMISSIONS.ACTION_ITEM_VIEW)) {
      throw forbidden("Not allowed to upload assignment screenshots");
    }
    if (
      actor.roleCode !== "SALES_EXECUTIVE" &&
      actor.roleCode !== "COMMANDO_EXECUTIVE" &&
      actor.roleCode !== "TEAM_LEAD" &&
      !hasPermission(actor, PERMISSIONS.ACTION_ITEM_UPDATE)
    ) {
      throw forbidden("Not allowed to upload assignment screenshots");
    }
    return;
  }

  throw badRequest("Unsupported upload purpose");
}

function buildKey(purpose: UploadPurpose, actorId: string, fileName: string) {
  if (purpose === "weekly-review-minutes") {
    return buildWeeklyReviewMinutesKey(actorId, fileName);
  }
  if (purpose === "support-task-image") {
    return buildSupportTaskImageKey(actorId, fileName);
  }
  return buildActionItemImageKey(actorId, fileName);
}

function assertContent(
  purpose: UploadPurpose,
  contentType: string,
  contentLength: number,
) {
  try {
    if (purpose === "weekly-review-minutes") {
      assertAllowedMinutesUpload({ contentType, contentLength });
    } else {
      assertAllowedImageUpload({ contentType, contentLength });
    }
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Invalid upload");
  }
}

export async function presignUpload(actor: Actor, input: PresignUploadInput) {
  assertCanUpload(actor, input.purpose);
  assertContent(input.purpose, input.contentType, input.contentLength);

  const key = buildKey(input.purpose, actor.id, input.fileName);
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

export async function uploadObject(
  actor: Actor,
  input: {
    purpose: UploadPurpose;
    fileName: string;
    contentType: string;
    body: Buffer;
  },
) {
  if (!(UPLOAD_PURPOSES as readonly string[]).includes(input.purpose)) {
    throw badRequest("Unsupported upload purpose");
  }
  assertCanUpload(actor, input.purpose);
  assertContent(input.purpose, input.contentType, input.body.byteLength);

  const key = buildKey(input.purpose, actor.id, input.fileName);
  await putObjectBytes({
    key,
    contentType: input.contentType,
    body: input.body,
  });

  return {
    key,
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.body.byteLength,
  };
}
