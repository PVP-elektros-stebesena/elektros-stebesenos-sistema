import "dotenv/config";
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

const dbRelative = process.env.DATABASE_URL?.replace('file:', '') ?? './prisma/dev.db';
const dbPath = path.resolve(process.cwd(), dbRelative);
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });

const prisma = new PrismaClient({ adapter });

export default prisma;
