import { randomUUID } from "node:crypto";
import type { GameLogEntry, GameObject, GameState, PlayerState, TurnPhase, ZoneId } from "@mtg-commander/shared";
import { MAX_PLAYERS_PER_ROOM } from "@mtg-commander/shared";
import { prisma } from "../db";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class Room {
  state: GameState;

  constructor(roomCode: string) {
    this.state = {
      roomCode,
      players: [],
      objects: [],
      log: [],
      turnSeat: 0,
      phase: "main1",
    };
  }

  private nextFreeSeat(): number | null {
    const taken = new Set(this.state.players.map((p) => p.seat));
    for (let seat = 0; seat < MAX_PLAYERS_PER_ROOM; seat++) {
      if (!taken.has(seat)) return seat;
    }
    return null;
  }

  private addLog(message: string, seat: number | null = null): GameLogEntry {
    const entry: GameLogEntry = { id: randomUUID(), timestamp: new Date().toISOString(), seat, message };
    this.state.log.push(entry);
    return entry;
  }

  async join(userId: string, displayName: string, deckId: string | null): Promise<{ seat: number; player: PlayerState } | { error: string }> {
    const existing = this.state.players.find((p) => p.userId === userId);
    if (existing) {
      existing.connected = true;
      return { seat: existing.seat, player: existing };
    }

    const seat = this.nextFreeSeat();
    if (seat === null) return { error: "Room is full (max 4 players)." };

    const player: PlayerState = {
      seat,
      userId,
      displayName,
      life: 40,
      commanderDamageTaken: {},
      poison: 0,
      connected: true,
      deckId,
    };
    this.state.players.push(player);

    if (deckId) {
      await this.loadDeckIntoLibrary(seat, deckId, userId);
    }

    this.addLog(`${displayName} joined the game (seat ${seat}).`, seat);
    return { seat, player };
  }

  private async loadDeckIntoLibrary(seat: number, deckId: string, userId: string) {
    // Scoped to the owner so a player can't load someone else's deck by id.
    const deck = await prisma.deck.findFirst({ where: { id: deckId, ownerId: userId }, include: { cards: true } });
    if (!deck) return;

    const commanderCards: GameObject[] = [];
    const libraryCards: GameObject[] = [];

    for (const dc of deck.cards) {
      for (let i = 0; i < dc.quantity; i++) {
        const obj: GameObject = {
          instanceId: randomUUID(),
          cardOracleId: dc.cardOracleId,
          zone: dc.isCommander ? "command" : "library",
          ownerSeat: seat,
          controllerSeat: seat,
          tapped: false,
          faceDown: false,
          counters: {},
          x: 0,
          y: 0,
        };
        (dc.isCommander ? commanderCards : libraryCards).push(obj);
      }
    }

    this.state.objects.push(...commanderCards, ...shuffle(libraryCards));
  }

  leave(userId: string) {
    const player = this.state.players.find((p) => p.userId === userId);
    if (!player) return;
    player.connected = false;
    this.addLog(`${player.displayName} disconnected.`, player.seat);
  }

  isEmpty(): boolean {
    return this.state.players.every((p) => !p.connected);
  }

  getObject(instanceId: string): GameObject | undefined {
    return this.state.objects.find((o) => o.instanceId === instanceId);
  }

  moveObject(instanceId: string, toZone: ZoneId, x?: number, y?: number) {
    const obj = this.getObject(instanceId);
    if (!obj) return;
    obj.zone = toZone;
    if (x !== undefined) obj.x = x;
    if (y !== undefined) obj.y = y;
    if (toZone !== "battlefield") {
      obj.tapped = false;
      obj.faceDown = false;
      // Control effects end when a permanent leaves the battlefield, and the
      // card returns to its owner's zones.
      obj.controllerSeat = obj.ownerSeat;
    }
  }

  tapObject(instanceId: string, tapped: boolean) {
    const obj = this.getObject(instanceId);
    if (obj) obj.tapped = tapped;
  }

  flipObject(instanceId: string, faceDown: boolean) {
    const obj = this.getObject(instanceId);
    if (obj) obj.faceDown = faceDown;
  }

  setController(instanceId: string, toSeat: number) {
    const obj = this.getObject(instanceId);
    if (obj) obj.controllerSeat = toSeat;
  }

  drawCards(seat: number, count: number) {
    const library = this.state.objects.filter((o) => o.ownerSeat === seat && o.zone === "library");
    for (let i = 0; i < count && i < library.length; i++) {
      library[i].zone = "hand";
    }
  }

  /**
   * The owner's own library, shuffled before it leaves the server so that
   * looking through it doesn't also reveal the order cards will be drawn in.
   */
  librarySnapshot(seat: number): GameObject[] {
    return shuffle(this.state.objects.filter((o) => o.ownerSeat === seat && o.zone === "library"));
  }

  shuffleLibrary(seat: number) {
    const libraryObjs = this.state.objects.filter((o) => o.ownerSeat === seat && o.zone === "library");
    const shuffled = shuffle(libraryObjs);
    let idx = 0;
    this.state.objects = this.state.objects.map((o) =>
      o.ownerSeat === seat && o.zone === "library" ? shuffled[idx++] : o
    );
  }

  setLife(seat: number, life: number) {
    const player = this.state.players.find((p) => p.seat === seat);
    if (player) player.life = life;
  }

  setCommanderDamage(fromSeat: number, toSeat: number, amount: number) {
    const player = this.state.players.find((p) => p.seat === toSeat);
    if (player) player.commanderDamageTaken[fromSeat] = amount;
  }

  setPhase(phase: TurnPhase) {
    this.state.phase = phase;
  }

  passTurn() {
    const activeSeats = this.state.players.filter((p) => p.connected).map((p) => p.seat);
    if (activeSeats.length === 0) return;
    const currentIdx = activeSeats.indexOf(this.state.turnSeat);
    const next = activeSeats[(currentIdx + 1) % activeSeats.length];
    this.state.turnSeat = next;
    this.state.phase = "untap";
  }

  log(message: string, seat: number | null): GameLogEntry {
    return this.addLog(message, seat);
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  private generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(): Room {
    const code = this.generateCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getOrCreate(roomCode: string): Room {
    const existing = this.rooms.get(roomCode);
    if (existing) return existing;
    const room = new Room(roomCode);
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  cleanupIfEmpty(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (room && room.isEmpty()) this.rooms.delete(roomCode);
  }
}

export const roomManager = new RoomManager();
