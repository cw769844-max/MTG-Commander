import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";
import {
  POD_SIZES,
  evaluateBracket,
  type ClientToServerEvents,
  type PodSize,
  type ServerToClientEvents,
} from "@mtg-commander/shared";
import { SESSION_COOKIE, verifySessionToken } from "../auth";
import { prisma } from "../db";
import { validateDeckLegality } from "../deck-legality";
import { fromPrismaCard } from "../scryfall/mapper";
import { selfReportOf } from "../routes/decks";
import { matchmakingQueue, type QueueEntry } from "./matchmaking";
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
      if (data.userId) {
        const removed = matchmakingQueue.leave(data.userId);
        if (removed) broadcastQueueStatus(io, removed.bracket, removed.podSize);
      }
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

    socket.on("matchmaking:join", async ({ deckId, podSize }, ack) => {
      const userId = data.userId;
      if (!userId) {
        ack({ ok: false, error: "Not authenticated." });
        return;
      }
      if (!POD_SIZES.includes(podSize as PodSize)) {
        ack({ ok: false, error: "Pod size must be 3 or 4." });
        return;
      }

      const check = await checkDeckForQueue(userId, deckId);
      if ("error" in check) {
        ack({ ok: false, error: check.error });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const entry: QueueEntry = {
        userId,
        socketId: socket.id,
        displayName: user?.displayName ?? "Player",
        deckId,
        bracket: check.bracket,
        podSize: podSize as PodSize,
        joinedAt: Date.now(),
      };

      matchmakingQueue.join(entry);
      ack({ ok: true, status: matchmakingQueue.statusFor(entry.bracket, entry.podSize) });

      const pod = matchmakingQueue.takePod(entry.bracket, entry.podSize);
      if (pod) {
        const room = roomManager.createRoom();
        for (const member of pod) {
          io.to(member.socketId).emit("matchmaking:matched", {
            roomCode: room.state.roomCode,
            bracket: entry.bracket,
            podSize: entry.podSize,
          });
        }
      }
      broadcastQueueStatus(io, entry.bracket, entry.podSize);
    });

    socket.on("matchmaking:leave", () => {
      if (!data.userId) return;
      const removed = matchmakingQueue.leave(data.userId);
      if (removed) broadcastQueueStatus(io, removed.bracket, removed.podSize);
    });
  });
}

/**
 * Matchmaking only accepts decks that are actually legal and whose declared
 * bracket matches their contents — otherwise the bracket a pod agreed on
 * wouldn't mean anything.
 */
async function checkDeckForQueue(
  userId: string,
  deckId: string
): Promise<{ bracket: QueueEntry["bracket"] } | { error: string }> {
  const deck = await prisma.deck.findFirst({ where: { id: deckId, ownerId: userId }, include: { cards: true } });
  if (!deck) return { error: "Deck not found." };

  const oracleIds = deck.cards.map((c) => c.cardOracleId);
  const rows = await prisma.card.findMany({ where: { oracleId: { in: oracleIds } } });
  const byId = new Map(rows.map((r) => [r.oracleId, fromPrismaCard(r)]));
  const legality = validateDeckLegality(deck.cards.map((dc) => ({ deckCard: dc, card: byId.get(dc.cardOracleId) })));

  if (!legality.legal) {
    return { error: "That deck isn't Commander-legal yet — fix its errors in the deck builder first." };
  }

  const selfReport = selfReportOf(deck);
  const bracketReport = evaluateBracket(selfReport, legality.gameChangerCount);
  if (!bracketReport.matchesDeck) {
    return { error: `That deck doesn't match the bracket it claims: ${bracketReport.issues[0]?.message ?? ""}` };
  }

  return { bracket: selfReport.bracket };
}

function broadcastQueueStatus(io: IOServer, bracket: QueueEntry["bracket"], podSize: PodSize) {
  const status = matchmakingQueue.statusFor(bracket, podSize);
  for (const entry of matchmakingQueue.waitingIn(bracket, podSize)) {
    io.to(entry.socketId).emit("matchmaking:status", status);
  }
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
