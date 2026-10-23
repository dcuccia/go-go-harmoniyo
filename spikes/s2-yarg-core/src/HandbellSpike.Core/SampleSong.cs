using System.Text;
using Melanchall.DryWetMidi.Common;
using Melanchall.DryWetMidi.Core;

namespace HandbellSpike;

public readonly record struct SongNote(uint Tick, int Pitch);

/// <summary>
/// Self-authored sample chart: the refrain of "Jingle Bells" (James Lord Pierpont, 1857 — public
/// domain melody), transcribed and simplified by the Go Go HarmoniYo project, with a self-authored
/// root-note bass line. This file (and every chart generated from it) is original work under the
/// repository's MIT license. No third-party chart/MIDI file is used.
/// </summary>
public static class SampleSong
{
    public const uint Resolution = 480;
    public const int Bpm = 120;
    public const int LeadInMeasures = 1;

    // Pro Keys MIDI range is C3 (48) .. C5 (72); key index = pitch - 48.
    public const int ProKeysLowestPitch = 48;

    const int C3 = 48, F3 = 53, G3 = 55, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67;

    static readonly (int Pitch, double Beats)[][] Melody =
    {
        new[] { (E4, 1.0), (E4, 1.0), (E4, 2.0) },
        new[] { (E4, 1.0), (E4, 1.0), (E4, 2.0) },
        new[] { (E4, 1.0), (G4, 1.0), (C4, 1.5), (D4, 0.5) },
        new[] { (E4, 4.0) },
        new[] { (F4, 1.0), (F4, 1.0), (F4, 1.5), (F4, 0.5) },
        new[] { (F4, 1.0), (E4, 1.0), (E4, 1.0), (E4, 0.5), (E4, 0.5) },
        new[] { (E4, 1.0), (D4, 1.0), (D4, 1.0), (E4, 1.0) },
        new[] { (D4, 2.0), (G4, 2.0) },
        new[] { (E4, 1.0), (E4, 1.0), (E4, 2.0) },
        new[] { (E4, 1.0), (E4, 1.0), (E4, 2.0) },
        new[] { (E4, 1.0), (G4, 1.0), (C4, 1.5), (D4, 0.5) },
        new[] { (E4, 4.0) },
        new[] { (F4, 1.0), (F4, 1.0), (F4, 1.5), (F4, 0.5) },
        new[] { (F4, 1.0), (E4, 1.0), (E4, 1.0), (E4, 0.5), (E4, 0.5) },
        new[] { (G4, 1.0), (G4, 1.0), (F4, 1.0), (D4, 1.0) },
        new[] { (C4, 4.0) },
    };

    static readonly int[] BassRoots = { C3, C3, C3, C3, F3, C3, G3, G3, C3, C3, C3, C3, F3, C3, G3, C3 };

    public static IReadOnlyList<SongNote> MelodyNotes { get; } = BuildMelody();
    public static IReadOnlyList<SongNote> BassNotes { get; } = BuildBass();
    public static IReadOnlyList<SongNote> AllNotes { get; } =
        MelodyNotes.Concat(BassNotes).OrderBy(n => n.Tick).ThenBy(n => n.Pitch).ToList();

    public static double SongLengthSeconds => (LeadInMeasures + Melody.Length + 1) * 4 * 60.0 / Bpm;

    static uint MeasureTick(int measure) => (uint) ((LeadInMeasures + measure) * 4 * Resolution);

    static List<SongNote> BuildMelody()
    {
        var notes = new List<SongNote>();
        for (int m = 0; m < Melody.Length; m++)
        {
            double beat = 0;
            foreach (var (pitch, beats) in Melody[m])
            {
                notes.Add(new SongNote(MeasureTick(m) + (uint) (beat * Resolution), pitch));
                beat += beats;
            }
        }
        return notes;
    }

    static List<SongNote> BuildBass() =>
        BassRoots.Select((p, m) => new SongNote(MeasureTick(m), p)).ToList();

    /// <summary>
    /// Clone Hero / Moonscraper <c>.chart</c> text: melody only, five-lane keys
    /// (C4..G4 -> green..orange). Zero-length notes: handbell strikes have no sustain.
    /// </summary>
    public static string ToDotChart()
    {
        var sb = new StringBuilder();
        sb.Append("[Song]\n{\n  Name = \"Jingle Bells (refrain, Go Go HarmoniYo S2 sample)\"\n");
        sb.Append($"  Resolution = {Resolution}\n}}\n");
        sb.Append($"[SyncTrack]\n{{\n  0 = TS 4\n  0 = B {Bpm * 1000}\n}}\n");
        sb.Append("[Events]\n{\n}\n");
        sb.Append("[ExpertKeyboard]\n{\n");
        foreach (var n in MelodyNotes)
        {
            int fret = n.Pitch switch { C4 => 0, D4 => 1, E4 => 2, F4 => 3, G4 => 4, _ => throw new InvalidOperationException() };
            sb.Append($"  {n.Tick} = N {fret} 0\n");
        }
        sb.Append("}\n");
        return sb.ToString();
    }

    /// <summary>
    /// Rock Band–style MIDI with a <c>PART REAL_KEYS_X</c> (Pro Keys, Expert) track containing
    /// melody + bass, serialized to bytes so it is loaded exactly like a file would be.
    /// Notes are a 1/16 long, below the 1/12 sustain cutoff, so they parse as strikes.
    /// </summary>
    public static byte[] ToProKeysMidi()
    {
        var file = new MidiFile { TimeDivision = new TicksPerQuarterNoteTimeDivision((short) Resolution) };

        var tempo = new TrackChunk(
            new SequenceTrackNameEvent("Jingle Bells (Go Go HarmoniYo S2 sample)"),
            new TimeSignatureEvent(4, 4),
            new SetTempoEvent(60_000_000 / Bpm));
        file.Chunks.Add(tempo);

        const uint strikeTicks = Resolution / 4;
        var events = new List<(uint Tick, MidiEvent Event)>();
        foreach (var n in AllNotes)
        {
            events.Add((n.Tick, new NoteOnEvent((SevenBitNumber) n.Pitch, (SevenBitNumber) 100)));
            events.Add((n.Tick + strikeTicks, new NoteOffEvent((SevenBitNumber) n.Pitch, (SevenBitNumber) 0)));
        }

        var keys = new TrackChunk(new SequenceTrackNameEvent("PART REAL_KEYS_X"));
        uint last = 0;
        foreach (var (tick, ev) in events.OrderBy(e => e.Tick).ThenBy(e => e.Event is NoteOnEvent ? 1 : 0))
        {
            ev.DeltaTime = tick - last;
            last = tick;
            keys.Events.Add(ev);
        }
        file.Chunks.Add(keys);

        using var ms = new MemoryStream();
        file.Write(ms);
        return ms.ToArray();
    }
}
