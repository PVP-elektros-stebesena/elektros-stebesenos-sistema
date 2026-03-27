-- CreateTable
CREATE TABLE "power_policy_overrides" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "maxActivePowerKw" REAL,
    "maxReactivePowerKvar" REAL,
    "minPowerFactor" REAL,
    "maxPhaseImbalancePct" REAL,
    "maxRampKwPerMinute" REAL,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "policyVersion" TEXT NOT NULL DEFAULT 'default-v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "power_policy_overrides_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_aggregated_data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "voltageL1" REAL,
    "voltageL2" REAL,
    "voltageL3" REAL,
    "outOfBoundsSecondsL1" INTEGER NOT NULL DEFAULT 0,
    "outOfBoundsSecondsL2" INTEGER NOT NULL DEFAULT 0,
    "outOfBoundsSecondsL3" INTEGER NOT NULL DEFAULT 0,
    "compliantL1" BOOLEAN NOT NULL DEFAULT true,
    "compliantL2" BOOLEAN NOT NULL DEFAULT true,
    "compliantL3" BOOLEAN NOT NULL DEFAULT true,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "activePowerAvgTotal" REAL,
    "activePowerMaxTotal" REAL,
    "reactivePowerAvgTotal" REAL,
    "reactivePowerMaxTotal" REAL,
    "apparentPowerAvgTotal" REAL,
    "apparentPowerMaxTotal" REAL,
    "powerFactorAvg" REAL,
    "activePowerAvgL1" REAL,
    "activePowerAvgL2" REAL,
    "activePowerAvgL3" REAL,
    "reactivePowerAvgL1" REAL,
    "reactivePowerAvgL2" REAL,
    "reactivePowerAvgL3" REAL,
    "powerImbalancePct" REAL,
    "powerPolicyBreached" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "aggregated_data_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_aggregated_data" ("compliantL1", "compliantL2", "compliantL3", "deviceId", "endsAt", "id", "outOfBoundsSecondsL1", "outOfBoundsSecondsL2", "outOfBoundsSecondsL3", "sampleCount", "startsAt", "voltageL1", "voltageL2", "voltageL3") SELECT "compliantL1", "compliantL2", "compliantL3", "deviceId", "endsAt", "id", "outOfBoundsSecondsL1", "outOfBoundsSecondsL2", "outOfBoundsSecondsL3", "sampleCount", "startsAt", "voltageL1", "voltageL2", "voltageL3" FROM "aggregated_data";
DROP TABLE "aggregated_data";
ALTER TABLE "new_aggregated_data" RENAME TO "aggregated_data";
CREATE INDEX "aggregated_data_deviceId_startsAt_idx" ON "aggregated_data"("deviceId", "startsAt");
CREATE UNIQUE INDEX "aggregated_data_deviceId_startsAt_endsAt_key" ON "aggregated_data"("deviceId", "startsAt", "endsAt");
CREATE TABLE "new_anomalies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "phase" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "minVoltage" REAL,
    "maxVoltage" REAL,
    "metricDomain" TEXT NOT NULL DEFAULT 'VOLTAGE',
    "metricName" TEXT,
    "thresholdValue" REAL,
    "observedMin" REAL,
    "observedMax" REAL,
    "observedAvg" REAL,
    "unit" TEXT,
    "duration" INTEGER,
    "description" TEXT,
    CONSTRAINT "anomalies_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_anomalies" ("description", "deviceId", "duration", "endsAt", "id", "maxVoltage", "minVoltage", "phase", "severity", "startsAt", "type") SELECT "description", "deviceId", "duration", "endsAt", "id", "maxVoltage", "minVoltage", "phase", "severity", "startsAt", "type" FROM "anomalies";
DROP TABLE "anomalies";
ALTER TABLE "new_anomalies" RENAME TO "anomalies";
CREATE INDEX "anomalies_deviceId_startsAt_idx" ON "anomalies"("deviceId", "startsAt");
CREATE INDEX "anomalies_deviceId_metricDomain_startsAt_idx" ON "anomalies"("deviceId", "metricDomain", "startsAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "power_policy_overrides_deviceId_effectiveFrom_enabled_idx" ON "power_policy_overrides"("deviceId", "effectiveFrom", "enabled");
