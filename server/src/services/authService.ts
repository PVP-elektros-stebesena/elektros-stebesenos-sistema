import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import prisma from '../lib/prisma.js';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_DAYS = 7;

export interface PublicUser {
  id: number;
  email: string;
  username: string | null;
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
  expiresAt: Date;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function toPublicUser(user: {
  id: number;
  email: string;
  username: string | null;
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, key] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !key) return false;

  const storedKey = Buffer.from(key, 'hex');
  const derivedKey = (await scrypt(password, salt, storedKey.length)) as Buffer;

  if (storedKey.length !== derivedKey.length) return false;
  return timingSafeEqual(storedKey, derivedKey);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: number, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      userAgent: userAgent?.slice(0, 255) ?? null,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function registerUser(input: {
  email: string;
  username?: string | null;
  displayName?: string | null;
  password: string;
  userAgent?: string;
}): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const isFirstUser = (await tx.user.count()) === 0;

    const createdUser = await tx.user.create({
      data: {
        email: normalizeIdentifier(input.email),
        username: input.username ? normalizeIdentifier(input.username) : null,
        displayName: input.displayName?.trim() || null,
        passwordHash,
      },
    });

    if (isFirstUser) {
      // Claim any pre-auth or local-dev devices for the first real user.
      await tx.device.updateMany({
        where: { userId: null },
        data: { userId: createdUser.id },
      });
    }

    return createdUser;
  });

  const session = await createSession(user.id, input.userAgent);
  return { ...session, user: toPublicUser(user) };
}

export async function login(input: {
  identifier: string;
  password: string;
  userAgent?: string;
}): Promise<AuthResult | null> {
  const identifier = normalizeIdentifier(input.identifier);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { username: identifier },
      ],
    },
  });

  if (!user) return null;

  const validPassword = await verifyPassword(input.password, user.passwordHash);
  if (!validPassword) return null;

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const session = await createSession(user.id, input.userAgent);

  return { ...session, user: toPublicUser(updatedUser) };
}

export async function authenticateToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  return toPublicUser(session.user);
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;

  await prisma.authSession.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function isSetupRequired(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}
