import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@mtg-commander/shared";
import { errorHandler } from "./async-handler";
import { requireAuth } from "./auth";
import { registerGameHandlers } from "./game/socketHandlers";
import { authRouter } from "./routes/auth";
import { startCardSyncScheduler } from "./scryfall/scheduler";
import { cardsRouter } from "./routes/cards";
import { decksRouter } from "./routes/decks";

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
/** Serving the built client from here puts the app and API on one origin. */
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");
const SERVE_CLIENT = process.env.SERVE_CLIENT !== "false" && existsSync(CLIENT_DIST);

const app = express();
// Only needed while Vite serves the client from its own port; in single-origin
// mode every request is same-origin and this does nothing.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/decks", requireAuth, decksRouter);

if (SERVE_CLIENT) {
  app.use(express.static(CLIENT_DIST));
  // Client-side routing: anything that isn't an API call is a page, so hand
  // back index.html and let React Router sort it out.
  app.get(/^\/(?!api\/|socket\.io\/|health).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.use(errorHandler);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});
registerGameHandlers(io);

/** The address other machines on the network can reach this PC on. */
function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  MTG Commander is running.\n`);
  console.log(`  On this PC:       http://localhost:${PORT}`);
  const lan = lanAddress();
  if (lan) console.log(`  On your network:  http://${lan}:${PORT}`);
  if (!SERVE_CLIENT) {
    console.log(`\n  API only — no client build found. Run "npm run build" first,`);
    console.log(`  or use "npm run dev:client" for the Vite dev server.`);
  }
  console.log("");
  startCardSyncScheduler();
});
