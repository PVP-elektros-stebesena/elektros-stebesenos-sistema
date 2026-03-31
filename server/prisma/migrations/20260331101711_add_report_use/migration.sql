-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "reportUse" TEXT NOT NULL DEFAULT 'home',
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
INSERT INTO "new_reports" ("anomalySummary", "compliancePctL1", "compliancePctL2", "compliancePctL3", "compliantWindowsL1", "compliantWindowsL2", "compliantWindowsL3", "createdAt", "criticalCount", "deviceId", "endsAt", "healthScore", "id", "overallCompliant", "periodType", "startsAt", "totalAnomalies", "totalWindows", "warningCount") SELECT "anomalySummary", "compliancePctL1", "compliancePctL2", "compliancePctL3", "compliantWindowsL1", "compliantWindowsL2", "compliantWindowsL3", "createdAt", "criticalCount", "deviceId", "endsAt", "healthScore", "id", "overallCompliant", "periodType", "startsAt", "totalAnomalies", "totalWindows", "warningCount" FROM "reports";
DROP TABLE "reports";
ALTER TABLE "new_reports" RENAME TO "reports";
CREATE INDEX "reports_deviceId_createdAt_idx" ON "reports"("deviceId", "createdAt");
CREATE UNIQUE INDEX "reports_deviceId_reportUse_periodType_startsAt_endsAt_key" ON "reports"("deviceId", "reportUse", "periodType", "startsAt", "endsAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
