CREATE TABLE "usage_anomaly_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baselineWeeks" INTEGER NOT NULL DEFAULT 4,
    "thresholdPct" REAL NOT NULL DEFAULT 25,
    "sustainedIntervals" INTEGER NOT NULL DEFAULT 3,
    "scope" TEXT NOT NULL DEFAULT 'PER_DEVICE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "usage_anomaly_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_anomaly_settings_userId_key"
  ON "usage_anomaly_settings"("userId");
CREATE INDEX "usage_anomaly_settings_enabled_idx"
  ON "usage_anomaly_settings"("enabled");

INSERT INTO "usage_anomaly_settings" (
    "userId",
    "enabled",
    "baselineWeeks",
    "thresholdPct",
    "sustainedIntervals",
    "scope",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    true,
    4,
    25,
    3,
    'PER_DEVICE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users";

CREATE TABLE "usage_anomaly_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "deviceId" INTEGER,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "observedKwh" REAL NOT NULL,
    "baselineKwh" REAL NOT NULL,
    "deltaPct" REAL NOT NULL,
    "explanation" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PER_DEVICE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "usage_anomaly_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_anomaly_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "usage_anomaly_events_valid_range" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "usage_anomaly_events_userId_deviceId_startsAt_endsAt_scope_key"
  ON "usage_anomaly_events"("userId", "deviceId", "startsAt", "endsAt", "scope");
CREATE INDEX "usage_anomaly_events_userId_startsAt_idx"
  ON "usage_anomaly_events"("userId", "startsAt");
CREATE INDEX "usage_anomaly_events_deviceId_startsAt_idx"
  ON "usage_anomaly_events"("deviceId", "startsAt");
