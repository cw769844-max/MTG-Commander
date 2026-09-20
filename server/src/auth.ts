import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Placeholder auth: identifies the caller by an `x-user-email` header and
 * upserts a matching User row. Real authentication (sessions/OAuth) is a
 * separate follow-up; this keeps decks attributable per-user in the
 * meantime without blocking the rest of the foundation on it.
 */
export async function identifyUser(req: Request, _res: Response, next: NextFunction) {
  const email = String(req.header("x-user-email") ?? "demo@example.com");
  const user = await prisma.user.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  req.userId = user.id;
  next();
}
