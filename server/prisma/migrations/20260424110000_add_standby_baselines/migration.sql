CREATE TABLE "standby_baselines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "baselineDate" TEXT NOT NULL,
    "baselinePowerKw" REAL NOT NULL,
    "windowStartsAt" DATETIME NOT NULL,
    "windowEndsAt" DATETIME NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "standby_baselines_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "standby_baselines_deviceId_baselineDate_key"
  ON "standby_baselines"("deviceId", "baselineDate");
CREATE INDEX "standby_baselines_deviceId_computedAt_idx"
  ON "standby_baselines"("deviceId", "computedAt");
