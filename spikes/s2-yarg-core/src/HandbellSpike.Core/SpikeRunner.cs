using System.Diagnostics;
using System.Globalization;
using System.Text;
using Melanchall.DryWetMidi.Core;
using YARG.Core;
using YARG.Core.Chart;
using YARG.Core.Engine;
using YARG.Core.Engine.Keys;
using YARG.Core.Engine.Keys.Engines;
using YARG.Core.Input;
using YARG.Core.Logging;

namespace HandbellSpike;

public sealed record PlayerResult(string Name, string Bells, int TotalNotes, int NotesHit, int Overhits,
    int MaxCombo, int Score, int InputsQueued, double MeanAbsOffsetMs, double P95AbsOffsetMs);

public sealed record ScenarioResult(string Title, double SigmaMs, double MissRate, double FalseStrikeRate,
    IReadOnlyList<PlayerResult> Players)
{
    public int TeamScore => Players.Sum(p => p.Score);
    public int TeamNotes => Players.Sum(p => p.TotalNotes);
    public int TeamHits => Players.Sum(p => p.NotesHit);
    public double TeamAccuracy => TeamNotes == 0 ? 0 : (double) TeamHits / TeamNotes;
}

/// <summary>
/// Parses the self-generated sample charts with YARG.Core and drives YARG.Core's stock keys
/// engines with synthetic, seeded, jittered "bell strike" inputs. Same code runs in the console
/// app and in browser-wasm.
/// </summary>
public static class SpikeRunner
{
    /// <summary>Full hit window in seconds (±70 ms).</summary>
    public const double HitWindowSeconds = 0.140;
    const double StrikeHoldSeconds = 0.060;
    const int Seed = 20261022;

    static readonly float[] StarThresholds = { 0.06f, 0.12f, 0.2f, 0.45f, 0.75f, 1.09f };
    static readonly float[] SoloStarThresholds = { 0.05f, 0.1f, 0.2f, 0.35f, 0.65f, 0.95f };

    public static KeysEngineParameters CreateParameters() => new(
        new HitWindowSettings(HitWindowSeconds, HitWindowSeconds, 1.0, false, 0, 1, 1, 0, 0),
        maxMultiplier: 4, spWhammyBuffer: 0, sustainDropLeniency: 0,
        StarThresholds, SoloStarThresholds,
        chordStaggerWindow: 0.05, fatFingerWindow: 0,
        noStarPowerOverlap: false, enableLanes: false);

    public static SongChart ParseDotChart(string text) =>
        SongChart.FromDotChart(in ParseSettings.Default_Chart, text.AsSpan());

    public static SongChart ParseMidi(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        return SongChart.FromMidi(in ParseSettings.Default_Midi, MidiFile.Read(ms));
    }

    // ---- Scenarios -------------------------------------------------------------------------

    public static ScenarioResult FiveLaneKeysFromDotChart(SongChart chart, double sigmaMs)
    {
        var diff = chart.Keys.GetDifficulty(Difficulty.Expert);
        var engine = new YargFiveLaneKeysEngine(diff, chart.SyncTrack, CreateParameters(), false);
        var rng = new Random(Seed);
        var player = Play(engine, diff, "Solo (5-lane keys)", "C4 D4 E4 F4 G4",
            n => n.Fret - 1, lane => (ProKeysAction) ((int) ProKeysAction.GreenKey + lane), Enumerable.Range(0, 5).ToArray(),
            rng, sigmaMs / 1000, 0, 0);
        return new ScenarioResult(".chart -> YargFiveLaneKeysEngine (1 player, 5 bells)", sigmaMs, 0, 0, new[] { player });
    }

    public static ScenarioResult ProKeysEnsembleFromMidi(SongChart chart, double sigmaMs)
    {
        var diff = chart.ProKeys.GetDifficulty(Difficulty.Expert);
        var engine = new YargProKeysEngine(diff, chart.SyncTrack, CreateParameters(), false);
        var rng = new Random(Seed);
        var allKeys = RingerSplit.DefaultRingers.SelectMany(r => r.Keys).ToArray();
        var player = Play(engine, diff, "All bells", "C3 F3 G3 C4 D4 E4 F4 G4",
            n => n.Key, lane => (ProKeysAction) lane, allKeys, rng, sigmaMs / 1000, 0, 0);
        return new ScenarioResult(".mid -> YargProKeysEngine (1 player, 8 bells)", sigmaMs, 0, 0, new[] { player });
    }

    public static ScenarioResult PerRingerFromMidi(SongChart chart, double sigmaMs, double missRate, double falseRate)
    {
        var full = chart.ProKeys.GetDifficulty(Difficulty.Expert);
        var rng = new Random(Seed);
        var players = new List<PlayerResult>();
        foreach (var ringer in RingerSplit.DefaultRingers)
        {
            var diff = RingerSplit.ForRinger(full, ringer);
            var engine = new YargProKeysEngine(diff, chart.SyncTrack, CreateParameters(), false);
            players.Add(Play(engine, diff, ringer.Name, ringer.BellNames,
                n => n.Key, lane => (ProKeysAction) lane, ringer.Keys.ToArray(),
                rng, sigmaMs / 1000, missRate, falseRate));
        }
        return new ScenarioResult($".mid -> per-ringer YargProKeysEngine x{players.Count}", sigmaMs, missRate, falseRate, players);
    }

    // ---- Engine driver ---------------------------------------------------------------------

    static PlayerResult Play<TNote>(KeysEngine<TNote> engine, InstrumentDifficulty<TNote> diff,
        string name, string bells, Func<TNote, int> laneOf, Func<int, ProKeysAction> actionOf, int[] lanes,
        Random rng, double sigma, double missRate, double falseRate)
        where TNote : Note<TNote>
    {
        var offsets = new List<double>();
        engine.OnNoteHit += (_, note) => offsets.Add(engine.CurrentTime - note.Time);

        // Strike times per lane.
        var strikes = lanes.ToDictionary(l => l, _ => new List<double>());
        int noteCount = 0;
        foreach (var parent in diff.Notes)
        {
            foreach (var n in parent.AllNotes)
            {
                noteCount++;
                if (rng.NextDouble() < missRate) continue;
                strikes[laneOf(n)].Add(n.Time + Gaussian(rng) * sigma);
            }
        }

        double first = diff.Notes.Count > 0 ? diff.Notes[0].Time : 0;
        double last = diff.Notes.Count > 0 ? diff.Notes[^1].Time : 0;
        for (int i = 0; i < noteCount; i++)
        {
            if (rng.NextDouble() < falseRate)
                strikes[lanes[rng.Next(lanes.Length)]].Add(first + rng.NextDouble() * (last - first));
        }

        // Press + release per strike; never let a release overlap the next press of the same bell.
        var inputs = new List<GameInput>();
        foreach (var (lane, times) in strikes)
        {
            times.Sort();
            for (int i = 0; i < times.Count; i++)
            {
                double release = times[i] + StrikeHoldSeconds;
                if (i + 1 < times.Count) release = Math.Min(release, (times[i] + times[i + 1]) / 2);
                inputs.Add(GameInput.Create(times[i], actionOf(lane), true));
                inputs.Add(GameInput.Create(release, actionOf(lane), false));
            }
        }
        inputs.Sort((a, b) => a.Time.CompareTo(b.Time));

        foreach (var input in inputs)
        {
            var i = input;
            engine.QueueInput(ref i);
            engine.Update(i.Time);
        }
        engine.Update(SampleSong.SongLengthSeconds);

        var abs = offsets.Select(o => Math.Abs(o) * 1000).OrderBy(x => x).ToList();
        var stats = engine.EngineStats;
        return new PlayerResult(name, bells, stats.TotalNotes, stats.NotesHit, stats.Overhits, stats.MaxCombo,
            stats.TotalScore, inputs.Count,
            abs.Count == 0 ? 0 : abs.Average(),
            abs.Count == 0 ? 0 : abs[(int) Math.Min(abs.Count - 1, Math.Ceiling(0.95 * abs.Count) - 1)]);
    }

    static double Gaussian(Random rng)
    {
        double u1 = 1.0 - rng.NextDouble();
        double u2 = rng.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }

    // ---- Full run + timings ----------------------------------------------------------------

    public static string RunAll(int iterations = 20)
    {
        var sb = new StringBuilder();
        var inv = CultureInfo.InvariantCulture;
        void Line(string s) => sb.AppendLine(s);

        Line($"Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription} " +
             $"on {System.Runtime.InteropServices.RuntimeInformation.OSDescription} " +
             $"({System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier}), " +
             $"threads supported: {IsThreadingSupported()}");

        string chartText = SampleSong.ToDotChart();
        byte[] midi = SampleSong.ToProKeysMidi();
        Line($"Sample: .chart {chartText.Length} chars, .mid {midi.Length} bytes, " +
             $"{SampleSong.AllNotes.Count} notes, {SampleSong.SongLengthSeconds:0.0} s");

        // Cold (first call pays JIT / interpreter warm-up and static init, incl. YargLogger cctor).
        var sw = Stopwatch.StartNew();
        var dotChart = ParseDotChart(chartText);
        double coldChartMs = sw.Elapsed.TotalMilliseconds;
        sw.Restart();
        var midChart = ParseMidi(midi);
        double coldMidiMs = sw.Elapsed.TotalMilliseconds;
        sw.Restart();
        var cold = PerRingerFromMidi(midChart, 20, 0.01, 0.01);
        double coldEngineMs = sw.Elapsed.TotalMilliseconds;
        Line(string.Format(inv, "Cold: parse .chart {0:0.0} ms, parse .mid {1:0.0} ms, 4-ringer engines {2:0.0} ms",
            coldChartMs, coldMidiMs, coldEngineMs));

        var proKeys = midChart.ProKeys.GetDifficulty(Difficulty.Expert);
        Line($"Parsed .chart Keys/Expert notes: {dotChart.Keys.GetDifficulty(Difficulty.Expert).GetTotalNoteCount()}; " +
             $".mid ProKeys/Expert notes: {proKeys.GetTotalNoteCount()} " +
             $"(keys used: {string.Join(",", proKeys.Notes.SelectMany(n => AllKeys(n)).Distinct().OrderBy(k => k))})");

        // Warm timings.
        var tChart = new List<double>(); var tMidi = new List<double>(); var tEngine = new List<double>();
        for (int i = 0; i < iterations; i++)
        {
            sw.Restart(); ParseDotChart(chartText); tChart.Add(sw.Elapsed.TotalMilliseconds);
            sw.Restart(); var c = ParseMidi(midi); tMidi.Add(sw.Elapsed.TotalMilliseconds);
            sw.Restart(); PerRingerFromMidi(c, 20, 0.01, 0.01); tEngine.Add(sw.Elapsed.TotalMilliseconds);
        }
        Line(string.Format(inv, "Warm median of {0}: parse .chart {1:0.00} ms, parse .mid {2:0.00} ms, 4-ringer engines {3:0.00} ms ({4} inputs)",
            iterations, Median(tChart), Median(tMidi), Median(tEngine), cold.Players.Sum(p => p.InputsQueued)));

        Line("");
        var scenarios = new List<ScenarioResult>
        {
            FiveLaneKeysFromDotChart(dotChart, 15),
            ProKeysEnsembleFromMidi(ParseMidi(midi), 15),
        };
        foreach (var sigma in new[] { 10.0, 20.0, 35.0, 50.0 })
            scenarios.Add(PerRingerFromMidi(ParseMidi(midi), sigma, 0.01, 0.01));

        long fingerprint = 17;
        foreach (var s in scenarios)
        {
            Line(string.Format(inv, "== {0} | jitter σ={1} ms, miss={2:P0}, false strikes={3:P0}, window ±{4} ms",
                s.Title, s.SigmaMs, s.MissRate, s.FalseStrikeRate, HitWindowSeconds * 500));
            foreach (var p in s.Players)
            {
                Line(string.Format(inv, "   {0,-18} [{1,-24}] hit {2,3}/{3,-3} overhits {4,2}  maxCombo {5,3}  score {6,6}  |offset| mean {7,5:0.0} ms p95 {8,5:0.0} ms",
                    p.Name, p.Bells, p.NotesHit, p.TotalNotes, p.Overhits, p.MaxCombo, p.Score, p.MeanAbsOffsetMs, p.P95AbsOffsetMs));
                fingerprint = fingerprint * 31 + p.Score;
                fingerprint = fingerprint * 31 + p.NotesHit;
                fingerprint = fingerprint * 31 + p.Overhits;
            }
            if (s.Players.Count > 1)
                Line(string.Format(inv, "   TEAM score {0}, accuracy {1:P1}", s.TeamScore, s.TeamAccuracy));
        }
        Line("");
        Line($"Result fingerprint (should match across console and browser): {fingerprint:X16}");

        YargLogger.FlushLogQueue();
        return sb.ToString();
    }

    static IEnumerable<int> AllKeys(ProKeysNote n)
    {
        foreach (var x in n.AllNotes) yield return x.Key;
    }

    static double Median(List<double> xs)
    {
        var s = xs.OrderBy(x => x).ToList();
        return s.Count == 0 ? 0 : s[s.Count / 2];
    }

    static bool IsThreadingSupported()
    {
        try
        {
            var t = new Thread(() => { });
            t.Start();
            t.Join();
            return true;
        }
        catch (PlatformNotSupportedException)
        {
            return false;
        }
    }
}
