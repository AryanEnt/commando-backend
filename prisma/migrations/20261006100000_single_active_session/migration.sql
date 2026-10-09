-- Single active session per user: a new login invalidates tokens from older sessions.

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RefreshToken" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
