// Drop-in joining: phones that join while a round is running (or on its results screen) wait for
// the next round, first come first seated. Pure logic: no DOM, audio or network.
//
// The TV shows "+N waiting" and each waiting phone shows "you're in for the next song". When the
// next round starts (next song, Again, 🔁 Rotate + Again, or back to the lobby) the waiting phones
// are seated in join order with the usual seating rules (Seating.join: their home part if the TV
// plays it, else the first TV-played part); anyone left without a part goes on the bench like a
// late joiner in the lobby. Taking over a TV-played part in the middle of a song is not done here.

/** What the queue needs from the seating chart. */
export interface SeatingLike {
  join(player: string): number;
  isBenched(player: string): boolean;
}

export class JoinQueue {
  private queue: string[] = [];
  /** Phones online when we last looked (to tell arrivals from phones that were already here). */
  private present = new Set<string>();
  private open = false;

  /** Waiting phones, in join order. */
  get waiting(): readonly string[] {
    return this.queue;
  }

  /** A round starts: phones online now are already in it (or chose not to be). */
  startRound(online: readonly string[]): void {
    this.open = true;
    this.present = new Set(online);
  }

  /**
   * Phones online now; `inRound` = players of the running round. A phone that arrives (was not online
   * at the last look), is not playing this round and did not sit out joins the queue; phones that
   * leave drop out of it. Returns true when the queue changed.
   */
  update(online: readonly string[], inRound: readonly string[], seating: Pick<SeatingLike, 'isBenched'>): boolean {
    if (!this.open) return false;
    const before = this.queue.join();
    const now = new Set(online);
    this.queue = this.queue.filter((id) => now.has(id) && !inRound.includes(id) && !seating.isBenched(id));
    for (const id of online) {
      if (this.present.has(id) || this.queue.includes(id) || inRound.includes(id) || seating.isBenched(id)) continue;
      this.queue.push(id);
    }
    this.present = now;
    return this.queue.join() !== before;
  }

  /** A phone picked a part (or sat out) on the results screen: it is no longer just waiting. */
  remove(id: string): boolean {
    const n = this.queue.length;
    this.queue = this.queue.filter((x) => x !== id);
    return this.queue.length !== n;
  }

  /**
   * The next round is being set up (after the new arrangement is in place): seat the waiting phones
   * in join order. Returns who got a part and who is left on the bench. The queue is closed until
   * the next startRound().
   */
  seat(seating: SeatingLike): { seated: string[]; bench: string[] } {
    const seated: string[] = [];
    const bench: string[] = [];
    for (const id of this.queue) (seating.join(id) >= 0 ? seated : bench).push(id);
    this.queue = [];
    this.open = false;
    return { seated, bench };
  }
}

/** "+1 waiting", "+2 waiting"; '' when nobody waits. */
export const waitingLabel = (n: number): string => (n > 0 ? `+${n} waiting` : '');
