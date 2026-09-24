import { beforeEach, describe, expect, it } from "vitest";
import type { BracketId, PodSize } from "@mtg-commander/shared";
import { MatchmakingQueue, type QueueEntry } from "./matchmaking";

let queue: MatchmakingQueue;
let seq = 0;

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  seq += 1;
  return {
    userId: `user-${seq}`,
    socketId: `socket-${seq}`,
    displayName: `Player ${seq}`,
    deckId: `deck-${seq}`,
    bracket: 2 as BracketId,
    podSize: 4 as PodSize,
    joinedAt: Date.now() + seq,
    ...overrides,
  };
}

beforeEach(() => {
  queue = new MatchmakingQueue();
});

describe("pod formation", () => {
  it("does not form a pod before enough players are waiting", () => {
    queue.join(entry({ podSize: 4 }));
    queue.join(entry({ podSize: 4 }));
    queue.join(entry({ podSize: 4 }));
    expect(queue.takePod(2, 4)).toBeNull();
    expect(queue.statusFor(2, 4).waiting).toBe(3);
  });

  it("forms a pod once the requested size is reached", () => {
    for (let i = 0; i < 4; i++) queue.join(entry({ podSize: 4 }));
    const pod = queue.takePod(2, 4);
    expect(pod).toHaveLength(4);
    expect(queue.statusFor(2, 4).waiting).toBe(0);
  });

  it("matches first come, first served", () => {
    const first = entry({ displayName: "first" });
    const second = entry({ displayName: "second" });
    const third = entry({ displayName: "third" });
    const fourth = entry({ displayName: "fourth" });
    const fifth = entry({ displayName: "fifth" });
    for (const e of [first, second, third, fourth, fifth]) queue.join(e);

    const pod = queue.takePod(2, 4)!;
    expect(pod.map((p) => p.displayName)).toEqual(["first", "second", "third", "fourth"]);
    expect(queue.statusFor(2, 4).waiting).toBe(1);
  });
});

describe("queue separation", () => {
  it("never mixes brackets", () => {
    for (let i = 0; i < 3; i++) queue.join(entry({ bracket: 2 }));
    for (let i = 0; i < 3; i++) queue.join(entry({ bracket: 4 }));
    expect(queue.takePod(2, 4)).toBeNull();
    expect(queue.statusFor(2, 4).waiting).toBe(3);
    expect(queue.statusFor(4, 4).waiting).toBe(3);
  });

  it("never mixes pod sizes", () => {
    for (let i = 0; i < 2; i++) queue.join(entry({ podSize: 3 }));
    for (let i = 0; i < 2; i++) queue.join(entry({ podSize: 4 }));
    expect(queue.takePod(2, 3)).toBeNull();
    expect(queue.statusFor(2, 3).waiting).toBe(2);
    expect(queue.statusFor(2, 4).waiting).toBe(2);
  });

  it("forms a three-player pod when that is what was asked for", () => {
    for (let i = 0; i < 3; i++) queue.join(entry({ podSize: 3 }));
    expect(queue.takePod(2, 3)).toHaveLength(3);
  });
});

describe("leaving", () => {
  it("removes a player from the queue", () => {
    const leaving = entry();
    queue.join(leaving);
    queue.join(entry());
    expect(queue.leave(leaving.userId)?.userId).toBe(leaving.userId);
    expect(queue.statusFor(2, 4).waiting).toBe(1);
  });

  it("returns null when the player was not queued", () => {
    expect(queue.leave("nobody")).toBeNull();
  });

  it("does not double-book a player who queues twice", () => {
    const player = entry();
    queue.join(player);
    queue.join({ ...player, socketId: "reconnected" });
    expect(queue.statusFor(2, 4).waiting).toBe(1);
    expect(queue.waitingIn(2, 4)[0].socketId).toBe("reconnected");
  });

  it("moves a player who requeues into a different bracket", () => {
    const player = entry({ bracket: 2 });
    queue.join(player);
    queue.join({ ...player, bracket: 4 as BracketId });
    expect(queue.statusFor(2, 4).waiting).toBe(0);
    expect(queue.statusFor(4, 4).waiting).toBe(1);
  });
});
