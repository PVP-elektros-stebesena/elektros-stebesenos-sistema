-- CreateTable
CREATE TABLE "billing_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalKwh" REAL NOT NULL DEFAULT 0,
    "unallocatedKwh" REAL NOT NULL DEFAULT 0,
    "reportJson" TEXT NOT NULL,
    CONSTRAINT "billing_reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "billing_reports_deviceId_generatedAt_idx" ON "billing_reports"("deviceId", "generatedAt");
