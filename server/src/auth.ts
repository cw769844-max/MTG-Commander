import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be set (see server/.env.example)");
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const SESSION_COOKIE = "session";

/**
 * A secure cookie is never sent over plain HTTP, so tying this to NODE_ENV
 * would silently break login on a LAN playtest served over http. Set
 * COOKIE_SECURE=true whenever the app is reachable over https.
 */
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : process.env.NODE_ENV === "production";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: COOKIE_SECURE,
  maxAge: TOKEN_TTL_SECONDS * 1000,
  path: "/",
};

interface SessionPayload {
  sub: string; // userId
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSessionToken(userId: string): string {
  const payload: SessionPayload = { sub: userId };
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: TOKEN_TTL_SECONDS });
}

/** Returns the authenticated userId, or null if the token is missing/invalid. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET!) as SessionPayload;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Attaches req.userId when a valid session cookie is present; never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.userId = verifySessionToken(req.cookies?.[SESSION_COOKIE]) ?? undefined;
  next();
}

/** Rejects the request with 401 unless a valid session cookie is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = verifySessionToken(req.cookies?.[SESSION_COOKIE]);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.userId = userId;
  next();
}
