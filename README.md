# Elektros Stebėsenos Sistema

Electricity monitoring system. React frontend + Fastify backend with Prisma and SQLite.

## Stack

- **Client** – React 19, TypeScript, Vite, TanStack Query
- **Server** – Fastify, Prisma, SQLite, TypeScript

## Setup

### Prerequisites

- Node.js 18+
- npm

### 1. Clone the repo

```bash
git clone <repo-url>
cd elektros-stebesenos-sistema
```

### 2. Set up the server

```bash
cd server
npm install
```

Create a `.env` file in `/server`:

```
DATABASE_URL="file:./dev.db"
PORT=3000
```

Run the dev server:

```bash
npm run dev
```

### 3. Set up the client

```bash
cd client
npm install
npm run dev
```

Client runs at `http://localhost:5173`, server at `http://localhost:3000`.

## Database

SQLite via Prisma. The schema lives in `server/prisma/schema.prisma`, generated client output goes to `server/generated/prisma`. The database file (`dev.db`) is created automatically on first migration.

### Models

- **Device** – meter/gateway settings (IP, MQTT config, poll interval)
- **Reading** – raw P1 telegram readings (voltage, current, power, energy per phase)
- **AggregatedData** – 10-min RMS voltage windows with compliance flags
- **WeeklyReport** – ESO weekly 95% compliance summaries
- **Anomaly** – voltage deviation events with phase, severity, duration

All child models cascade-delete when a device is removed.

### Common Prisma commands

```bash
cd server
npx prisma migrate dev          # create/apply a new migration
npx prisma migrate deploy       # apply pending migrations (CI/prod)
npx prisma generate             # regenerate the client after schema changes
npx prisma studio               # browse data in the browser
```

The server uses `@prisma/adapter-better-sqlite3` (Prisma 7 driver adapter). The singleton client is set up in `server/src/lib/prisma.ts`.

## API – Settings

CRUD for device/meter configuration. All routes are validated with Fastify JSON Schema.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings` | List all devices (newest first) |
| `GET` | `/api/settings/:id` | Get a single device |
| `POST` | `/api/settings` | Create a new device |
| `PATCH` | `/api/settings/:id` | Partially update a device |
| `DELETE` | `/api/settings/:id` | Delete a device (cascades) |

### POST / PATCH body

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | POST only | Non-empty, must contain non-whitespace |
| `deviceIp` | `string \| null` | no | Gateway IP address |
| `mqttBroker` | `string \| null` | no | MQTT broker address |
| `mqttPort` | `integer \| null` | no | 1–65535 |
| `mqttTopic` | `string \| null` | no | MQTT topic to subscribe to |
| `pollInterval` | `integer` | no | Seconds between polls (default 10) |
| `isActive` | `boolean` | no | Default `true` |

PATCH requires at least one field. Unknown fields are rejected.

When a device is created, updated, or deleted the poller automatically re-syncs so changes take effect immediately.

## API – Voltage & Grid Quality

All voltage endpoints query the database and accept an optional `deviceId` query param to scope results to a single device. If omitted, results span all devices.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/voltage/latest` | Most recent reading + ESO phase analysis |
| `GET` | `/api/voltage/history` | Time-series voltage data (raw or 10-min windows) |
| `GET` | `/api/voltage/anomalies` | Anomaly history (filterable) |
| `GET` | `/api/voltage/anomalies/active` | Currently ongoing (unresolved) anomalies |
| `GET` | `/api/voltage/compliance/weekly` | ESO weekly 95% compliance report |
| `GET` | `/api/voltage/summary` | Dashboard stats: counts, compliance, latest timestamp |

### Common query parameters

| Param | Type | Used by | Notes |
|---|---|---|---|
| `deviceId` | `integer` | all | Scope to a specific device |
| `from` | `ISO 8601` | history, anomalies | Start of time range |
| `to` | `ISO 8601` | history, anomalies | End of time range |
| `points` | `integer` | history | Max data points returned (default 500, max 5000) |
| `interval` | `"raw" \| "10min"` | history | Raw readings or 10-min RMS windows |
| `type` | `string` | anomalies | Filter: `VOLTAGE_DEVIATION`, `SHORT_INTERRUPTION`, `LONG_INTERRUPTION` |
| `phase` | `string` | anomalies | Filter: `L1`, `L2`, `L3` |
| `limit` | `integer` | anomalies | Max results (default 100, max 1000) |
| `date` | `ISO 8601` | compliance | Week containing this date (default: current week) |

### ESO standards reference

- Nominal voltage: **230 V ± 10 V** → acceptable range **[220 V, 240 V]**
- Measured in **10-minute RMS** intervals
- Weekly compliance: **≥ 95%** of 10-min windows must be within bounds
- Supply interruption: voltage below **10 V** (short ≤ 3 min, long > 3 min)

## API – Poller Status

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/poller/status` | List devices currently being polled with their interval |

## Device Poller

The `DevicePoller` service starts automatically when the server boots. It manages a per-device polling loop for every active device that has a `deviceIp` configured.

### How it works

1. Reads all active devices from the database
2. For each device, starts an independent `setInterval` at the device's `pollInterval` (seconds)
3. On every tick: `GET {deviceIp}` → parse the P1 gateway JSON → persist to DB → run analysis
4. Re-syncs the device list from DB **every hour** and **immediately** after any settings change

### Per-poll pipeline

```
fetch(deviceIp)
  → parseP1Response()          // map all P1 JSON fields to Reading columns
  → save Reading to DB         // full row: voltage, current, power, energy, tariffs
  → toVoltageReading()         // extract { timestamp, voltage_l1/l2/l3 }
  → tracker.processReading()   // anomaly detection → save Anomaly rows
  → windowMgr.addReading()     // 10-min window → save AggregatedData on boundary
```

Each device gets its own `AnomalyTracker` and `WindowManager` instance so their state is isolated.

### P1 gateway format

The poller expects the device IP to return the SmartGateway P1 JSON (all values are strings). The `deviceIp` field on the device stores the **full URL**, e.g. `http://192.168.1.100/smartmeter/api/read`.

### Graceful shutdown

On `SIGINT` / `SIGTERM` the server flushes all open 10-minute windows to the database before exiting.

## Mock P1 Gateway

A built-in mock server simulates the SmartGateway REST API for local development.

```bash
cd server
npm run mock            # start on port 3001
npm run mock:watch      # start with hot-reload
```

Then create a device with `deviceIp` set to `http://localhost:3001/smartmeter/api/read`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/smartmeter/api/read` | P1 reading (same shape as real gateway) |
| `GET` | `/mock/scenarios` | List available test scenarios |
| `GET` | `/mock/status` | Current scenario & tick info |
| `POST` | `/mock/scenario` | Switch to a named scenario |
| `POST` | `/mock/custom` | Set custom fixed voltages |
| `POST` | `/mock/sequence` | Queue a sequence of scenarios |

## Testing

```bash
cd server
npm test            # run all tests once
npm run test:watch  # run in watch mode
```

Tests use Vitest. Integration tests (routes) hit the real SQLite database. File parallelism is disabled (`vitest.config.ts`) because test files share the same DB.

## Useful commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (client or server) |
| `npm run build` | Build client for production |
| `npm run mock` | Start mock P1 gateway on port 3001 |
| `npm run mock:watch` | Mock gateway with hot-reload |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npx prisma studio` | Open Prisma database UI |
| `npx prisma migrate dev` | Run database migrations |
