import "dotenv/config";
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

// Walk up from the current file to find the server project root (where package.json lives).
// Works identically in dev (src/lib/) and production (dist/src/lib/).
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find project root (no package.json found)');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = findProjectRoot(__dirname);

const dbRelative = process.env.DATABASE_URL?.replace('file:', '') ?? './prisma/dev.db';
const dbPath = path.resolve(PROJECT_ROOT, dbRelative);
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });

const prisma = new PrismaClient({ adapter });

export default prisma;
