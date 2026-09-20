import type { BracketId, PodSize, QueueStatus } from "@mtg-commander/shared";

export interface QueueEntry {
  userId: string;
  socketId: string;
  displayName: string;
  deckId: string;
  bracket: BracketId;
  podSize: PodSize;
  joinedAt: number;
}

function queueKey(bracket: BracketId, podSize: PodSize): string {
  return `${bracket}:${podSize}`;
}

/**
 * Players queue on (bracket, pod size) and are matched first-come-first-served
 * once enough of them are waiting. Held in memory: a server restart drops the
 * queue, which is the right trade for a queue nobody should sit in for long.
 */
export class MatchmakingQueue {
  private entries = new Map<string, QueueEntry[]>();

  /** Replaces any existing entry for this user, so requeueing can't double-book a seat. */
  join(entry: QueueEntry): void {
    this.leave(entry.userId);
    const key = queueKey(entry.bracket, entry.podSize);
    const bucket = this.entries.get(key) ?? [];
    bucket.push(entry);
    this.entries.set(key, bucket);
  }

  leave(userId: string): QueueEntry | null {
    for (const [key, bucket] of this.entries) {
      const index = bucket.findIndex((e) => e.userId === userId);
      if (index === -1) continue;
      const [removed] = bucket.splice(index, 1);
      if (bucket.length === 0) this.entries.delete(key);
      return removed;
    }
    return null;
  }

  /** Removes and returns a full pod, or null when not enough players are waiting. */
  takePod(bracket: BracketId, podSize: PodSize): QueueEntry[] | null {
    const key = queueKey(bracket, podSize);
    const bucket = this.entries.get(key);
    if (!bucket || bucket.length < podSize) return null;

    const pod = bucket.splice(0, podSize);
    if (bucket.length === 0) this.entries.delete(key);
    return pod;
  }

  waitingIn(bracket: BracketId, podSize: PodSize): QueueEntry[] {
    return this.entries.get(queueKey(bracket, podSize)) ?? [];
  }

  statusFor(bracket: BracketId, podSize: PodSize): QueueStatus {
    return { bracket, podSize, waiting: this.waitingIn(bracket, podSize).length };
  }
}

export const matchmakingQueue = new MatchmakingQueue();
