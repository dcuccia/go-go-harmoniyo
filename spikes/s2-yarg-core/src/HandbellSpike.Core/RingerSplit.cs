using YARG.Core;
using YARG.Core.Chart;

namespace HandbellSpike;

public sealed record Ringer(string Name, int[] Pitches)
{
    public IEnumerable<int> Keys => Pitches.Select(p => p - SampleSong.ProKeysLowestPitch);
    public string BellNames => string.Join(" ", Pitches.Select(PitchName));

    static string PitchName(int midi) =>
        new[] { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" }[midi % 12] + (midi / 12 - 1);
}

/// <summary>
/// Splits one full "all bells" Pro Keys difficulty into per-ringer difficulties so each ringer can
/// get their own engine (own combo, own overhits) — the YARG band model, with no YARG.Core changes.
/// </summary>
public static class RingerSplit
{
    public static readonly Ringer[] DefaultRingers =
    {
        new("Bass", new[] { 48, 53, 55 }),   // C3 F3 G3
        new("C-D",  new[] { 60, 62 }),       // C4 D4
        new("E-F",  new[] { 64, 65 }),       // E4 F4
        new("G",    new[] { 67 }),           // G4
    };

    public static InstrumentDifficulty<ProKeysNote> ForRinger(InstrumentDifficulty<ProKeysNote> full, Ringer ringer)
    {
        var keys = ringer.Keys.ToHashSet();
        var notes = new List<ProKeysNote>();
        foreach (var parent in full.Notes)
        {
            ProKeysNote? root = null;
            foreach (var n in parent.AllNotes)
            {
                if (!keys.Contains(n.Key)) continue;
                var copy = new ProKeysNote(n.Key, n.ProKeysFlags, n.Flags, n.Time, n.TimeLength, n.Tick, n.TickLength);
                if (root is null) { root = copy; notes.Add(copy); }
                else root.AddChildNote(copy);
            }
        }

        for (int i = 0; i < notes.Count; i++)
        {
            if (i > 0) notes[i].PreviousNote = notes[i - 1];
            if (i < notes.Count - 1) notes[i].NextNote = notes[i + 1];
        }

        return new InstrumentDifficulty<ProKeysNote>(Instrument.ProKeys, full.Difficulty,
            notes, new List<Phrase>(), new List<TextEvent>());
    }
}
