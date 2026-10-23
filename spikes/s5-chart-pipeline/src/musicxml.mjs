// MusicXML (score-partwise, uncompressed .musicxml/.xml) subset -> Score.
// Supported: divisions, key, time, tempo (<sound tempo>), notes/rests, <chord/>, <backup>,
// <forward>, ties, <grace/> (skipped), voices, and <harmony> chord symbols (lead sheets).
// Not supported: compressed .mxl, repeats/endings expansion, tuplets beyond <duration> math
// (durations are already absolute in MusicXML, so tuplets work implicitly).
import { PPQ, chordFromIntervals } from './score.mjs';

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const KIND = {
  major: [0, 4, 7], minor: [0, 3, 7], augmented: [0, 4, 8], diminished: [0, 3, 6],
  dominant: [0, 4, 7, 10], 'major-seventh': [0, 4, 7, 11], 'minor-seventh': [0, 3, 7, 10],
  'diminished-seventh': [0, 3, 6, 9], 'half-diminished': [0, 3, 6, 10], 'major-sixth': [0, 4, 7, 9],
  'minor-sixth': [0, 3, 7, 9], 'suspended-fourth': [0, 5, 7], 'suspended-second': [0, 2, 7],
  'dominant-ninth': [0, 4, 7, 10, 2], power: [0, 7],
};

const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};
const has = (xml, name) => new RegExp(`<${name}(?:\\s[^>]*)?/?>`).test(xml);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseMusicXml(xml) {
  if (/<score-timewise/.test(xml)) throw new Error('score-timewise not supported');
  const score = { title: '', composer: '', meta: { voiceNames: {} }, ppq: PPQ, tempos: [], timeSigs: [], barTicks: [], notes: [], chords: [], endTick: 0 };
  score.title = decode(tag(xml, 'work-title') || tag(xml, 'movement-title') || '');
  const composer = /<creator[^>]*type="composer"[^>]*>([\s\S]*?)<\/creator>/.exec(xml);
  if (composer) score.composer = decode(composer[1].trim());
  const rights = tag(xml, 'rights');
  if (rights) score.meta.rights = decode(rights);

  const partNames = {};
  for (const m of xml.matchAll(/<score-part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/score-part>/g)) partNames[m[1]] = decode(tag(m[2], 'part-name') || m[1]);

  let partIndex = 0;
  for (const pm of xml.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    const partId = pm[1];
    let divisions = 1;
    let tick = 0;
    let lastNoteStart = 0;
    const open = new Map(); // tie continuation: `${voice}:${midi}` -> note
    for (const mm of pm[2].matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)) {
      const measureStart = tick;
      if (partIndex === 0) score.barTicks.push(measureStart);
      let measureEnd = tick;
      const els = mm[1].matchAll(/<(note|backup|forward|attributes|harmony|direction|sound)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g);
      for (const em of els) {
        const [, name, attrs, inner = ''] = em;
        const toTicks = (d) => Math.round((Number(d) * PPQ) / divisions);
        if (name === 'attributes') {
          const d = tag(inner, 'divisions');
          if (d) divisions = Number(d);
          const time = tag(inner, 'time');
          if (time && partIndex === 0) score.timeSigs.push({ tick, num: Number(tag(time, 'beats')), den: Number(tag(time, 'beat-type')) });
          const key = tag(inner, 'key');
          if (key && partIndex === 0 && score.meta.fifths === undefined) { score.meta.fifths = Number(tag(key, 'fifths')); score.meta.mode = tag(key, 'mode') || 'major'; }
        } else if (name === 'sound' || name === 'direction') {
          const t = /tempo="([\d.]+)"/.exec(name === 'sound' ? attrs : inner);
          if (t && partIndex === 0) score.tempos.push({ tick, usPerQuarter: Math.round(60e6 / Number(t[1])) });
        } else if (name === 'harmony') {
          if (partIndex !== 0) continue;
          const root = tag(inner, 'root');
          const kindM = /<kind[^>]*>([^<]*)<\/kind>/.exec(inner);
          if (!root || !kindM) continue;
          const pc = (STEP_PC[tag(root, 'root-step')] + Number(tag(root, 'root-alter') || 0) + 12) % 12;
          const intervals = KIND[kindM[1].trim()];
          if (!intervals) throw new Error(`Unsupported harmony kind ${kindM[1]}`);
          const bassEl = tag(inner, 'bass');
          const bass = bassEl ? (STEP_PC[tag(bassEl, 'bass-step')] + Number(tag(bassEl, 'bass-alter') || 0) + 12) % 12 : pc;
          const offset = tag(inner, 'offset');
          const textM = /<kind[^>]*text="([^"]*)"/.exec(inner);
          score.chords.push({ tick: tick + (offset ? toTicks(offset) : 0), dur: 0, symbol: textM ? decode(textM[1]) : kindM[1], ...chordFromIntervals(pc, intervals, bass) });
        } else if (name === 'backup') {
          tick -= toTicks(tag(inner, 'duration'));
        } else if (name === 'forward') {
          tick += toTicks(tag(inner, 'duration'));
        } else if (name === 'note') {
          if (has(inner, 'grace') || has(inner, 'cue')) continue;
          const dur = toTicks(tag(inner, 'duration') || 0);
          const isChord = has(inner, 'chord');
          const start = isChord ? lastNoteStart : tick;
          const voice = `${partId}v${tag(inner, 'voice') || '1'}`;
          score.meta.voiceNames[voice] = partNames[partId] || partId;
          if (!has(inner, 'rest')) {
            const pitch = tag(inner, 'pitch');
            const midi = 12 * (Number(tag(pitch, 'octave')) + 1) + STEP_PC[tag(pitch, 'step')] + Number(tag(pitch, 'alter') || 0);
            const tieStop = /<tie\s+type="stop"/.test(inner);
            const tieStart = /<tie\s+type="start"/.test(inner);
            const key = `${voice}:${midi}`;
            let n;
            if (tieStop && open.has(key) && open.get(key).tick + open.get(key).dur === start) {
              n = open.get(key);
              n.dur += dur;
            } else {
              n = { tick: start, dur, midi, vel: 90, voice };
              score.notes.push(n);
            }
            if (tieStart) open.set(key, n); else open.delete(key);
          }
          if (!isChord) { lastNoteStart = tick; tick += dur; }
        }
        measureEnd = Math.max(measureEnd, tick);
      }
      tick = measureEnd;
    }
    score.endTick = Math.max(score.endTick, tick);
    partIndex++;
  }
  score.barTicks = score.barTicks.filter((t) => t > 0);
  if (!score.tempos.length || score.tempos[0].tick > 0) score.tempos.unshift({ tick: 0, usPerQuarter: 500000 });
  if (!score.timeSigs.length || score.timeSigs[0].tick > 0) score.timeSigs.unshift({ tick: 0, num: 4, den: 4 });
  score.chords.sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < score.chords.length; i++) score.chords[i].dur = (i + 1 < score.chords.length ? score.chords[i + 1].tick : score.endTick) - score.chords[i].tick;
  score.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return score;
}
