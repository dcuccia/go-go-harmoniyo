import { describe, expect, it } from 'vitest';
import { KEYBOARD, Seating, seededRng, TV } from '../src/seating';
import { levelOf, partCards, partNames } from '../src/parts';
import { buildTeamChart, findPart, type S5Chart, type S5Part } from '../src/team-chart';

const seat = (names: string[], seats: string[]): Seating => {
  const s = new Seating();
  s.setParts(names);
  seats.forEach((p, i) => p !== TV && s.assign(i, p));
  return s;
};
const ABC = ['Low melody', 'Middle melody', 'High melody'];

describe('Seating: claim / swap', () => {
  it('a player claiming a free part moves there; their old part goes to the TV', () => {
    const s = seat(ABC, ['alice', 'bob', TV]);
    expect(s.assign(2, 'alice')).toBe(TV);
    expect(s.seats).toEqual([TV, 'bob', 'alice']);
  });
  it('claiming a taken part swaps the two players', () => {
    const s = seat(ABC, ['alice', 'bob', TV]);
    expect(s.assign(1, 'alice')).toBe('bob');
    expect(s.seats).toEqual(['bob', 'alice', TV]);
  });
  it('a bench player taking a seat sends the occupant to the bench (without auto-return)', () => {
    const s = seat(['Melody'], ['alice']);
    expect(s.assign(0, 'bob')).toBe('alice');
    expect(s.seats).toEqual(['bob']);
    s.setParts(['Low melody', 'High melody']);
    expect(s.seats).toEqual(['bob', TV]);
  });
  it('TV on a part benches its player; sit out (-1) frees the part', () => {
    const s = seat(ABC, ['alice', 'bob', KEYBOARD]);
    s.assign(1, TV);
    expect(s.seats).toEqual(['alice', TV, KEYBOARD]);
    s.assign(-1, KEYBOARD);
    expect(s.seats).toEqual(['alice', TV, TV]);
  });
  it('swap(a, b) swaps two parts, TV included', () => {
    const s = seat(ABC, ['alice', TV, 'bob']);
    s.swap(0, 1);
    expect(s.seats).toEqual([TV, 'alice', 'bob']);
    s.swap(1, 2);
    expect(s.seats).toEqual([TV, 'bob', 'alice']);
    s.swap(0, 9);
    expect(s.seats).toEqual([TV, 'bob', 'alice']);
  });
});

describe('Seating: helpers', () => {
  it('rotate moves everyone (and the TV parts) one part to the right', () => {
    const s = seat(ABC, ['alice', 'bob', TV]);
    s.rotate();
    expect(s.seats).toEqual([TV, 'alice', 'bob']);
    s.rotate();
    s.rotate();
    expect(s.seats).toEqual(['alice', 'bob', TV]);
  });
  it('shuffle is deterministic for a seed and keeps every player seated', () => {
    const a = seat(['A', 'B', 'C', 'D'], ['alice', 'bob', 'cara', TV]);
    const b = seat(['A', 'B', 'C', 'D'], ['alice', 'bob', 'cara', TV]);
    a.shuffle(seededRng(42));
    b.shuffle(seededRng(42));
    expect(a.seats).toEqual(b.seats);
    expect([...a.players].sort()).toEqual(['alice', 'bob', 'cara']);
    expect(a.seats.filter((p) => p === TV)).toHaveLength(1);
    // Different seeds give different layouts.
    const seen = new Set(
      [1, 2, 3, 4, 5].map((k) => {
        const s = seat(['A', 'B', 'C', 'D'], ['alice', 'bob', 'cara', TV]);
        s.shuffle(seededRng(k));
        return s.seats.join();
      }),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
  it('shuffle seats bench players too; with more players than parts the extras sit out', () => {
    const s = seat(['A', 'B'], ['alice', TV]);
    const out = s.shuffle(seededRng(7), ['bob', 'cara']);
    expect(s.players).toHaveLength(2);
    expect(out).toHaveLength(1);
    expect([...s.players, ...out].sort()).toEqual(['alice', 'bob', 'cara']);
  });
  it('balance gives the easiest part to the lowest accuracy, over the parts players hold', () => {
    const s = seat(['Bass', 'Harmony', 'Melody', 'Extra'], ['alice', 'bob', 'cara', TV]);
    const effort = [0.9, 0.3, 1.4, 0.1]; // Extra (TV) is easiest but stays with the TV
    s.balance(effort, new Map([['alice', 0.95], ['bob', 0.6], ['cara', 0.8]]), seededRng(1));
    expect(s.seats).toEqual(['cara', 'bob', 'alice', TV]);
  });
  it('balance: no history = random (seeded); unknown players count as the average', () => {
    const s = seat(['A', 'B', 'C'], ['alice', 'bob', 'cara']);
    const t = seat(['A', 'B', 'C'], ['alice', 'bob', 'cara']);
    s.balance([1, 2, 3], new Map(), seededRng(3));
    t.balance([1, 2, 3], new Map(), seededRng(3));
    expect(s.seats).toEqual(t.seats);
    expect([...s.players].sort()).toEqual(['alice', 'bob', 'cara']);
    const u = seat(['A', 'B', 'C'], ['alice', 'bob', 'cara']);
    u.balance([1, 2, 3], new Map([['alice', 0.5], ['bob', 0.9]]), seededRng(3)); // cara ≈ 0.7
    expect(u.seats).toEqual(['alice', 'cara', 'bob']);
  });
});

describe('Seating: persistence', () => {
  it('seats persist across a song/difficulty change with the same part names', () => {
    const s = seat(ABC, [TV, 'alice', 'bob']);
    s.setParts(ABC);
    expect(s.seats).toEqual([TV, 'alice', 'bob']);
  });
  it('ringer count change keeps players on same-named parts, then the same index, then the first TV part', () => {
    const s = seat(['Low melody', 'High melody'], ['alice', 'bob']);
    s.setParts(ABC);
    expect(s.seats).toEqual(['alice', TV, 'bob']);
    s.setParts(['Bass', 'Harmony', 'Melody']); // no names in common: by index
    expect(s.seats).toEqual(['alice', TV, 'bob']);
    s.setParts(['Melody']); // 3 → 1: bob keeps "Melody", alice goes to the bench
    expect(s.seats).toEqual(['bob']);
    s.setParts(['Bass', 'Melody']);
    expect(s.seats).toEqual([TV, 'bob']);
    expect(s.join('alice')).toBe(0); // back on "Bass"
  });
  it('players beyond the new count go to the bench and come back by name', () => {
    const s = seat(['A', 'B', 'C'], ['alice', 'bob', 'cara']);
    expect(s.setParts(['A', 'B'])).toEqual(['cara']);
    expect(s.seats).toEqual(['alice', 'bob']);
    s.setParts(['A', 'B', 'C']);
    expect(s.seats).toEqual(['alice', 'bob', TV]);
    s.fill(['alice', 'bob', 'cara']); // the game fills after every arrangement change
    expect(s.seats).toEqual(['alice', 'bob', 'cara']);
  });
  it('sit out survives a reconnect and fill(); claiming a part clears it', () => {
    const s = seat(ABC, ['alice', 'bob', TV]);
    s.assign(-1, 'bob');
    expect(s.seats).toEqual(['alice', TV, TV]);
    s.leave('bob'); // screen lock
    expect(s.join('bob')).toBe(-1);
    s.fill(['alice', 'bob']);
    expect(s.seats).toEqual(['alice', TV, TV]);
    expect(s.isBenched('bob')).toBe(true);
    s.assign(2, 'bob');
    expect(s.isBenched('bob')).toBe(false);
    s.leave('bob');
    expect(s.join('bob')).toBe(2);
  });
  it('a player displaced to the bench by someone else stays there; fill seats newcomers', () => {
    const s = seat(['A', 'B'], ['alice', TV]);
    s.assign(0, 'bob'); // bob from the bench takes alice's part
    s.fill(['alice', 'bob', 'cara']);
    expect(s.seats).toEqual(['bob', 'cara']);
    expect(s.isBenched('alice')).toBe(true);
  });
  it('a late joiner takes the first TV-played part, or the bench when every part is taken', () => {
    const s = seat(ABC, ['alice', TV, TV]);
    expect(s.join('bob')).toBe(1);
    expect(s.join('cara')).toBe(2);
    expect(s.join('dan')).toBe(-1);
    expect(s.join('bob')).toBe(1); // already seated
  });
  it('disconnect → TV plays the part; reconnect reclaims it (unless someone took it)', () => {
    const s = seat(ABC, ['alice', 'bob', 'cara']);
    expect(s.leave('bob')).toBe(1);
    expect(s.seats).toEqual(['alice', TV, 'cara']);
    expect(s.join('bob')).toBe(1);
    s.leave('bob');
    s.assign(1, 'dan'); // dan from the bench takes bob's part
    s.leave('cara');
    expect(s.join('bob')).toBe(2); // first TV part
  });
  it('reconnect reclaims by part name after the arrangement changed', () => {
    const s = seat(ABC, ['alice', TV, 'bob']);
    s.leave('bob');
    s.setParts(['Low melody', 'High melody']);
    expect(s.seats).toEqual(['alice', TV]);
    expect(s.join('bob')).toBe(1); // "High melody"
  });
});

describe('part cards', () => {
  const chart = (roles: ('melody' | 'bass' | 'inner' | undefined)[][]): S5Part => ({
    difficulty: 'hard',
    ringerCount: roles.length,
    ringers: roles.map((_, i) => ({ index: i, bells: [`C${4 + i}`] })),
    notes: roles.flatMap((rs, i) => rs.map((role, k) => ({ tick: k, time: k, bell: `C${4 + i}`, ringer: i, role }))),
  });
  it('names parts from their note roles, qualified low → high when a role repeats', () => {
    expect(partNames(chart([['bass', 'bass', 'melody'], ['inner', 'melody', 'inner'], ['melody']]))).toEqual(['Bass', 'Harmony', 'Melody']);
    expect(partNames(chart([['melody'], ['melody']]))).toEqual(['Low melody', 'High melody']);
    expect(partNames(chart([['melody'], ['melody'], ['melody']]))).toEqual(['Low melody', 'Middle melody', 'High melody']);
    expect(partNames(chart([['bass'], ['inner'], ['inner'], ['melody']]))).toEqual(['Bass', 'Low harmony', 'High harmony', 'Melody']);
    expect(partNames(chart([['melody'], [undefined]]))).toEqual(['Ringer 1', 'Ringer 2']);
  });
  it('level meter thresholds', () => {
    expect([0, 0.49, 0.5, 1.0, 1.5, 5].map(levelOf)).toEqual([1, 1, 2, 3, 4, 5]);
  });

  const jingle = (import.meta.glob('../public/charts/jingle-bells.json', { eager: true, import: 'default' }) as Record<string, S5Chart>)['../public/charts/jingle-bells.json'];
  it.skipIf(!jingle)('real charts: Jingle Bells hard ×3 is Bass / Harmony / Melody with ranges, colours and a sensible meter', () => {
    const c = jingle;
    const part = findPart(c, 'hard', 3)!;
    const cards = partCards(c, part, buildTeamChart(c, part));
    expect(cards.map((p) => p.name)).toEqual(['Bass', 'Harmony', 'Melody']);
    for (const p of cards) {
      expect(p.bells.length).toBeGreaterThan(0);
      expect(p.bells.length).toBeLessThanOrEqual(4);
      expect(p.range).toMatch(/^[A-G]♯?\d(–[A-G]♯?\d)?$/);
      expect(p.level).toBeGreaterThanOrEqual(1);
      expect(p.level).toBeLessThanOrEqual(5);
      expect(p.bells.every((b) => /^hsl|^#/.test(b.color))).toBe(true);
    }
    const easy = findPart(c, 'easy', 3)!;
    const ec = partCards(c, easy, buildTeamChart(c, easy));
    expect(ec.map((p) => p.name)).toEqual(['Low melody', 'Middle melody', 'High melody']);
    expect(Math.max(...ec.map((p) => p.level))).toBeLessThanOrEqual(Math.max(...cards.map((p) => p.level)));
  });
});
