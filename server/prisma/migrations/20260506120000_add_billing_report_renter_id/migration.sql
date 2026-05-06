-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_billing_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "renterId" INTEGER,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalKwh" REAL NOT NULL DEFAULT 0,
    "unallocatedKwh" REAL NOT NULL DEFAULT 0,
    "reportJson" TEXT NOT NULL,
    CONSTRAINT "billing_reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "billing_reports_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "renters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_billing_reports" ("id", "deviceId", "renterId", "startsAt", "endsAt", "generatedAt", "totalKwh", "unallocatedKwh", "reportJson")
SELECT "id", "deviceId", NULL, "startsAt", "endsAt", "generatedAt", "totalKwh", "unallocatedKwh", "reportJson" FROM "billing_reports";
DROP TABLE "billing_reports";
ALTER TABLE "new_billing_reports" RENAME TO "billing_reports";
CREATE INDEX "billing_reports_deviceId_generatedAt_idx" ON "billing_reports"("deviceId", "generatedAt");
CREATE INDEX "billing_reports_deviceId_renterId_generatedAt_idx" ON "billing_reports"("deviceId", "renterId", "generatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
