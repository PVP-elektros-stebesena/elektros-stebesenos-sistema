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

## Useful commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (client or server) |
| `npm run build` | Build client for production |
| `npx prisma studio` | Open Prisma database UI |
| `npx prisma migrate dev` | Run database migrations |
