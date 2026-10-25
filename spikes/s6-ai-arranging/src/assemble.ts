// Assemble an S6 candidate arrangement: intro + tune (with chords) + ending in voice 1, the
// descant in voice 2, then realize bass/inner bells from the chords with S5's lead-sheet
// realizer. Returns a Score (for S5's chart builder), role-labelled notes and the ABC text.
// @ts-ignore -- S5 JS modules
import { realizeLeadSheet, dedupe } from '../../s5-chart-pipeline/src/arrange.mjs';
import { barLengths, fullBar, scoreToAbc, type Chord, type Note, type Score } from './abc-io.ts';
import { bars, type Song } from './songs.ts';

export interface Parts {
  chords: Chord[];
  descant?: Score | null;
  intro?: Score | null;
  ending?: Score | null;
}

export interface Candidate {
  score: Score;
  melody: Note[];
  descant: Note[];
  roleNotes: Note[];
  abc: string;
  introTicks: number;
  shift: number;
}

const clipNotes = (ns: Note[], end: number) => ns.filter((n) => n.tick < end).map((n) => ({ ...n, dur: Math.min(n.dur, end - n.tick) }));

export function assemble(song: Song, parts: Parts, header: { title: string; extra?: string[] }): Candidate {
  const s = song.score;
  const bar = fullBar(s);
  const bs = bars(s);
  const pickup = bs[0].pickup ? bs[0].end - bs[0].start : 0;

  // Intro: complete bars; with a pickup, the tune's upbeat sits inside the intro's last bar.
  const intro = parts.intro ?? null;
  const introLen = intro ? barLengths(intro).reduce((a, b) => a + b, 0) : 0;
  const shift = intro ? introLen - pickup : 0;
  const introNotes = intro ? clipNotes(intro.notes, shift).map((n) => ({ ...n, voice: '1' })) : [];
  const introChords = intro ? intro.chords.filter((c) => c.tick < shift) : [];

  // Tune, shifted; the last note is held to the end of its bar so the ending starts on a bar line.
  const lastBar = bs[bs.length - 1];
  const tuneEnd = lastBar.start + bar >= s.endTick && lastBar.end - lastBar.start < bar ? lastBar.start + bar : s.endTick;
  const melody = song.melody.map((n) => ({ ...n, tick: n.tick + shift, voice: '1' }));
  const last = melody[melody.length - 1];
  if (parts.ending && last) last.dur = tuneEnd + shift - last.tick;
  const chords = parts.chords.map((c) => ({ ...c, tick: c.tick + shift }));

  // Ending.
  const ending = parts.ending ?? null;
  const endStart = shift + (ending ? tuneEnd : s.endTick);
  const endingNotes = ending ? ending.notes.map((n) => ({ ...n, tick: n.tick + endStart, voice: '1' })) : [];
  const endingChords = ending ? ending.chords.map((c) => ({ ...c, tick: c.tick + endStart })) : [];
  const endTick = ending ? endStart + barLengths(ending).reduce((a, b) => a + b, 0) : shift + s.endTick;

  const allChords = [...introChords, ...chords, ...endingChords].sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < allChords.length; i++) allChords[i].dur = (i + 1 < allChords.length ? allChords[i + 1].tick : endTick) - allChords[i].tick;

  const barTicks = [
    ...(intro ? [0, ...intro.barTicks.filter((t) => t > 0 && t < shift)] : []),
    ...bs.map((b) => b.start + shift).filter((t) => !(intro && pickup && t === shift)),
    ...(ending ? [endStart, ...ending.barTicks.filter((t) => t > 0).map((t) => t + endStart)] : []),
  ].filter((t) => t > 0 && t < endTick);

  const descant = (parts.descant?.notes ?? []).map((n) => ({ ...n, tick: n.tick + shift, voice: '2' }));
  const lead = [...introNotes, ...melody, ...endingNotes].map((n) => ({ ...n, role: 'melody' }));

  const score: Score = {
    ...s,
    title: header.title,
    meta: { ...s.meta },
    tempos: s.tempos.map((t) => ({ ...t, tick: t.tick === 0 ? 0 : t.tick + shift })),
    timeSigs: s.timeSigs.map((t) => ({ ...t, tick: t.tick === 0 ? 0 : t.tick + shift })),
    barTicks: [...new Set(barTicks)].sort((a, b) => a - b),
    notes: [...lead, ...descant],
    chords: allChords,
    endTick,
  };
  const realized: Note[] = realizeLeadSheet(score, lead);
  const roleNotes: Note[] = dedupe([...realized, ...descant.map((n) => ({ ...n, role: 'inner' }))]);
  const abc = scoreToAbc(score, [{ id: '1', name: 'Tune', notes: lead, chords: allChords }, ...(descant.length ? [{ id: '2', name: 'Descant', notes: descant }] : [])], { title: header.title, extra: header.extra });
  return { score, melody: lead, descant, roleNotes, abc, introTicks: shift, shift };
}
