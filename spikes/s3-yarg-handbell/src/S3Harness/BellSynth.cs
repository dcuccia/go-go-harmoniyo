using YARG.Core;
using YARG.Core.Chart;

namespace S3Harness;

/// <summary>
/// Renders per-ringer audio stems (simple additive handbell synthesis, self-authored, MIT) so S5
/// song folders satisfy YARG's "at least one audio stem" requirement. One stem per ringer means
/// YARG's mute-on-miss silences exactly the ringer who missed.
/// </summary>
public static class BellSynth
{
    public const int SampleRate = 44100;

    // Handbells are tuned with a strong twelfth (3f); add a weak octave and inharmonic upper partials
    static readonly (double Ratio, double Amp, double DecayScale)[] Partials =
    {
        (1.0, 1.00, 1.00),
        (2.0, 0.12, 0.60),
        (3.0, 0.50, 0.45),
        (4.2, 0.10, 0.25),
        (5.4, 0.06, 0.18),
    };

    /// <summary>Stem file names for ringer slots 0..4 (see HgpRingerSlots / S5 track order).</summary>
    public static readonly string[] StemNames = { "guitar", "bass", "rhythm", "keys", "song" };

    public static void AddStrike(float[] buffer, double time, int midi, double velocity)
    {
        double f = 440.0 * Math.Pow(2, (midi - 69) / 12.0);
        double tau0 = Math.Clamp(2.2 * Math.Pow(440.0 / f, 0.4), 0.6, 4.0);
        int start = (int) (time * SampleRate);
        int length = (int) (Math.Min(4.0, tau0 * 5) * SampleRate);
        for (int i = 0; i < length && start + i < buffer.Length; i++)
        {
            if (start + i < 0) continue;
            double t = i / (double) SampleRate;
            double attack = Math.Min(1.0, t / 0.003);
            double s = 0;
            foreach (var (ratio, amp, decayScale) in Partials)
            {
                double fp = f * ratio;
                if (fp > SampleRate / 2.2) continue;
                s += amp * Math.Exp(-t / (tau0 * decayScale)) * Math.Sin(2 * Math.PI * fp * t);
            }
            buffer[start + i] += (float) (0.22 * velocity * attack * s);
        }
    }

    /// <summary>Writes one WAV stem per ringer into <paramref name="songDir"/>; returns stem files written.</summary>
    public static List<string> RenderStems(SongLoader.LoadedSong song, string songDir)
    {
        var bells = SongLoader.RingerBells(songDir);
        double length = song.Chart.GetEndTime() + 4.0;
        var written = new List<string>();
        for (int slot = 0; slot < song.Ringers.Count; slot++)
        {
            var instrument = song.Ringers[slot];
            int ringerIndex = Array.IndexOf(YARG.Integration.Hgp.HgpRingerSlots.Instruments, instrument);
            if (ringerIndex < 0 || ringerIndex >= bells.Count) continue;

            var ringerBells = bells[ringerIndex];
            var buffer = new float[(int) (length * SampleRate)];
            var part = SongLoader.RingerPart(song.Chart, instrument, Difficulty.Expert);
            foreach (var parent in part.Notes)
            {
                foreach (var note in parent.AllNotes)
                {
                    int lane = Math.Max(0, note.Fret - 1);
                    var bell = ringerBells[SongLoader.BellForLane(lane, ringerBells.Count)];
                    AddStrike(buffer, note.Time, SongLoader.MidiNumber(bell), 0.9);
                }
            }

            string path = Path.Combine(songDir, StemNames[ringerIndex] + ".wav");
            WriteWav(path, buffer);
            written.Add(Path.GetFileName(path));
        }

        return written;
    }

    public static void WriteWav(string path, float[] samples)
    {
        using var fs = File.Create(path);
        using var w = new BinaryWriter(fs);
        int dataBytes = samples.Length * 2;
        w.Write("RIFF"u8); w.Write(36 + dataBytes); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short) 1); w.Write((short) 1);
        w.Write(SampleRate); w.Write(SampleRate * 2); w.Write((short) 2); w.Write((short) 16);
        w.Write("data"u8); w.Write(dataBytes);
        foreach (var x in samples)
        {
            double soft = Math.Tanh(x); // gentle limiter for chords
            w.Write((short) Math.Round(soft * 32000));
        }
    }
}
