# SPDX-License-Identifier: MIT
"""Transcode preview WAVs to Ogg Vorbis (dev tool for scripts/render-previews.ts --ogg-python).
Needs `pip install soundfile` (bundles libsndfile). Writes in blocks: one large Vorbis write
overflows the stack on Windows with libsndfile 1.2.2.
Usage: python wav_to_ogg.py <file.wav>... (writes <file>.ogg next to each and deletes the WAV)
"""
import os
import sys

import soundfile as sf

for path in sys.argv[1:]:
    data, sr = sf.read(path, dtype="float32")
    ogg = os.path.splitext(path)[0] + ".ogg"
    with sf.SoundFile(ogg, "w", sr, 1, format="OGG", subtype="VORBIS", compression_level=0.4) as f:
        for i in range(0, len(data), 4096):
            f.write(data[i:i + 4096])
    os.remove(path)
    print(f"{os.path.basename(ogg)} {os.path.getsize(ogg)} bytes")
