import { beforeEach, describe, expect, it } from "vitest";
import type { GameObject } from "@mtg-commander/shared";
import { Room, RoomManager } from "./room";

let room: Room;

/** Seats a player without touching the database, then gives them some cards. */
async function seat(r: Room, userId: string, name: string) {
  const result = await r.join(userId, name, null);
  if ("error" in result) throw new Error(result.error);
  return result.seat;
}

function addObject(r: Room, seat: number, zone: GameObject["zone"], extra: Partial<GameObject> = {}): GameObject {
  const obj: GameObject = {
    instanceId: `obj-${r.state.objects.length + 1}`,
    cardOracleId: `card-${r.state.objects.length + 1}`,
    zone,
    ownerSeat: seat,
    controllerSeat: seat,
    tapped: false,
    faceDown: false,
    counters: {},
    x: 0,
    y: 0,
    ...extra,
  };
  r.state.objects.push(obj);
  return obj;
}

beforeEach(() => {
  room = new Room("TEST1");
});

describe("seating", () => {
  it("assigns sequential seats", async () => {
    expect(await seat(room, "a", "A")).toBe(0);
    expect(await seat(room, "b", "B")).toBe(1);
  });

  it("returns the same seat when a player rejoins", async () => {
    const first = await seat(room, "a", "A");
    room.leave("a");
    expect(await seat(room, "a", "A")).toBe(first);
    expect(room.state.players).toHaveLength(1);
  });

  it("marks a player reconnected rather than duplicating them", async () => {
    await seat(room, "a", "A");
    room.leave("a");
    expect(room.state.players[0].connected).toBe(false);
    await seat(room, "a", "A");
    expect(room.state.players[0].connected).toBe(true);
  });

  it("refuses a fifth player", async () => {
    for (const id of ["a", "b", "c", "d"]) await seat(room, id, id);
    const result = await room.join("e", "E", null);
    expect(result).toHaveProperty("error");
  });
});

describe("moving cards", () => {
  it("returns control to the owner when a permanent leaves the battlefield", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    const stolen = addObject(room, 0, "battlefield", { controllerSeat: 1 });

    room.moveObject(stolen.instanceId, "graveyard");

    expect(stolen.controllerSeat).toBe(0);
    expect(stolen.zone).toBe("graveyard");
  });

  it("untaps and turns a card face up when it leaves the battlefield", async () => {
    await seat(room, "a", "A");
    const card = addObject(room, 0, "battlefield", { tapped: true, faceDown: true });

    room.moveObject(card.instanceId, "hand");

    expect(card.tapped).toBe(false);
    expect(card.faceDown).toBe(false);
  });

  it("keeps tap state while staying on the battlefield", async () => {
    await seat(room, "a", "A");
    const card = addObject(room, 0, "battlefield", { tapped: true });

    room.moveObject(card.instanceId, "battlefield", 120, 40);

    expect(card.tapped).toBe(true);
    expect([card.x, card.y]).toEqual([120, 40]);
  });

  it("ignores unknown instance ids", async () => {
    await seat(room, "a", "A");
    expect(() => room.moveObject("does-not-exist", "graveyard")).not.toThrow();
  });
});

describe("drawing and shuffling", () => {
  it("moves cards from the library to the hand", async () => {
    await seat(room, "a", "A");
    for (let i = 0; i < 5; i++) addObject(room, 0, "library");

    room.drawCards(0, 2);

    expect(room.state.objects.filter((o) => o.zone === "hand")).toHaveLength(2);
    expect(room.state.objects.filter((o) => o.zone === "library")).toHaveLength(3);
  });

  it("does not draw past the end of the library", async () => {
    await seat(room, "a", "A");
    addObject(room, 0, "library");

    room.drawCards(0, 5);

    expect(room.state.objects.filter((o) => o.zone === "hand")).toHaveLength(1);
  });

  it("only draws the requesting player's cards", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    addObject(room, 0, "library");
    addObject(room, 1, "library");

    room.drawCards(0, 5);

    expect(room.state.objects.filter((o) => o.zone === "hand" && o.ownerSeat === 1)).toHaveLength(0);
  });

  it("keeps every library card when shuffling", async () => {
    await seat(room, "a", "A");
    for (let i = 0; i < 20; i++) addObject(room, 0, "library");
    const before = room.state.objects.filter((o) => o.zone === "library").map((o) => o.instanceId).sort();

    room.shuffleLibrary(0);

    const after = room.state.objects.filter((o) => o.zone === "library").map((o) => o.instanceId).sort();
    expect(after).toEqual(before);
  });

  it("returns a library snapshot containing only that player's cards", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    for (let i = 0; i < 3; i++) addObject(room, 0, "library");
    addObject(room, 1, "library");

    const snapshot = room.librarySnapshot(0);

    expect(snapshot).toHaveLength(3);
    expect(snapshot.every((o) => o.ownerSeat === 0)).toBe(true);
  });
});

describe("turn order", () => {
  it("passes to the next connected seat and wraps around", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    await seat(room, "c", "C");

    room.passTurn();
    expect(room.state.turnSeat).toBe(1);
    room.passTurn();
    expect(room.state.turnSeat).toBe(2);
    room.passTurn();
    expect(room.state.turnSeat).toBe(0);
  });

  it("skips disconnected players", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    await seat(room, "c", "C");
    room.leave("b");

    room.passTurn();

    expect(room.state.turnSeat).toBe(2);
  });

  it("starts the new turn at the untap step", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");
    room.setPhase("main2");

    room.passTurn();

    expect(room.state.phase).toBe("untap");
  });
});

describe("commander damage", () => {
  it("records damage per attacking commander", async () => {
    await seat(room, "a", "A");
    await seat(room, "b", "B");

    room.setCommanderDamage(1, 0, 7);

    expect(room.state.players[0].commanderDamageTaken[1]).toBe(7);
    expect(room.state.players[1].commanderDamageTaken).toEqual({});
  });
});

describe("spectators", () => {
  it("adds and removes watchers", async () => {
    room.addSpectator("watcher", "Watcher");
    expect(room.state.spectators).toHaveLength(1);
    room.removeSpectator("watcher");
    expect(room.state.spectators).toHaveLength(0);
  });

  it("does not add the same watcher twice", () => {
    room.addSpectator("watcher", "Watcher");
    room.addSpectator("watcher", "Watcher");
    expect(room.state.spectators).toHaveLength(1);
  });

  it("routes a spectator leaving through leave()", () => {
    room.addSpectator("watcher", "Watcher");
    room.leave("watcher");
    expect(room.state.spectators).toHaveLength(0);
  });

  it("counts a room with only spectators as empty, since nobody is playing", async () => {
    await seat(room, "a", "A");
    room.addSpectator("watcher", "Watcher");
    room.leave("a");
    expect(room.isEmpty()).toBe(true);
  });
});

describe("room manager", () => {
  it("creates rooms with distinct codes", () => {
    const manager = new RoomManager();
    const codes = new Set(Array.from({ length: 50 }, () => manager.createRoom().state.roomCode));
    expect(codes.size).toBe(50);
  });

  it("reuses an existing room for the same code", () => {
    const manager = new RoomManager();
    const created = manager.getOrCreate("ABCDE");
    expect(manager.getOrCreate("ABCDE")).toBe(created);
  });

  it("drops a room once everyone has left", async () => {
    const manager = new RoomManager();
    const created = manager.getOrCreate("ABCDE");
    await seat(created, "a", "A");
    created.leave("a");
    manager.cleanupIfEmpty("ABCDE");
    expect(manager.get("ABCDE")).toBeUndefined();
  });
});
