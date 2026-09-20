import { Router } from "express";
import { wrap } from "../async-handler";
import { prisma } from "../db";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  hashPassword,
  requireAuth,
  signSessionToken,
  verifyPassword,
} from "../auth";

export const authRouter = Router();

function publicUser(user: { id: string; email: string; displayName: string }) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

authRouter.post(
  "/register",
  wrap(async (req, res) => {
    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!email || !password || !displayName) {
      res
        .status(400)
        .json({ error: "email, password, and displayName are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      res
        .status(409)
        .json({ error: "An account with that email already exists" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        displayName,
      },
    });

    res.cookie(
      SESSION_COOKIE,
      signSessionToken(user.id),
      SESSION_COOKIE_OPTIONS,
    );
    res.status(201).json(publicUser(user));
  }),
);

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.cookie(
      SESSION_COOKIE,
      signSessionToken(user.id),
      SESSION_COOKIE_OPTIONS,
    );
    res.json(publicUser(user));
  }),
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: undefined,
  });
  res.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(publicUser(user));
  }),
);
