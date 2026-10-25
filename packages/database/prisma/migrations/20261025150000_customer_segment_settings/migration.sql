CREATE TABLE "CustomerSegmentSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSegmentSettings_pkey" PRIMARY KEY ("id")
);
