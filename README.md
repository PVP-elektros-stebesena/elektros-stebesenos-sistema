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

## Useful commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (client or server) |
| `npm run build` | Build client for production |
| `npx prisma studio` | Open Prisma database UI |
| `npx prisma migrate dev` | Run database migrations |
