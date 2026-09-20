import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";
import {
  POD_SIZES,
  PUBLIC_ZONES,
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
import { roomManager, type Room } from "./room";
import { redactStateFor } from "./visibility";

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

// roomCode -> spectator socket ids. Kept apart from seats because spectators
// have no seat and must never be treated as one when redacting state.
const spectatorSockets = new Map<string, Set<string>>();

function addSpectatorSocket(roomCode: string, socketId: string) {
  const existing = spectatorSockets.get(roomCode) ?? new Set<string>();
  existing.add(socketId);
  spectatorSockets.set(roomCode, existing);
}

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

    socket.on("room:join", async ({ roomCode, displayName, deckId, asSpectator }, ack) => {
      const userId = data.userId!;
      const code = roomCode.toUpperCase();

      if (asSpectator) {
        // Watching shouldn't conjure a room that nobody is playing in.
        const room = roomManager.get(code);
        if (!room) {
          ack({ ok: false, error: "No game is running with that code." });
          return;
        }

        room.addSpectator(userId, displayName);
        data.roomCode = code;
        data.seat = undefined;
        data.displayName = displayName;

        socket.join(code);
        addSpectatorSocket(code, socket.id);

        ack({ ok: true, state: redactStateFor(room.state, null), seat: null });
        broadcastState(io, room);
        return;
      }

      const room = roomManager.getOrCreate(code);

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

      ack({ ok: true, state: redactStateFor(room.state, result.seat), seat: result.seat });
      socket.to(room.state.roomCode).emit("room:playerJoined", { seat: result.seat, displayName });
      broadcastState(io, room);
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
        if (!controls(room, data.seat, instanceId)) return;
        room.moveObject(instanceId, toZone, x, y);
        broadcastState(io, room);
      });
    });

    socket.on("game:tapObject", ({ instanceId, tapped }) => {
      withRoom(socket, (room) => {
        if (!controls(room, data.seat, instanceId)) return;
        room.tapObject(instanceId, tapped);
        broadcastState(io, room);
      });
    });

    socket.on("game:flipObject", ({ instanceId, faceDown }) => {
      withRoom(socket, (room) => {
        if (!controls(room, data.seat, instanceId)) return;
        room.flipObject(instanceId, faceDown);
        broadcastState(io, room);
      });
    });

    socket.on("game:setController", ({ instanceId, toSeat }) => {
      withRoom(socket, (room) => {
        if (!controls(room, data.seat, instanceId)) return;
        if (!room.state.players.some((p) => p.seat === toSeat)) return;
        room.setController(instanceId, toSeat);
        const target = room.state.players.find((p) => p.seat === toSeat);
        const entry = room.log(
          `${data.displayName} passed control of a permanent to ${target?.displayName}.`,
          data.seat ?? null
        );
        io.to(room.state.roomCode).emit("game:log", entry);
        broadcastState(io, room);
      });
    });

    socket.on("game:targetObject", async ({ instanceId, kind }) => {
      if (!data.roomCode || data.seat === undefined) return;
      const room = roomManager.get(data.roomCode);
      const obj = room?.getObject(instanceId);
      if (!room || !obj) return;

      // You can point at anything public, or at your own cards. Pointing at a
      // card you can't see would be a way to probe hidden zones.
      const isPublic = PUBLIC_ZONES.includes(obj.zone);
      const isMine = obj.controllerSeat === data.seat || obj.ownerSeat === data.seat;
      if (!isPublic && !isMine) return;
      if (kind === "declare" && !isMine) return;

      io.to(room.state.roomCode).emit("game:targeted", { instanceId, kind, bySeat: data.seat });

      // Naming the card is only safe for public zones; declaring from hand is
      // a deliberate reveal, so it names the card too.
      const name = await cardName(obj.cardOracleId);
      const label = isPublic || kind === "declare" ? name : "a hidden card";
      const verb = kind === "declare" ? "declares" : "targets";
      const entry = room.log(`${data.displayName} ${verb} ${label}.`, data.seat);
      io.to(room.state.roomCode).emit("game:log", entry);
    });

    socket.on("game:drawCard", ({ count }) => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return;
        room.drawCards(data.seat, count);
        broadcastState(io, room);
      });
    });

    socket.on("game:shuffleLibrary", () => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return;
        room.shuffleLibrary(data.seat);
        const entry = room.log(`${data.displayName} shuffled their library.`, data.seat);
        io.to(room.state.roomCode).emit("game:log", entry);
        broadcastState(io, room);
      });
    });

    socket.on("game:setLife", ({ seat, life }) => {
      withRoom(socket, (room) => {
        if (seat !== data.seat) return; // you track your own life total
        room.setLife(seat, life);
        broadcastState(io, room);
      });
    });

    socket.on("game:setCommanderDamage", ({ fromSeat, toSeat, amount }) => {
      withRoom(socket, (room) => {
        if (fromSeat !== data.seat) return; // you record only the damage your commander dealt
        room.setCommanderDamage(fromSeat, toSeat, amount);
        broadcastState(io, room);
      });
    });

    socket.on("game:setPhase", ({ phase }) => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return; // spectators don't run the turn
        room.setPhase(phase);
        broadcastState(io, room);
      });
    });

    socket.on("game:passTurn", () => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return;
        room.passTurn();
        broadcastState(io, room);
      });
    });

    socket.on("game:log", ({ message }) => {
      withRoom(socket, (room) => {
        if (data.seat === undefined) return; // the game log belongs to the players
        const entry = room.log(message, data.seat);
        io.to(room.state.roomCode).emit("game:log", entry);
      });
    });

    socket.on("game:searchLibrary", (ack) => {
      if (!data.roomCode || data.seat === undefined) {
        ack({ ok: false, error: "You aren't seated in a game." });
        return;
      }
      const room = roomManager.get(data.roomCode);
      if (!room) {
        ack({ ok: false, error: "Game not found." });
        return;
      }

      // Only ever your own library, and searching is public knowledge.
      ack({ ok: true, cards: room.librarySnapshot(data.seat) });
      const entry = room.log(`${data.displayName} searched their library.`, data.seat);
      io.to(room.state.roomCode).emit("game:log", entry);
    });

    // Spectators may chat: they only ever saw public information anyway, so
    // there is nothing for them to give away. Their messages are labelled.
    socket.on("chat:message", ({ message }) => {
      if (!data.roomCode) return;
      io.to(data.roomCode).emit("chat:message", {
        seat: data.seat ?? null,
        displayName: data.displayName ?? "Player",
        isSpectator: data.seat === undefined,
        message,
        timestamp: new Date().toISOString(),
      });
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

/**
 * Only the player controlling a card may move, tap or flip it. To affect
 * someone else's card you target it and they resolve it, the same way you'd
 * point across a table rather than reaching over and picking it up.
 */
function controls(room: Room, seat: number | undefined, instanceId: string): boolean {
  if (seat === undefined) return false;
  return room.getObject(instanceId)?.controllerSeat === seat;
}

async function cardName(oracleId: string | null): Promise<string> {
  if (!oracleId) return "a card";
  const row = await prisma.card.findUnique({ where: { oracleId }, select: { name: true } });
  return row?.name ?? "a card";
}

/**
 * State goes out one socket at a time: each seat gets its own redacted view,
 * so no client ever holds cards it isn't entitled to see.
 */
function broadcastState(io: IOServer, room: Room) {
  for (const [seat, socketId] of seatSockets.get(room.state.roomCode) ?? []) {
    io.to(socketId).emit("room:state", redactStateFor(room.state, seat));
  }

  // Spectators share one view, since none of them is entitled to more.
  const watching = spectatorSockets.get(room.state.roomCode);
  if (watching?.size) {
    const spectatorView = redactStateFor(room.state, null);
    for (const socketId of watching) io.to(socketId).emit("room:state", spectatorView);
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
  if (data.seat === undefined) {
    spectatorSockets.get(data.roomCode)?.delete(socket.id);
  } else {
    seatSockets.get(data.roomCode)?.delete(data.seat);
    io.to(data.roomCode).emit("room:playerLeft", { seat: data.seat });
  }
  broadcastState(io, room);
  roomManager.cleanupIfEmpty(data.roomCode);
  if (roomManager.get(data.roomCode) === undefined) {
    seatSockets.delete(data.roomCode);
    spectatorSockets.delete(data.roomCode);
  }
}
