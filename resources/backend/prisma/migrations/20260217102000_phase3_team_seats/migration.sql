ALTER TABLE "Team"
ADD COLUMN "billingUserId" TEXT,
ADD COLUMN "seatPlan" TEXT NOT NULL DEFAULT 'free';

ALTER TABLE "TeamMember"
ADD COLUMN "assignedSkus" JSONB DEFAULT '[]'::jsonb;

ALTER TABLE "Team"
ADD CONSTRAINT "Team_billingUserId_fkey"
FOREIGN KEY ("billingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
