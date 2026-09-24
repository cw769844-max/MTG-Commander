import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@mtg-commander/shared";

/** Undefined connects to the page's own origin; see the note in api/client.ts. */
const SOCKET_URL = import.meta.env.VITE_API_BASE || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true,
});
