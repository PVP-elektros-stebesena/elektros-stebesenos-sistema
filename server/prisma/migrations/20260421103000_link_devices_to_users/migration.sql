ALTER TABLE "devices" ADD COLUMN "userId" INTEGER REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "devices_userId_idx" ON "devices"("userId");
