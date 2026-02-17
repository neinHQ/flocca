ALTER TABLE "User"
ADD COLUMN "planTier" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN "capabilityOverrides" JSONB;
