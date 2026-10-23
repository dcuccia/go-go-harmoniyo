using YARG.Core;
using YARG.Core.Chart;
using YARG.Core.Engine.Keys;
using YARG.Core.Engine.Keys.Engines;
using YARG.Core.Game;
using YARG.Core.Input;
using YARG.Integration.Hgp;

namespace S3Harness;

/// <summary>Network delay model: one-way strike -> host arrival, in seconds (base + exponential tail).</summary>
public sealed record NetProfile(string Name, double BaseMs, double TailMeanMs)
{
    public double Sample(Random rng) =>
        (BaseMs + (TailMeanMs <= 0 ? 0 : -TailMeanMs * Math.Log(1 - rng.NextDouble()))) / 1000.0;

    public static readonly NetProfile[] All =
    {
        new("ideal (0 ms)", 0, 0),
        new("good LAN (4 + exp 4 ms)", 4, 4),
        new("typical Wi-Fi (8 + exp 10 ms)", 8, 10),
        new("congested Wi-Fi (15 + exp 25 ms)", 15, 25),
    };
}

public sealed record SimResult(string Song, Instrument Ringer, string Net, double BudgetMs, double HumanSigmaMs,
    int Notes, int Hits, int Overhits, int Score, int InputsClamped, int LateForBudget,
    List<double> SystemErrorsMs, List<double> NetDelaysMs);

/// <summary>
/// Drives YARG.Core's stock YargFiveLaneKeysEngine frame by frame the way BasePlayer does, with
/// source-timestamped inputs that arrive late. Policy "stock" = queue on arrival and update the
/// engine to "now" (current YARG). Policy "lookbehind B" = the fork's LookbehindInputQueue.
/// </summary>
public static class LatencySim
{
    const double Fps = 60;
    const double StrikeHold = 0.060;
    static readonly float[] Stars = { 0.06f, 0.12f, 0.2f, 0.47f, 0.78f, 1.15f };     // FiveLaneKeysPlayer
    static readonly float[] BassStars = { 0.05f, 0.1f, 0.19f, 0.47f, 0.78f, 1.15f };
    static readonly float[] SoloStars = { 0.05f, 0.1f, 0.2f, 0.35f, 0.65f, 0.95f }; // BasePlayer

    sealed record Strike(GuitarNote? Note, ProKeysAction Action, bool Down, double True, double Source, double Arrival);

    public static SimResult Run(SongLoader.LoadedSong song, Instrument ringer, NetProfile net, double budgetMs,
        double humanSigmaMs, double clockSigmaMs, int seed)
    {
        var rng = new Random(seed);
        var part = SongLoader.RingerPart(song.Chart, ringer);
        bool isBass = ringer == Instrument.FiveFretBass;
        var parameters = EnginePreset.Default.ProKeys.Create(isBass ? BassStars : Stars, SoloStars, isBass);
        var engine = new YargFiveLaneKeysEngine(part, song.Chart.SyncTrack, parameters, false);

        // Strikes: one per note (chords = simultaneous strikes), human timing error, then release
        var strikes = new List<Strike>();
        double deviceClockOffset = Gaussian(rng) * clockSigmaMs / 1000; // residual HGP clock-sync error (S1)
        var byLane = new Dictionary<ProKeysAction, List<(double t, GuitarNote n)>>();
        foreach (var parent in part.Notes)
        {
            foreach (var note in parent.AllNotes)
            {
                var action = (ProKeysAction) ((int) ProKeysAction.GreenKey + Math.Max(0, note.Fret - 1));
                double t = note.Time + Gaussian(rng) * humanSigmaMs / 1000;
                if (!byLane.TryGetValue(action, out var list)) byLane[action] = list = new();
                list.Add((t, note));
            }
        }

        foreach (var (action, list) in byLane)
        {
            list.Sort((a, b) => a.t.CompareTo(b.t));
            for (int i = 0; i < list.Count; i++)
            {
                double down = list[i].t;
                double up = down + StrikeHold;
                if (i + 1 < list.Count) up = Math.Min(up, (down + list[i + 1].t) / 2);
                strikes.Add(new Strike(list[i].n, action, true, down, down + deviceClockOffset, 0));
                strikes.Add(new Strike(null, action, false, up, up + deviceClockOffset, 0));
            }
        }

        // Phone sends in source order over an ordered transport (WebSocket): arrivals are monotonic
        strikes.Sort((a, b) => a.True.CompareTo(b.True));
        double lastArrival = double.NegativeInfinity;
        var netDelays = new List<double>();
        for (int i = 0; i < strikes.Count; i++)
        {
            double arrival = Math.Max(lastArrival, strikes[i].True + net.Sample(rng));
            lastArrival = arrival;
            strikes[i] = strikes[i] with { Arrival = arrival };
            netDelays.Add((arrival - strikes[i].True) * 1000);
        }

        var hitTimes = new Dictionary<GuitarNote, double>(ReferenceEqualityComparer.Instance);
        var trueStrike = strikes.Where(s => s.Note != null).ToDictionary(s => s.Note!, s => s.True, ReferenceEqualityComparer.Instance);
        engine.OnNoteHit += (_, note) => hitTimes[note] = engine.CurrentTime;

        double budget = budgetMs / 1000;
        var queue = budget > 0 ? new LookbehindInputQueue(budget) : null;
        int clamped = 0;
        double lastBridgeTime = double.NegativeInfinity;
        void Sink(ref GameInput input)
        {
            if (input.Time < engine.CurrentTime) clamped++;
            engine.QueueInput(ref input);
        }

        double end = Math.Max(song.Chart.GetEndTime(), strikes.Count > 0 ? strikes[^1].Arrival : 0) + 1.0;
        double frame = 1.0 / Fps;
        double startT = -1.0 + rng.NextDouble() * frame; // random frame phase
        int next = 0;
        for (double now = startT; now < end; now += frame)
        {
            // HgpBridge: deliver arrived packets, clamp to "not in the future" and per-device monotonic
            while (next < strikes.Count && strikes[next].Arrival <= now)
            {
                var s = strikes[next++];
                double ts = Math.Max(Math.Min(s.Source, now), lastBridgeTime);
                lastBridgeTime = ts;
                var input = GameInput.Create(ts, s.Action, s.Down);
                if (queue != null) queue.Enqueue(input);
                else Sink(ref input);
            }

            double engineTime = now - budget;
            queue?.DrainUpTo(engineTime, Sink);
            engine.Update(engineTime);
        }

        var errors = new List<double>();
        foreach (var (note, hitAt) in hitTimes)
        {
            if (trueStrike.TryGetValue(note, out double t)) errors.Add((hitAt - t) * 1000);
        }

        var stats = engine.EngineStats;
        return new SimResult(song.Title, ringer, net.Name, budgetMs, humanSigmaMs, stats.TotalNotes, stats.NotesHit,
            stats.Overhits, stats.TotalScore, clamped, queue?.LateCount ?? 0, errors, netDelays);
    }

    public static double Percentile(IReadOnlyList<double> xs, double p)
    {
        if (xs.Count == 0) return double.NaN;
        var s = xs.OrderBy(x => x).ToList();
        int i = (int) Math.Min(s.Count - 1, Math.Max(0, Math.Ceiling(p * s.Count) - 1));
        return s[i];
    }

    static double Gaussian(Random rng)
    {
        double u1 = 1.0 - rng.NextDouble();
        double u2 = rng.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }
}
