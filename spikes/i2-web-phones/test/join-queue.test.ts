import { describe, expect, it } from 'vitest';
import { JoinQueue, waitingLabel } from '../src/join-queue';
import { Seating, TV } from '../src/seating';

/** Lobby with Alice and Bob in a 3-part arrangement (the TV plays part 2), then a round starts. */
function midSong() {
  const s = new Seating();
  s.setParts(['Melody', 'Harmony', 'Bass']);
  s.fill(['alice', 'bob']);
  const q = new JoinQueue();
  q.startRound(['alice', 'bob']);
  return { s, q, round: [...s.seats] };
}

describe('drop-in join queue', () => {
  it('queues a phone that joins mid-song and seats it in the first TV-played part when the next round starts', () => {
    const { s, q, round } = midSong();
    expect(round).toEqual(['alice', 'bob', TV]);
    expect(q.update(['alice', 'bob', 'cara'], round, s)).toBe(true);
    expect(q.waiting).toEqual(['cara']);
    expect(waitingLabel(q.waiting.length)).toBe('+1 waiting');
    // Nothing changes for the running round.
    expect(s.seats).toEqual(['alice', 'bob', TV]);
    // Next round (Again / next song): same arrangement, Cara gets the TV's part.
    s.setParts(['Melody', 'Harmony', 'Bass']);
    expect(q.seat(s)).toEqual({ seated: ['cara'], bench: [] });
    expect(s.seats).toEqual(['alice', 'bob', 'cara']);
    expect(q.waiting).toEqual([]);
    expect(waitingLabel(0)).toBe('');
  });

  it('seats in join order: first come, first TV-played part; the rest go to the bench', () => {
    const s = new Seating();
    s.setParts(['Melody', 'Harmony', 'Bass']);
    s.fill(['alice']);
    const q = new JoinQueue();
    q.startRound(['alice']);
    const round = [...s.seats];
    q.update(['alice', 'dan'], round, s);
    q.update(['alice', 'dan', 'cara'], round, s);
    q.update(['alice', 'dan', 'cara', 'eve'], round, s);
    expect(q.waiting).toEqual(['dan', 'cara', 'eve']);
    expect(q.seat(s)).toEqual({ seated: ['dan', 'cara'], bench: ['eve'] });
    expect(s.seats).toEqual(['alice', 'dan', 'cara']);
  });

  it('ignores phones already in the round (a reconnect mid-song) and phones that sat out', () => {
    const { s, q, round } = midSong();
    // Bob's screen goes off and back on mid-song: he is still in this round, not waiting.
    q.update(['alice'], round, s);
    q.update(['alice', 'bob'], round, s);
    expect(q.waiting).toEqual([]);
    // Fay sat out in an earlier lobby, then reconnects: she stays on the bench.
    s.assign(-1, 'fay');
    q.update(['alice', 'bob', 'fay'], round, s);
    expect(q.waiting).toEqual([]);
  });

  it('drops a waiting phone that leaves, and re-queues it if it comes back', () => {
    const { s, q, round } = midSong();
    q.update(['alice', 'bob', 'cara'], round, s);
    expect(q.update(['alice', 'bob'], round, s)).toBe(true);
    expect(q.waiting).toEqual([]);
    q.update(['alice', 'bob', 'cara'], round, s);
    expect(q.waiting).toEqual(['cara']);
    expect(q.update(['alice', 'bob', 'cara'], round, s)).toBe(false);
  });

  it('a waiting phone that picks a part on the results screen keeps it', () => {
    const { s, q, round } = midSong();
    q.update(['alice', 'bob', 'cara'], round, s);
    // Results screen: Cara takes Alice's part (swap from the bench sends Alice to the bench).
    s.assign(0, 'cara');
    expect(q.remove('cara')).toBe(true);
    s.setParts(['Melody', 'Harmony', 'Bass']);
    expect(q.seat(s)).toEqual({ seated: [], bench: [] });
    expect(s.seats).toEqual(['cara', 'bob', TV]);
  });

  it('keeps seating rules across an arrangement change (more ringers next song)', () => {
    const { s, q, round } = midSong();
    q.update(['alice', 'bob', 'cara', 'dan'], round, s);
    // Next song has four parts: Alice and Bob keep theirs by name; the waiting phones fill the rest.
    s.setParts(['Melody', 'Harmony', 'Tenor', 'Bass']);
    expect(q.seat(s).seated).toEqual(['cara', 'dan']);
    expect(s.seats).toEqual(['alice', 'bob', 'cara', 'dan']);
  });

  it('does nothing outside a round (the lobby seats phones directly)', () => {
    const s = new Seating();
    s.setParts(['Melody']);
    const q = new JoinQueue();
    expect(q.update(['alice'], [], s)).toBe(false);
    expect(q.waiting).toEqual([]);
    // After seat() the queue is closed until the next round starts.
    q.startRound([]);
    q.update(['alice'], [TV], s);
    q.seat(s);
    expect(q.update(['alice', 'bob'], [], s)).toBe(false);
  });
});
