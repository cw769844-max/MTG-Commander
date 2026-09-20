import type { BracketId } from "./bracket";

/** Commander pods are 4 by default; 3 is common when a fourth isn't around. */
export type PodSize = 3 | 4;

export const POD_SIZES: PodSize[] = [3, 4];

export interface QueueStatus {
  bracket: BracketId;
  podSize: PodSize;
  /** Players currently waiting in this bracket/pod-size queue, including you. */
  waiting: number;
}

export interface MatchFound {
  roomCode: string;
  bracket: BracketId;
  podSize: PodSize;
}
