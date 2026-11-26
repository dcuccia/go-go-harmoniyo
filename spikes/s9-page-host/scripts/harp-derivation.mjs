import { brotliCompressSync, constants } from 'node:zlib';

function stereoPcm(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAV harp recording.');
  }
  let format, data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const end = at + 8 + bytes.readUInt32LE(at + 4);
    if (end > bytes.length) throw new Error('Truncated WAV chunk.');
    const chunk = bytes.subarray(at + 8, end);
    const id = bytes.toString('ascii', at, at + 4);
    if (id === 'fmt ') format = chunk;
    if (id === 'data') data = chunk;
    at = end + (chunk.length & 1);
  }
  if (!format || format.length < 16 || !data?.length || data.length % 4 ||
      format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 2 ||
      format.readUInt16LE(12) !== 4 || format.readUInt16LE(14) !== 16 || format.readUInt32LE(4) !== 44100) {
    throw new Error('Expected 44.1 kHz 16-bit stereo PCM.');
  }
  return { data, rate: format.readUInt32LE(4) };
}

export function deriveHarp(bytes, requiredSec) {
  const { data, rate } = stereoPcm(bytes);
  const originalFrames = data.length / 4;
  const requiredFrames = Math.ceil(requiredSec * rate);
  // Margin for the browser's interpolation/resampling; the fade starts after every required frame.
  const fadeStart = requiredFrames + Math.ceil(0.02 * rate);
  const fadeFrames = Math.ceil(0.025 * rate);
  const frames = Math.min(originalFrames, fadeStart + fadeFrames);
  const trimmed = frames < originalFrames;
  const wave = Buffer.alloc(44 + 2 * frames);
  wave.write('RIFF');
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(frames * 2, 40);
  let monoPeak = 0, stereoPeak = 0;
  for (let i = 0; i < frames; i++) {
    const left = data.readInt16LE(4 * i), right = data.readInt16LE(4 * i + 2);
    const fade = trimmed && i >= fadeStart ? (frames - 1 - i) / (fadeFrames - 1) : 1;
    const sample = Math.round((left + right) * 0.5 * fade);
    wave.writeInt16LE(sample, 44 + i * 2);
    if (i < requiredFrames) {
      monoPeak = Math.max(monoPeak, Math.abs(sample));
      stereoPeak = Math.max(stereoPeak, Math.abs(left), Math.abs(right));
    }
  }
  const br = brotliCompressSync(wave, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: wave.length,
  } });
  return {
    wave, br, requiredSec, originalSec: originalFrames / rate, emittedSec: frames / rate,
    fadeAtSec: trimmed ? fadeStart / rate : null, monoPeak, stereoPeak,
  };
}
