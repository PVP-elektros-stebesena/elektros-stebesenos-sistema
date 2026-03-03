-- CreateTable
CREATE TABLE "devices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "deviceIp" TEXT,
    "mqttBroker" TEXT,
    "mqttPort" INTEGER,
    "mqttTopic" TEXT,
    "pollInterval" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "readings" (
    "deviceId" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "electricityTariff" INTEGER,
    "electricityDelivered1" REAL,
    "electricityReturned1" REAL,
    "electricityDelivered2" REAL,
    "electricityReturned2" REAL,
    "powerDelivered" REAL,
    "powerReturned" REAL,
    "powerDeliveredL1" REAL,
    "powerDeliveredL2" REAL,
    "powerDeliveredL3" REAL,
    "powerReturnedL1" REAL,
    "powerReturnedL2" REAL,
    "powerReturnedL3" REAL,
    "voltageL1" REAL,
    "voltageL2" REAL,
    "voltageL3" REAL,
    "currentL1" REAL,
    "currentL2" REAL,
    "currentL3" REAL,
    "frequency" REAL,

    PRIMARY KEY ("deviceId", "timestamp"),
    CONSTRAINT "readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "aggregated_data" (
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
    CONSTRAINT "aggregated_data_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "weekly_report" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "totalWindows" INTEGER NOT NULL,
    "compliantWindowsL1" INTEGER NOT NULL DEFAULT 0,
    "compliantWindowsL2" INTEGER NOT NULL DEFAULT 0,
    "compliantWindowsL3" INTEGER NOT NULL DEFAULT 0,
    "compliantPctL1" REAL NOT NULL DEFAULT 0,
    "compliantPctL2" REAL NOT NULL DEFAULT 0,
    "compliantPctL3" REAL NOT NULL DEFAULT 0,
    "overallCompliant" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "weekly_report_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anomalies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "phase" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "minVoltage" REAL,
    "maxVoltage" REAL,
    "duration" INTEGER,
    "description" TEXT,
    CONSTRAINT "anomalies_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "readings_deviceId_timestamp_idx" ON "readings"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "aggregated_data_deviceId_startsAt_idx" ON "aggregated_data"("deviceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "aggregated_data_deviceId_startsAt_endsAt_key" ON "aggregated_data"("deviceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "weekly_report_deviceId_startsAt_idx" ON "weekly_report"("deviceId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_report_deviceId_startsAt_endsAt_key" ON "weekly_report"("deviceId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "anomalies_deviceId_startsAt_idx" ON "anomalies"("deviceId", "startsAt");
