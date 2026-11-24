-- CreateTable
CREATE TABLE "ChargeItem" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "defaultRate" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestCharge" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "chargeItemId" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,

    CONSTRAINT "RequestCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargeItem_name_key" ON "ChargeItem"("name");

-- CreateIndex
CREATE INDEX "RequestCharge_requestId_idx" ON "RequestCharge"("requestId");

-- AddForeignKey
ALTER TABLE "RequestCharge" ADD CONSTRAINT "RequestCharge_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCharge" ADD CONSTRAINT "RequestCharge_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing extra charges become one custom line each, so every bill prints the same way.
-- A billed request takes the amount from its bill (bill edits don't touch the draft).
INSERT INTO "RequestCharge" ("requestId", "description", "quantity", "rate", "amount", "sortOrder")
SELECT b."requestId", COALESCE(NULLIF(TRIM(b."extraChargesNote"), ''), 'Extra charges'), 1, b."extraCharges", b."extraCharges", 0
FROM "Bill" b
WHERE b."extraCharges" > 0;

INSERT INTO "RequestCharge" ("requestId", "description", "quantity", "rate", "amount", "sortOrder")
SELECT d."requestId", COALESCE(NULLIF(TRIM(d."extraChargesNote"), ''), 'Extra charges'), 1, d."extraCharges", d."extraCharges", 0
FROM "RequestDraftCharges" d
WHERE d."extraCharges" > 0
  AND NOT EXISTS (SELECT 1 FROM "Bill" b WHERE b."requestId" = d."requestId");
