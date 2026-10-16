CREATE TABLE "CustomerComment" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerComment_customerId_createdAt_idx" ON "CustomerComment"("customerId", "createdAt");

ALTER TABLE "CustomerComment" ADD CONSTRAINT "CustomerComment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerComment" ADD CONSTRAINT "CustomerComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
