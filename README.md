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

# Optional: Brevo SMTP email notifications
BREVO_SMTP_HOST="smtp-relay.brevo.com"
BREVO_SMTP_PORT=587
BREVO_SMTP_SECURE=false
BREVO_SMTP_USER="your_brevo_login"
BREVO_SMTP_PASS="your_brevo_smtp_key"
NOTIFICATION_EMAIL_FROM="alerts@yourdomain.com"
NOTIFICATION_EMAIL_TO="ops@example.com"
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

## Verification

Run the same checks as CI:

```bash
npm ci --prefix client
npm ci --prefix server
npm run verify
```

## Database

SQLite via Prisma. The schema lives in `server/prisma/schema.prisma`, generated client output goes to `server/generated/prisma`. The database file (`dev.db`) is created automatically on first migration.

### Models

- **Device** – meter/gateway settings (IP, MQTT config, poll interval)
- **BillingPlan** – fixed or dynamic electricity pricing configuration over time (effectiveFrom/effectiveTo)
- **SpotPrice** – stored day-ahead market prices by provider, zone, and interval
- **Reading** – raw P1 telegram readings (voltage, current, power, energy per phase)
- **AggregatedData** – 10-min RMS voltage windows with compliance flags
- **WeeklyReport** – ESO weekly 95% compliance summaries
- **Anomaly** – voltage and power anomaly events with severity, thresholds, and duration

- **StandbyBaseline** - one stored standby baseline per device per completed billing-local night

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

## Notifications (event pipeline + Brevo email)

Events are produced by core services (`DevicePoller`, report generation) and dispatched by a centralized `NotificationService`. Delivery is pluggable via adapters that implement `NotificationSender`, and event enable/disable rules are loaded from DB toggles.

Supported event types:

- `ANOMALY_DETECTED`
- `DEVICE_UNREACHABLE`
- `DEVICE_RECOVERED`
- `REPORT_GENERATED`

Email sender setup (Brevo):

1. In Brevo, create/get SMTP credentials (login + SMTP key).
2. Fill the SMTP variables in `server/.env`.
3. Set `NOTIFICATION_EMAIL_TO` (recipient) and `NOTIFICATION_EMAIL_FROM` (verified sender).
4. Start the server. If configured correctly, startup log shows `Brevo email sender enabled`.

The sender is registered at startup in `server/src/index.ts` and keeps using the same event-based notification pipeline.

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

## API – Billing plans and spot pricing

Billing plans are stored per device and versioned by `effectiveFrom` date. Reports use the active plan(s) for each interval when estimating cost.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/:id/billing-plan` | Returns `activePlan` and plan history for a device |
| `PUT` | `/api/settings/:id/billing-plan` | Saves a new billing plan version for a device |

Billing plan modes:

- `FIXED` – uses `fixedRates.t1..t4` (EUR/kWh) and optional `monthlyFixedFeeEur`
- `DYNAMIC` – uses stored spot prices (`ELERING`, zone `LT`) + optional `spotAdderEurPerKwh`

Spot prices are fetched on schedule and stored in `spot_prices`. If price synchronization is incomplete, report estimation can be `partial`.

Estimated cost statuses exposed in report responses:

- `complete` – full coverage with configured pricing
- `partial` – some time/energy coverage missing
- `unavailable` – configuration/data/error prevents a reliable estimate

## API - Power

Power endpoints provide live power metrics, summaries, anomaly history, and standby-load projections for the selected device.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/power/latest` | Most recent power reading and policy/breach state |
| `GET` | `/api/power/summary` | Power dashboard totals and anomaly counters |
| `GET` | `/api/power/history` | Time-series power data |
| `GET` | `/api/power/anomalies` | Power anomaly history |
| `GET` | `/api/power/standby` | Latest nightly standby baseline and ghost-load cost projection |

### Standby baseline behavior

- Standby analysis uses the quietest complete **10-minute** `AggregatedData.activePowerAvgTotal` window between **02:00 and 05:00** in `Europe/Vilnius`.
- Results are persisted in `StandbyBaseline` with one row per `(deviceId, baselineDate)`.
- On server startup, the latest completed night is backfilled if missing, then a scheduler recomputes new baselines daily at **05:05** billing-local time.
- `GET /api/power/standby` returns standby power in `kW`/`W`, projected daily and monthly `kWh`, current-rate pricing, projected monthly EUR cost, and a status of `complete`, `partial`, or `unavailable`.

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

## Power anomaly behavior (breaker curve)

Active power anomaly detection now uses a time-current style breaker curve instead of instant single-breach alerts.

- Short spikes above contract power can pass without opening an anomaly.
- Sustained overload opens `POWER_SPIKE` with `CRITICAL` severity once curve allowance is exceeded.
- Ramp-rate (`POWER_RAMP_RATE`) behavior is unchanged.


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
