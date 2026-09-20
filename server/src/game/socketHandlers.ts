import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@mtg-commander/shared";
import { SESSION_COOKIE, verifySessionToken } from "../auth";
import { roomManager } from "./room";

type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketData {
  roomCode?: string;
  userId?: string;
  seat?: number;
  displayName?: string;
}

// roomCode -> seat -> socket.id, used to target WebRTC signaling at exactly
// the intended peer instead of broadcasting it to the whole room.
const seatSockets = new Map<string, Map<number, string>>();

export function registerGameHandlers(io: IOServer) {
  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
    const userId = verifySessionToken(cookies[SESSION_COOKIE]);
    if (!userId) {
      next(new Error("unauthorized"));
      return;
    }
    (socket.data as SocketData).userId = userId;
    next();
  });

  io.on("connection", (socket: IOSocket) => {
    const data = socket.data as SocketData;

    socket.on("room:join", async ({ roomCode, displayName, deckId }, ack) => {
      const userId = data.userId!;
      const room = roomManager.getOrCreate(roomCode.toUpperCase());

      const result = await room.join(userId, displayName, deckId);
      if ("error" in result) {
        ack({ ok: false, error: result.error });
        return;
      }

      data.roomCode = room.state.roomCode;
      data.userId = userId;
      data.seat = result.seat;
      data.displayName = displayName;

      socket.join(room.state.roomCode);
      if (!seatSockets.has(room.state.roomCode)) seatSockets.set(room.state.roomCode, new Map());
      seatSockets.get(room.state.roomCode)!.set(result.seat, socket.id);

      ack({ ok: true, state: room.state, seat: result.seat });
      socket.to(room.state.roomCode).emit("room:playerJoined", { seat: result.seat, displayName });
      io.to(room.state.roomCode).emit("room:state", room.state);
    });

    socket.on("room:leave", () => {
      handleLeave(socket, io);
    });

    socket.on("disconnect", () => {
      handleLeave(socket, io);
    });

    socket.on("game:moveObject", ({ instanceId, toZone, x, y }) => {
      withRoom(socket, (room) => {
        room.moveObject(instanceId, toZone, x, y);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:tapObject", ({ instanceId, tapped }) => {
      withRoom(socket, (room) => {
        room.tapObject(instanceId, tapped);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:drawCard", ({ count }) => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return;
        room.drawCards(data.seat, count);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:shuffleLibrary", () => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return;
        room.shuffleLibrary(data.seat);
        const entry = room.log(`${data.displayName} shuffled their library.`, data.seat);
        io.to(room.state.roomCode).emit("game:log", entry);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:setLife", ({ seat, life }) => {
      withRoom(socket, (room) => {
        room.setLife(seat, life);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:setCommanderDamage", ({ fromSeat, toSeat, amount }) => {
      withRoom(socket, (room) => {
        room.setCommanderDamage(fromSeat, toSeat, amount);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:setPhase", ({ phase }) => {
      withRoom(socket, (room) => {
        room.setPhase(phase);
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:passTurn", () => {
      withRoom(socket, (room) => {
        room.passTurn();
        io.to(room.state.roomCode).emit("room:state", room.state);
      });
    });

    socket.on("game:log", ({ message }) => {
      withRoom(socket, (room) => {
        const entry = room.log(message, data.seat ?? null);
        io.to(room.state.roomCode).emit("game:log", entry);
      });
    });

    socket.on("chat:message", ({ message }) => {
      if (!data.roomCode || data.seat === undefined) return;
      io.to(data.roomCode).emit("chat:message", { seat: data.seat, message, timestamp: new Date().toISOString() });
    });

    socket.on("rtc:signal", ({ toSeat, data: payload }) => {
      if (!data.roomCode || data.seat === undefined) return;
      const targetSocketId = seatSockets.get(data.roomCode)?.get(toSeat);
      if (!targetSocketId) return;
      io.to(targetSocketId).emit("rtc:signal", { fromSeat: data.seat, data: payload });
    });
  });
}

function withRoom(socket: IOSocket, fn: (room: ReturnType<typeof roomManager.getOrCreate>) => void) {
  const data = socket.data as SocketData;
  if (!data.roomCode) return;
  const room = roomManager.get(data.roomCode);
  if (!room) return;
  fn(room);
}

function handleLeave(socket: IOSocket, io: IOServer) {
  const data = socket.data as SocketData;
  if (!data.roomCode || !data.userId) return;
  const room = roomManager.get(data.roomCode);
  if (!room) return;
  room.leave(data.userId);
  socket.leave(data.roomCode);
  seatSockets.get(data.roomCode)?.delete(data.seat ?? -1);
  io.to(data.roomCode).emit("room:playerLeft", { seat: data.seat ?? -1 });
  io.to(data.roomCode).emit("room:state", room.state);
  roomManager.cleanupIfEmpty(data.roomCode);
  if (roomManager.get(data.roomCode) === undefined) seatSockets.delete(data.roomCode);
}
