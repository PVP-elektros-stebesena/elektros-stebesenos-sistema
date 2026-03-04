import "dotenv/config";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

// Resolve paths relative to the project root (server/), not process.cwd()
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');  // from src/lib/ -> server/

const dbRelative = process.env.DATABASE_URL?.replace('file:', '') ?? './prisma/dev.db';
const dbPath = path.resolve(PROJECT_ROOT, dbRelative);
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });

const prisma = new PrismaClient({ adapter });

export default prisma;
