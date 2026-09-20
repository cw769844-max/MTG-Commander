import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't catch rejections from async handlers: an unhandled
 * rejection leaves the request hanging until it times out. Every async route
 * goes through this so failures reach the error middleware instead.
 */
export function wrap(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
}
