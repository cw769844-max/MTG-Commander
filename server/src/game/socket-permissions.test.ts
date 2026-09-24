import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  ClientGameState,
  ClientToServerEvents,
  GameObject,
  ServerToClientEvents,
  ZoneId,
} from "@mtg-commander/shared";
import { SESSION_COOKIE, signSessionToken } from "../auth";
import { registerGameHandlers } from "./socketHandlers";
import { roomManager } from "./room";

/**
 * The permission rules live only in the socket layer, and a regression there is
 * invisible in the UI — the buttons would just be hidden while the events still
 * worked. So these run against a real socket.io server.
 */

let httpServer: HttpServer;
let port: number;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerGameHandlers(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

/** Connects a client carrying a real session cookie for the given user id. */
function connect(userId: string): ClientSocket {
  const client = createClient(`http://localhost:${port}`, {
    extraHeaders: { Cookie: `${SESSION_COOKIE}=${signSessionToken(userId)}` },
    transports: ["websocket"],
    forceNew: true,
  });
  clients.push(client);
  return client;
}

type JoinResult = { ok: true; seat: number | null; state: ClientGameState } | { ok: false; error: string };

function join(client: ClientSocket, roomCode: string, displayName: string, asSpectator = false) {
  return new Promise<{ seat: number | null; state: ClientGameState }>((resolve, reject) => {
    client.emit("room:join", { roomCode, displayName, deckId: null, asSpectator }, (result: JoinResult) => {
      result.ok ? resolve(result) : reject(new Error(result.error));
    });
  });
}

/**
 * Round-trips a request so everything this client emitted beforehand is known
 * to have been handled. Without it, asserting that a forbidden action changed
 * nothing would pass even if the event never reached the server at all.
 * searchLibrary always acks, including for spectators, who get a refusal.
 */
function barrier(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => client.emit("game:searchLibrary", () => resolve()));
}

/** Records every state push so the latest can be inspected after a barrier. */
function trackStates(client: ClientSocket): ClientGameState[] {
  const seen: ClientGameState[] = [];
  client.on("room:state", (state) => seen.push(state));
  return seen;
}

let roomCounter = 0;
const freshRoomCode = () => `PERM${(roomCounter += 1)}`;

/** Puts a card straight into a zone, bypassing deck loading. */
function placeCard(roomCode: string, seat: number, zone: ZoneId = "battlefield"): GameObject {
  const room = roomManager.get(roomCode)!;
  const obj: GameObject = {
    instanceId: `obj-${roomCode}-${room.state.objects.length + 1}`,
    cardOracleId: "card-under-test",
    zone,
    ownerSeat: seat,
    controllerSeat: seat,
    tapped: false,
    faceDown: false,
    counters: {},
    x: 0,
    y: 0,
  };
  room.state.objects.push(obj);
  return obj;
}

const stateOf = (roomCode: string) => roomManager.get(roomCode)!.state;

async function twoPlayerRoom() {
  const roomCode = freshRoomCode();
  const alice = connect(`alice-${roomCode}`);
  const bob = connect(`bob-${roomCode}`);
  const aliceJoin = await join(alice, roomCode, "Alice");
  const bobJoin = await join(bob, roomCode, "Bob");
  expect([aliceJoin.seat, bobJoin.seat]).toEqual([0, 1]);
  return { roomCode, alice, bob };
}

describe("connection", () => {
  it("rejects a socket with no session cookie", async () => {
    const client = createClient(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true });
    clients.push(client);
    const error = await new Promise<Error>((resolve) => client.on("connect_error", resolve));
    expect(error.message).toBe("unauthorized");
  });
});

describe("only the controller may manipulate a card", () => {
  it("lets the controller move their own card", async () => {
    const { roomCode, alice } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    alice.emit("game:moveObject", { instanceId: card.instanceId, toZone: "graveyard" });
    await barrier(alice);

    expect(card.zone).toBe("graveyard");
  });

  it("ignores a move from someone who doesn't control the card", async () => {
    const { roomCode, bob } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    bob.emit("game:moveObject", { instanceId: card.instanceId, toZone: "graveyard" });
    await barrier(bob);

    expect(card.zone).toBe("battlefield");
  });

  it("ignores a tap from someone who doesn't control the card", async () => {
    const { roomCode, bob } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    bob.emit("game:tapObject", { instanceId: card.instanceId, tapped: true });
    await barrier(bob);

    expect(card.tapped).toBe(false);
  });

  it("ignores a flip from someone who doesn't control the card", async () => {
    const { roomCode, bob } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    bob.emit("game:flipObject", { instanceId: card.instanceId, faceDown: true });
    await barrier(bob);

    expect(card.faceDown).toBe(false);
  });

  it("follows control, so a stolen permanent answers to its new controller", async () => {
    const { roomCode, alice, bob } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    alice.emit("game:setController", { instanceId: card.instanceId, toSeat: 1 });
    await barrier(alice);
    expect(card.controllerSeat).toBe(1);

    bob.emit("game:tapObject", { instanceId: card.instanceId, tapped: true });
    await barrier(bob);
    expect(card.tapped).toBe(true);

    // Its original owner can no longer touch it.
    alice.emit("game:tapObject", { instanceId: card.instanceId, tapped: false });
    await barrier(alice);
    expect(card.tapped).toBe(true);
  });

  it("refuses to hand control of a card you don't control", async () => {
    const { roomCode, bob } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);

    bob.emit("game:setController", { instanceId: card.instanceId, toSeat: 1 });
    await barrier(bob);

    expect(card.controllerSeat).toBe(0);
  });
});

describe("life and commander damage", () => {
  it("lets a player set their own life", async () => {
    const { roomCode, alice } = await twoPlayerRoom();

    alice.emit("game:setLife", { seat: 0, life: 33 });
    await barrier(alice);

    expect(stateOf(roomCode).players[0].life).toBe(33);
  });

  it("refuses to let a player set someone else's life", async () => {
    const { roomCode, bob } = await twoPlayerRoom();

    bob.emit("game:setLife", { seat: 0, life: 1 });
    await barrier(bob);

    expect(stateOf(roomCode).players[0].life).toBe(40);
  });

  it("only records commander damage dealt by your own commander", async () => {
    const { roomCode, bob } = await twoPlayerRoom();

    // Bob claims Alice's commander hit him for 21.
    bob.emit("game:setCommanderDamage", { fromSeat: 0, toSeat: 1, amount: 21 });
    await barrier(bob);
    expect(stateOf(roomCode).players[1].commanderDamageTaken[0]).toBeUndefined();

    // Recording damage his own commander dealt is fine.
    bob.emit("game:setCommanderDamage", { fromSeat: 1, toSeat: 0, amount: 21 });
    await barrier(bob);
    expect(stateOf(roomCode).players[0].commanderDamageTaken[1]).toBe(21);
  });
});

describe("spectators", () => {
  it("cannot change anything on the board", async () => {
    const { roomCode } = await twoPlayerRoom();
    const card = placeCard(roomCode, 0);
    const watcher = connect(`watcher-${roomCode}`);
    const joined = await join(watcher, roomCode, "Watcher", true);
    expect(joined.seat).toBeNull();

    watcher.emit("game:moveObject", { instanceId: card.instanceId, toZone: "exile" });
    watcher.emit("game:tapObject", { instanceId: card.instanceId, tapped: true });
    watcher.emit("game:flipObject", { instanceId: card.instanceId, faceDown: true });
    watcher.emit("game:setLife", { seat: 0, life: 1 });
    watcher.emit("game:passTurn");
    watcher.emit("game:setPhase", { phase: "cleanup" });
    await barrier(watcher);

    const state = stateOf(roomCode);
    expect(card.zone).toBe("battlefield");
    expect(card.tapped).toBe(false);
    expect(card.faceDown).toBe(false);
    expect(state.players[0].life).toBe(40);
    expect(state.turnSeat).toBe(0);
    expect(state.phase).toBe("main1");
  });

  it("cannot read another player's library", async () => {
    const { roomCode } = await twoPlayerRoom();
    placeCard(roomCode, 0, "library");
    const watcher = connect(`watcher-lib-${roomCode}`);
    await join(watcher, roomCode, "Watcher", true);

    const result = await new Promise<any>((resolve) => watcher.emit("game:searchLibrary", resolve));

    expect(result.ok).toBe(false);
  });

  it("is refused a room that isn't running", async () => {
    const watcher = connect("watcher-missing");
    await expect(join(watcher, "NOSUCH", "Watcher", true)).rejects.toThrow(/No game is running/);
  });

  it("appears in the spectator list the players receive", async () => {
    const { roomCode, alice } = await twoPlayerRoom();
    const seen = trackStates(alice);
    const watcher = connect(`watcher2-${roomCode}`);
    await join(watcher, roomCode, "Watcher", true);
    await barrier(alice);

    expect(seen.at(-1)?.spectators.map((s) => s.displayName)).toContain("Watcher");
  });

  it("receives no hand contents", async () => {
    const { roomCode } = await twoPlayerRoom();
    placeCard(roomCode, 0, "hand");
    const watcher = connect(`watcher3-${roomCode}`);
    const { state } = await join(watcher, roomCode, "Watcher", true);

    const hand = state.objects.filter((o) => o.zone === "hand");
    expect(hand).toHaveLength(1);
    expect(hand[0].cardOracleId).toBeNull();
  });
});

describe("turn control", () => {
  it("lets a seated player pass the turn", async () => {
    const { roomCode, alice } = await twoPlayerRoom();

    alice.emit("game:passTurn");
    await barrier(alice);

    expect(stateOf(roomCode).turnSeat).toBe(1);
  });

  it("lets a seated player set the phase", async () => {
    const { roomCode, alice } = await twoPlayerRoom();

    alice.emit("game:setPhase", { phase: "combat_damage" });
    await barrier(alice);

    expect(stateOf(roomCode).phase).toBe("combat_damage");
  });
});

describe("library privacy", () => {
  it("returns only the requesting player's own library", async () => {
    const { roomCode, alice } = await twoPlayerRoom();
    placeCard(roomCode, 0, "library");
    placeCard(roomCode, 0, "library");
    placeCard(roomCode, 1, "library");

    const result = await new Promise<any>((resolve) => alice.emit("game:searchLibrary", resolve));

    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(2);
    expect(result.cards.every((c: GameObject) => c.ownerSeat === 0)).toBe(true);
  });

  it("never sends library objects in broadcast state", async () => {
    const { roomCode, alice } = await twoPlayerRoom();
    placeCard(roomCode, 0, "library");
    const seen = trackStates(alice);

    alice.emit("game:passTurn");
    await barrier(alice);

    const latest = seen.at(-1)!;
    expect(latest.objects.filter((o) => o.zone === "library")).toHaveLength(0);
    expect(latest.librarySizes[0]).toBe(1);
  });
});
