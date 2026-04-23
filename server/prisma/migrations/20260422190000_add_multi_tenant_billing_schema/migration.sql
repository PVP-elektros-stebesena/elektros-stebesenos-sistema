CREATE TABLE "renters" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "landlordUserId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "renters_landlordUserId_fkey" FOREIGN KEY ("landlordUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "renters_landlordUserId_name_idx" ON "renters"("landlordUserId", "name");

CREATE TABLE "renter_allocations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "renterId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "renter_allocations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "renter_allocations_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "renters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "renter_allocations_valid_range" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "renter_allocations_deviceId_renterId_startsAt_key" ON "renter_allocations"("deviceId", "renterId", "startsAt");
CREATE INDEX "renter_allocations_deviceId_startsAt_idx" ON "renter_allocations"("deviceId", "startsAt");
CREATE INDEX "renter_allocations_renterId_startsAt_idx" ON "renter_allocations"("renterId", "startsAt");
CREATE UNIQUE INDEX "renter_allocations_deviceId_renterId_active_key"
  ON "renter_allocations"("deviceId", "renterId")
  WHERE "endsAt" IS NULL;

CREATE TRIGGER "renter_allocations_same_landlord_insert"
BEFORE INSERT ON "renter_allocations"
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM "devices" AS "device"
    JOIN "renters" AS "renter" ON "renter"."id" = NEW."renterId"
    WHERE "device"."id" = NEW."deviceId"
      AND "device"."userId" IS NOT NULL
      AND "device"."userId" = "renter"."landlordUserId"
)
BEGIN
    SELECT RAISE(ABORT, 'Renter allocation must use a renter owned by the same landlord as the device');
END;

CREATE TRIGGER "renter_allocations_same_landlord_update"
BEFORE UPDATE ON "renter_allocations"
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM "devices" AS "device"
    JOIN "renters" AS "renter" ON "renter"."id" = NEW."renterId"
    WHERE "device"."id" = NEW."deviceId"
      AND "device"."userId" IS NOT NULL
      AND "device"."userId" = "renter"."landlordUserId"
)
BEGIN
    SELECT RAISE(ABORT, 'Renter allocation must use a renter owned by the same landlord as the device');
END;

CREATE TRIGGER "renter_allocations_no_overlap_insert"
BEFORE INSERT ON "renter_allocations"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM "renter_allocations" AS "existing"
    WHERE "existing"."deviceId" = NEW."deviceId"
      AND "existing"."renterId" = NEW."renterId"
      AND COALESCE("existing"."endsAt", '9999-12-31 23:59:59') > NEW."startsAt"
      AND COALESCE(NEW."endsAt", '9999-12-31 23:59:59') > "existing"."startsAt"
)
BEGIN
    SELECT RAISE(ABORT, 'Overlapping renter allocations are not allowed for the same device and renter');
END;

CREATE TRIGGER "renter_allocations_no_overlap_update"
BEFORE UPDATE ON "renter_allocations"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM "renter_allocations" AS "existing"
    WHERE "existing"."id" <> OLD."id"
      AND "existing"."deviceId" = NEW."deviceId"
      AND "existing"."renterId" = NEW."renterId"
      AND COALESCE("existing"."endsAt", '9999-12-31 23:59:59') > NEW."startsAt"
      AND COALESCE(NEW."endsAt", '9999-12-31 23:59:59') > "existing"."startsAt"
)
BEGIN
    SELECT RAISE(ABORT, 'Overlapping renter allocations are not allowed for the same device and renter');
END;

CREATE TABLE "billing_periods" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "billing_periods_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "billing_periods_valid_range" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "billing_periods_deviceId_startsAt_endsAt_key" ON "billing_periods"("deviceId", "startsAt", "endsAt");
CREATE INDEX "billing_periods_deviceId_startsAt_idx" ON "billing_periods"("deviceId", "startsAt");
CREATE INDEX "billing_periods_deviceId_status_startsAt_idx" ON "billing_periods"("deviceId", "status", "startsAt");
CREATE UNIQUE INDEX "billing_periods_deviceId_open_key"
  ON "billing_periods"("deviceId")
  WHERE "status" = 'OPEN';

CREATE TRIGGER "billing_periods_no_overlap_insert"
BEFORE INSERT ON "billing_periods"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM "billing_periods" AS "existing"
    WHERE "existing"."deviceId" = NEW."deviceId"
      AND "existing"."endsAt" > NEW."startsAt"
      AND NEW."endsAt" > "existing"."startsAt"
)
BEGIN
    SELECT RAISE(ABORT, 'Overlapping billing periods are not allowed for the same device');
END;

CREATE TRIGGER "billing_periods_no_overlap_update"
BEFORE UPDATE ON "billing_periods"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM "billing_periods" AS "existing"
    WHERE "existing"."deviceId" = NEW."deviceId"
      AND "existing"."id" <> OLD."id"
      AND "existing"."endsAt" > NEW."startsAt"
      AND NEW."endsAt" > "existing"."startsAt"
)
BEGIN
    SELECT RAISE(ABORT, 'Overlapping billing periods are not allowed for the same device');
END;
