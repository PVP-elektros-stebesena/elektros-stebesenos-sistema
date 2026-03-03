/*
  Warnings:

  - You are about to drop the column `electricityDelivered1` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `electricityDelivered2` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `electricityReturned1` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `electricityReturned2` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerDelivered` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerDeliveredL1` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerDeliveredL2` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerDeliveredL3` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerReturned` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerReturnedL1` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerReturnedL2` on the `readings` table. All the data in the column will be lost.
  - You are about to drop the column `powerReturnedL3` on the `readings` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_readings" (
    "deviceId" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "electricityTariff" INTEGER,
    "energyDelivered" REAL,
    "energyReturned" REAL,
    "reactiveEnergyDelivered" REAL,
    "reactiveEnergyReturned" REAL,
    "energyDeliveredTariff1" REAL,
    "energyDeliveredTariff2" REAL,
    "energyDeliveredTariff3" REAL,
    "energyDeliveredTariff4" REAL,
    "energyReturnedTariff1" REAL,
    "energyReturnedTariff2" REAL,
    "energyReturnedTariff3" REAL,
    "energyReturnedTariff4" REAL,
    "reactiveEnergyDeliveredTariff1" REAL,
    "reactiveEnergyDeliveredTariff2" REAL,
    "reactiveEnergyDeliveredTariff3" REAL,
    "reactiveEnergyDeliveredTariff4" REAL,
    "reactiveEnergyReturnedTariff1" REAL,
    "reactiveEnergyReturnedTariff2" REAL,
    "reactiveEnergyReturnedTariff3" REAL,
    "reactiveEnergyReturnedTariff4" REAL,
    "instantaneousVoltageL1" REAL,
    "voltageL1" REAL,
    "instantaneousCurrentL1" REAL,
    "currentL1" REAL,
    "instantaneousVoltageL2" REAL,
    "voltageL2" REAL,
    "instantaneousCurrentL2" REAL,
    "currentL2" REAL,
    "instantaneousVoltageL3" REAL,
    "voltageL3" REAL,
    "instantaneousCurrentL3" REAL,
    "currentL3" REAL,
    "instantaneousVoltage" REAL,
    "instantaneousCurrent" REAL,
    "instantaneousCurrentNeutral" REAL,
    "currentNeutral" REAL,
    "frequency" REAL,
    "activeInstantaneousPowerDelivered" REAL,
    "activeInstantaneousPowerDeliveredL1" REAL,
    "activeInstantaneousPowerDeliveredL2" REAL,
    "activeInstantaneousPowerDeliveredL3" REAL,
    "activeInstantaneousPowerReturnedL1" REAL,
    "activeInstantaneousPowerReturnedL2" REAL,
    "activeInstantaneousPowerReturnedL3" REAL,
    "reactiveInstantaneousPowerDeliveredL1" REAL,
    "reactiveInstantaneousPowerDeliveredL2" REAL,
    "reactiveInstantaneousPowerDeliveredL3" REAL,
    "reactiveInstantaneousPowerReturnedL1" REAL,
    "reactiveInstantaneousPowerReturnedL2" REAL,
    "reactiveInstantaneousPowerReturnedL3" REAL,
    "apparentInstantaneousPower" REAL,
    "apparentInstantaneousPowerL1" REAL,
    "apparentInstantaneousPowerL2" REAL,
    "apparentInstantaneousPowerL3" REAL,
    "powerDeliveredTotal" REAL,
    "powerReturnedTotal" REAL,
    "reactiveEnergyDeliveredCurrentPeriod" REAL,
    "reactiveEnergyReturnedCurrentPeriod" REAL,
    "powerDeliveredNetto" REAL,

    PRIMARY KEY ("deviceId", "timestamp"),
    CONSTRAINT "readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_readings" ("currentL1", "currentL2", "currentL3", "deviceId", "electricityTariff", "frequency", "timestamp", "voltageL1", "voltageL2", "voltageL3") SELECT "currentL1", "currentL2", "currentL3", "deviceId", "electricityTariff", "frequency", "timestamp", "voltageL1", "voltageL2", "voltageL3" FROM "readings";
DROP TABLE "readings";
ALTER TABLE "new_readings" RENAME TO "readings";
CREATE INDEX "readings_deviceId_timestamp_idx" ON "readings"("deviceId", "timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
