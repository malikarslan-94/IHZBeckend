CREATE TABLE "RequestDraftCharges" (
    "requestId" INTEGER NOT NULL,
    "extraCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraChargesNote" TEXT,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(5,2),
    "notes" TEXT,
    CONSTRAINT "RequestDraftCharges_pkey" PRIMARY KEY ("requestId"),
    CONSTRAINT "RequestDraftCharges_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
