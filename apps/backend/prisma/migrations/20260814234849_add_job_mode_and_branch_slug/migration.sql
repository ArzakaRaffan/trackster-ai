-- CreateEnum
CREATE TYPE "JobMode" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "mode" "JobMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "branchSlug" TEXT,
ADD COLUMN     "reviewVerdict" TEXT,
ADD COLUMN     "reviewReasoning" TEXT,
ADD COLUMN     "merged" BOOLEAN NOT NULL DEFAULT false;
