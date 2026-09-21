import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { badRequest } from "./errors.js";

export function isR2Configured(): boolean {
  return Boolean(
    env.r2AccountId &&
      env.r2AccessKeyId &&
      env.r2SecretAccessKey &&
      env.r2BucketName,
  );
}

function requireR2Configured(): void {
  if (!isR2Configured()) {
    throw badRequest(
      "File uploads are not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }
}

function getClient(): S3Client {
  requireR2Configured();
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
  });
}

export async function createPresignedPutUrl(input: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: env.r2BucketName,
    Key: input.key,
    ContentType: input.contentType,
  });
  return getSignedUrl(client, command, {
    expiresIn: input.expiresInSeconds ?? 600,
  });
}

export async function createPresignedGetUrl(input: {
  key: string;
  fileName?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: env.r2BucketName,
    Key: input.key,
    ResponseContentDisposition: input.fileName
      ? `attachment; filename="${input.fileName.replace(/"/g, "")}"`
      : undefined,
  });
  return getSignedUrl(client, command, {
    expiresIn: input.expiresInSeconds ?? 600,
  });
}

export function publicObjectUrl(key: string): string | null {
  if (!env.r2PublicBaseUrl) return null;
  return `${env.r2PublicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
