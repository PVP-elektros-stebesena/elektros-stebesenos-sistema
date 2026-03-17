-- CreateTable
CREATE TABLE "notification_event_toggles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventType" TEXT NOT NULL,
    "deviceId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "notification_event_toggles_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_toggles_eventType_deviceId_key" ON "notification_event_toggles"("eventType", "deviceId");

-- CreateIndex
CREATE INDEX "notification_event_toggles_deviceId_idx" ON "notification_event_toggles"("deviceId");
