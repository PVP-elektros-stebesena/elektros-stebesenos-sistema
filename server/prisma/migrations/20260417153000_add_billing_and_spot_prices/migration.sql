CREATE TABLE "spot_prices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "priceEurPerMwh" REAL NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "spot_prices_provider_zone_startsAt_key" ON "spot_prices"("provider", "zone", "startsAt");
CREATE INDEX "spot_prices_zone_startsAt_idx" ON "spot_prices"("zone", "startsAt");

CREATE TABLE "billing_plans" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "pricingMode" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "rateT1" REAL,
    "rateT2" REAL,
    "rateT3" REAL,
    "rateT4" REAL,
    "monthlyFixedFeeEur" REAL,
    "spotProvider" TEXT,
    "spotZone" TEXT,
    "spotAdderEurPerKwh" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "billing_plans_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "billing_plans_deviceId_effectiveFrom_idx" ON "billing_plans"("deviceId", "effectiveFrom");
CREATE INDEX "billing_plans_deviceId_effectiveTo_idx" ON "billing_plans"("deviceId", "effectiveTo");
