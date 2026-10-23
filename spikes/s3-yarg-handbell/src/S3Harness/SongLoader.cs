using System.Globalization;
using YARG.Core;
using YARG.Core.Chart;
using YARG.Core.Song;
using YARG.Core.Song.Cache;
using YARG.Integration.Hgp;

namespace S3Harness;

/// <summary>Scans song folders with YARG.Core's real song scanner and loads charts the way YARG does.</summary>
public static class SongLoader
{
    public sealed record LoadedSong(string Title, string Directory, SongEntry Entry, SongChart Chart,
        IReadOnlyList<Instrument> Ringers);

    public static List<LoadedSong> Scan(string songsDir, TextWriter log)
    {
        string tmp = Path.Combine(Path.GetTempPath(), "s3-harness-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var cache = CacheHandler.RunScan(false, Path.Combine(tmp, "songcache.bin"),
                Path.Combine(tmp, "badsongs.txt"), false, new List<string> { Path.GetFullPath(songsDir) });

            string bad = Path.Combine(tmp, "badsongs.txt");
            if (File.Exists(bad) && new FileInfo(bad).Length > 0)
            {
                log.WriteLine("YARG.Core reported bad songs:");
                log.WriteLine(File.ReadAllText(bad));
            }

            var songs = new List<LoadedSong>();
            foreach (var entry in cache.Entries.Values.SelectMany(x => x))
            {
                var ringers = HgpRingerSlots.Instruments.Where(entry.HasInstrument).ToList();
                var chart = entry.LoadChart();
                if (chart == null)
                {
                    log.WriteLine($"  LoadChart failed: {entry.Name}");
                    continue;
                }

                songs.Add(new LoadedSong(entry.Name.ToString(), entry.ActualLocation, entry, chart, ringers));
            }

            return songs.OrderBy(s => s.Title, StringComparer.Ordinal).ToList();
        }
        finally
        {
            try { Directory.Delete(tmp, true); } catch (IOException) { }
        }
    }

    public static InstrumentDifficulty<GuitarNote> RingerPart(SongChart chart, Instrument instrument,
        Difficulty difficulty = Difficulty.Expert) =>
        // Same as FiveLaneKeysPlayer.GetNotes
        chart.GetFiveFretTrack(instrument).Clone().GetDifficulty(difficulty);

    /// <summary>Bells per ringer from the S5 song.ini loading_phrase ("Ringers (hard): 1=F2 G2; 2=...").</summary>
    public static List<List<string>> RingerBells(string songDir)
    {
        var result = new List<List<string>>();
        var ini = Path.Combine(songDir, "song.ini");
        var line = File.ReadLines(ini).FirstOrDefault(l => l.TrimStart().StartsWith("loading_phrase", StringComparison.OrdinalIgnoreCase));
        if (line == null) return result;

        var text = line[(line.IndexOf('=') + 1)..];
        int colon = text.IndexOf(':');
        int dot = text.IndexOf(". License", StringComparison.Ordinal);
        if (colon < 0) return result;
        text = dot > colon ? text[(colon + 1)..dot] : text[(colon + 1)..];
        foreach (var part in text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            int eq = part.IndexOf('=');
            result.Add(part[(eq + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList());
        }

        return result;
    }

    public static IEnumerable<GuitarNote> All(GuitarNote parent)
    {
        foreach (var n in parent.AllNotes) yield return n;
    }

    public static int MidiNumber(string bell)
    {
        string[] pcs = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
        int i = bell.Length - 1;
        while (i > 0 && (char.IsDigit(bell[i]) || bell[i] == '-')) i--;
        var name = bell[..(i + 1)];
        int octave = int.Parse(bell[(i + 1)..], CultureInfo.InvariantCulture);
        return Array.IndexOf(pcs, name) + 12 * (octave + 1);
    }

    /// <summary>Inverse of S5's laneOf(): first bell index that maps to <paramref name="lane"/>.</summary>
    public static int BellForLane(int lane, int bellCount)
    {
        if (bellCount <= 5) return Math.Min(lane, bellCount - 1);
        for (int i = 0; i < bellCount; i++)
        {
            if ((int) Math.Round(i * 4.0 / (bellCount - 1), MidpointRounding.AwayFromZero) == lane) return i;
        }
        return bellCount - 1;
    }
}
