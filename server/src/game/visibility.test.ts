import { describe, expect, it } from "vitest";
import type { GameObject, GameState, PlayerState, ZoneId } from "@mtg-commander/shared";
import { redactStateFor } from "./visibility";

/**
 * These are the rules that keep a game honest: anything that leaks here is
 * visible to anyone who opens devtools, no matter what the UI draws.
 */

let counter = 0;
function obj(zone: ZoneId, ownerSeat: number, extra: Partial<GameObject> = {}): GameObject {
  counter += 1;
  return {
    instanceId: `obj-${counter}`,
    cardOracleId: `card-${counter}`,
    zone,
    ownerSeat,
    controllerSeat: ownerSeat,
    tapped: false,
    faceDown: false,
    counters: {},
    x: 0,
    y: 0,
    ...extra,
  };
}

function player(seat: number): PlayerState {
  return {
    seat,
    userId: `user-${seat}`,
    displayName: `Player ${seat}`,
    life: 40,
    commanderDamageTaken: {},
    poison: 0,
    connected: true,
    deckId: null,
  };
}

function state(objects: GameObject[]): GameState {
  return {
    roomCode: "TEST1",
    players: [player(0), player(1)],
    spectators: [],
    objects,
    log: [],
    turnSeat: 0,
    phase: "main1",
  };
}

describe("libraries", () => {
  it("never sends library objects to anyone, including their owner", () => {
    const s = state([obj("library", 0), obj("library", 0), obj("library", 1)]);
    for (const viewer of [0, 1, null]) {
      const view = redactStateFor(s, viewer);
      expect(view.objects.filter((o) => o.zone === "library")).toHaveLength(0);
    }
  });

  it("reports library sizes per seat instead", () => {
    const s = state([obj("library", 0), obj("library", 0), obj("library", 1)]);
    expect(redactStateFor(s, 0).librarySizes).toEqual({ 0: 2, 1: 1 });
  });

  it("reports zero for a player whose library is empty", () => {
    const s = state([obj("hand", 0)]);
    expect(redactStateFor(s, 0).librarySizes).toEqual({ 0: 0, 1: 0 });
  });
});

describe("hands", () => {
  it("blanks an opponent's hand but keeps the card count", () => {
    const s = state([obj("hand", 1), obj("hand", 1)]);
    const view = redactStateFor(s, 0);
    const opponentHand = view.objects.filter((o) => o.zone === "hand");
    expect(opponentHand).toHaveLength(2);
    expect(opponentHand.every((o) => o.cardOracleId === null)).toBe(true);
  });

  it("keeps your own hand visible to you", () => {
    const s = state([obj("hand", 0)]);
    const mine = redactStateFor(s, 0).objects.filter((o) => o.zone === "hand");
    expect(mine[0].cardOracleId).not.toBeNull();
  });
});

describe("face-down cards", () => {
  it("hides a face-down permanent from players who don't control it", () => {
    const s = state([obj("battlefield", 1, { faceDown: true })]);
    expect(redactStateFor(s, 0).objects[0].cardOracleId).toBeNull();
  });

  it("shows a face-down permanent to its controller", () => {
    const s = state([obj("battlefield", 1, { faceDown: true })]);
    expect(redactStateFor(s, 1).objects[0].cardOracleId).not.toBeNull();
  });

  it("follows control rather than ownership", () => {
    // Seat 1 owns the card but seat 0 controls it, so seat 0 may see it.
    const s = state([obj("battlefield", 1, { faceDown: true, controllerSeat: 0 })]);
    expect(redactStateFor(s, 0).objects[0].cardOracleId).not.toBeNull();
    expect(redactStateFor(s, 1).objects[0].cardOracleId).toBeNull();
  });
});

describe("public zones", () => {
  it.each(["battlefield", "graveyard", "exile", "command"] as const)("keeps %s visible to everyone", (zone) => {
    const s = state([obj(zone, 1)]);
    for (const viewer of [0, 1, null]) {
      expect(redactStateFor(s, viewer).objects[0].cardOracleId).not.toBeNull();
    }
  });
});

describe("spectators", () => {
  it("hides every hand from a spectator", () => {
    const s = state([obj("hand", 0), obj("hand", 1)]);
    const view = redactStateFor(s, null);
    expect(view.objects).toHaveLength(2);
    expect(view.objects.every((o) => o.cardOracleId === null)).toBe(true);
  });

  it("hides every face-down permanent from a spectator", () => {
    const s = state([obj("battlefield", 0, { faceDown: true })]);
    expect(redactStateFor(s, null).objects[0].cardOracleId).toBeNull();
  });
});

describe("state integrity", () => {
  it("leaves the server's own copy untouched", () => {
    const s = state([obj("hand", 1), obj("library", 0)]);
    const before = JSON.stringify(s);
    redactStateFor(s, 0);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("passes through public game state unchanged", () => {
    const s = state([obj("battlefield", 0)]);
    s.turnSeat = 1;
    s.phase = "combat_damage";
    const view = redactStateFor(s, 0);
    expect(view.roomCode).toBe("TEST1");
    expect(view.turnSeat).toBe(1);
    expect(view.phase).toBe("combat_damage");
    expect(view.players).toHaveLength(2);
  });
});
