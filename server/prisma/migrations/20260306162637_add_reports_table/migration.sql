-- CreateTable
CREATE TABLE "reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "periodType" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "totalWindows" INTEGER NOT NULL,
    "compliantWindowsL1" INTEGER NOT NULL DEFAULT 0,
    "compliantWindowsL2" INTEGER NOT NULL DEFAULT 0,
    "compliantWindowsL3" INTEGER NOT NULL DEFAULT 0,
    "compliancePctL1" REAL NOT NULL DEFAULT 0,
    "compliancePctL2" REAL NOT NULL DEFAULT 0,
    "compliancePctL3" REAL NOT NULL DEFAULT 0,
    "overallCompliant" BOOLEAN NOT NULL DEFAULT false,
    "healthScore" TEXT NOT NULL,
    "anomalySummary" TEXT NOT NULL DEFAULT '[]',
    "totalAnomalies" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "reports_deviceId_createdAt_idx" ON "reports"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reports_deviceId_periodType_startsAt_endsAt_key" ON "reports"("deviceId", "periodType", "startsAt", "endsAt");
