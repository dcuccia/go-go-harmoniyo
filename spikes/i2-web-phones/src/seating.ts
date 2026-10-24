// Seating chart: who plays which part (parts × players). Pure logic: no DOM, audio or network.
//
// A seat holds a player id (a phone's deviceId, or KEYBOARD) or TV (the TV rings that part).
// Each player sits in at most one part; players without a part are "on the bench". The model
// remembers where each player last sat ("home"), so seats survive song, difficulty and ringer-count
// changes, and a phone that drops out and reconnects gets its part back.

export const TV = 'tv';
export const KEYBOARD = 'keyboard';

/** Deterministic PRNG (mulberry32) for Shuffle/Balance; tests pass a seed. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Home {
  name: string;
  index: number;
}

export class Seating {
  /** Part index → player id or TV. */
  seats: string[] = [];
  /** Part names of the current arrangement (used to keep players on "their" part when it changes). */
  names: string[] = [];
  private homes = new Map<string, Home>();
  /** Players who sat out or were displaced to the bench: they stay there until they claim a part. */
  private benched = new Set<string>();

  /** Players currently in a part (not TV), in part order. */
  get players(): string[] {
    return this.seats.filter((s) => s !== TV);
  }

  partOf(player: string): number {
    return this.seats.indexOf(player);
  }

  /** Where `player` last sat (kept while they are away). */
  homeOf(player: string): Home | undefined {
    return this.homes.get(player);
  }

  /**
   * A new arrangement (song, difficulty or ringer count changed). Players keep a part with the same
   * name if there is one, else the same index, else the first TV-played part; anyone left over goes
   * to the bench (their home is kept). Returns the players who lost their part.
   */
  setParts(names: string[]): string[] {
    const old = this.seats.map((p, i) => ({ p, name: this.names[i] ?? '', i })).filter((x) => x.p !== TV);
    const seats = names.map(() => TV);
    const left = [...old];
    const place = (pick: (x: (typeof old)[number]) => number): void => {
      for (const x of [...left]) {
        const j = pick(x);
        if (j >= 0 && seats[j] === TV) {
          seats[j] = x.p;
          left.splice(left.indexOf(x), 1);
        }
      }
    };
    place((x) => names.findIndex((n, j) => n === x.name && seats[j] === TV));
    place((x) => (x.i < names.length ? x.i : -1));
    place(() => seats.indexOf(TV));
    this.seats = seats;
    this.names = [...names];
    this.remember();
    return left.map((x) => x.p);
  }

  /**
   * A player arrives (phone joins/reconnects, or the keyboard is added). Takes back their home part
   * if the TV is playing it, else the first TV-played part, else stays on the bench (-1). A player
   * who sat out (or was displaced to the bench) stays there.
   */
  join(player: string): number {
    const at = this.partOf(player);
    if (at >= 0) return at;
    if (this.benched.has(player)) return -1;
    const h = this.homes.get(player);
    const free = (j: number): boolean => j >= 0 && j < this.seats.length && this.seats[j] === TV;
    let j = -1;
    if (h) {
      if (this.names[h.index] === h.name && free(h.index)) j = h.index;
      else j = this.names.findIndex((n, k) => n === h.name && free(k));
      if (j < 0 && free(h.index)) j = h.index;
    }
    if (j < 0) j = this.seats.indexOf(TV);
    if (j < 0) return -1;
    this.seats[j] = player;
    this.remember();
    return j;
  }

  /**
   * Seat every waiting player in `present` (online, not in a part, not benched by choice) — e.g.
   * after the arrangement grows again. Players with a home are placed first (they get it back).
   */
  fill(present: readonly string[]): void {
    const waiting = present.filter((p) => p !== TV && this.partOf(p) < 0 && !this.benched.has(p));
    const order = [...waiting.filter((p) => this.homes.has(p)), ...waiting.filter((p) => !this.homes.has(p))];
    for (const p of order) this.join(p);
  }

  isBenched(player: string): boolean {
    return this.benched.has(player);
  }

  /** A player drops out: their part falls back to the TV; their home is kept for a reconnect. */
  leave(player: string): number {
    const i = this.partOf(player);
    if (i >= 0) this.seats[i] = TV;
    return i;
  }

  /**
   * Put `player` (a player id or TV) on part `part`. A player already in another part swaps with
   * the occupant; a player from the bench sends the occupant to the bench. `part` -1 = sit out.
   * Returns the player who was displaced or swapped (TV if the part was free).
   */
  assign(part: number, player: string): string {
    if (part < 0) {
      if (player !== TV) {
        this.leave(player);
        this.homes.delete(player);
        this.benched.add(player);
      }
      return TV;
    }
    if (part >= this.seats.length) return TV;
    const occupant = this.seats[part];
    if (occupant === player) return occupant;
    const from = player === TV ? -1 : this.partOf(player);
    this.seats[part] = player;
    this.benched.delete(player);
    if (from >= 0) this.seats[from] = occupant;
    else if (occupant !== TV) {
      // Benched by someone else's choice: don't auto-return.
      this.homes.delete(occupant);
      this.benched.add(occupant);
    }
    this.remember();
    return occupant;
  }

  /** Swap whoever plays parts `a` and `b` (drag one part's chip onto another). */
  swap(a: number, b: number): void {
    if (a === b || a < 0 || b < 0 || a >= this.seats.length || b >= this.seats.length) return;
    [this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]];
    this.remember();
  }

  /** Everyone (including the TV's parts) moves one part to the right; the last wraps to the first. */
  rotate(): void {
    const n = this.seats.length;
    if (n < 2) return;
    this.seats = this.seats.map((_, i) => this.seats[(i - 1 + n) % n]);
    this.remember();
  }

  /**
   * Random seats for the current players plus `bench` (e.g. online phones without a part). With more
   * players than parts, who sits out is random too. Deterministic for a given `rng`.
   */
  shuffle(rng: () => number, bench: readonly string[] = []): string[] {
    const everyone = [...this.players, ...bench.filter((p) => p !== TV && !this.seats.includes(p))];
    const players = shuffled(everyone, rng);
    const parts = shuffled(
      this.seats.map((_, i) => i),
      rng,
    );
    const seats = this.seats.map(() => TV);
    players.slice(0, seats.length).forEach((p, k) => {
      seats[parts[k]] = p;
      this.benched.delete(p);
    });
    this.seats = seats;
    for (const p of players.slice(seats.length)) {
      this.homes.delete(p);
      this.benched.add(p);
    }
    this.remember();
    return players.slice(seats.length);
  }

  /**
   * The easiest part goes to the player with the lowest accuracy so far, and so on up: players are
   * redistributed over the parts they already hold (the TV keeps its parts). `effort[i]` is part i's
   * difficulty; `accuracy` holds each player's earlier accuracy (0..1). Players with no history count
   * as the average of those with one; with no history at all the seats are shuffled.
   */
  balance(effort: readonly number[], accuracy: ReadonlyMap<string, number>, rng: () => number): void {
    const idx = this.seats.map((p, i) => (p === TV ? -1 : i)).filter((i) => i >= 0);
    if (idx.length < 2) return;
    const players = idx.map((i) => this.seats[i]);
    const known = players.map((p) => accuracy.get(p)).filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
    let order: string[];
    if (!known.length) order = shuffled(players, rng);
    else {
      const mean = known.reduce((a, b) => a + b, 0) / known.length;
      const acc = (p: string): number => {
        const a = accuracy.get(p);
        return typeof a === 'number' && Number.isFinite(a) ? a : mean;
      };
      order = shuffled(players, rng).sort((a, b) => acc(a) - acc(b)); // shuffle first: random among ties
    }
    const parts = [...idx].sort((a, b) => (effort[a] ?? 0) - (effort[b] ?? 0) || a - b);
    parts.forEach((part, k) => (this.seats[part] = order[k]));
    this.remember();
  }

  private remember(): void {
    this.seats.forEach((p, i) => {
      if (p !== TV) this.homes.set(p, { name: this.names[i] ?? '', index: i });
    });
  }
}
