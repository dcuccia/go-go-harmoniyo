using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using YARG.Core;
using YARG.Core.Input;
using YARG.Core.Logging;
using YARG.Integration.Hgp;
using S3Harness;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
YargLogger.MinimumLogLevel = LogLevel.Error; // engine clamp warnings are counted directly instead

if (args.Length == 0)
{
    Console.WriteLine("""
        S3 harness (YARG.Core + fork HGP core), commands:
          selftest                                   HGP packet / clock map / lookbehind unit checks
          prepare <s5ExportsDir> <outSongsDir>       copy S5 song folders + render per-ringer bell stems (WAV)
          scan <songsDir>                            YARG.Core song scan + per-ringer part summary
          latency <songsDir> [--human 0] [--clock 0] [--seeds 5] [--budgets 0,20,40,60,80]
          send [--port 47800] [--ringers 4] [--song <dir>] [--net typical|good|congested|ideal] [--countdown 5]
        """);
    return 1;
}

string Opt(string name, string fallback)
{
    int i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
}

switch (args[0])
{
    case "selftest":
        return SelfTest();
    case "prepare":
        return Prepare(args[1], args[2]);
    case "scan":
        return ScanCmd(args[1]);
    case "latency":
        return Latency(args[1]);
    case "send":
        return Send();
    default:
        Console.Error.WriteLine($"Unknown command {args[0]}");
        return 1;
}

int SelfTest()
{
    int failures = 0;
    void Check(bool ok, string what)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {what}");
        if (!ok) failures++;
    }

    var ring = HgpPacket.Ring("phone-1", 3, true, 12.3456789, 42);
    var parsed = HgpPacket.Parse(ring.ToString());
    Check(parsed.Kind == HgpPacketKind.Ring && parsed.Device == "phone-1" && parsed.Bell == 3 && parsed.Down
        && parsed.Time == 12.3456789 && parsed.Sequence == 42, $"ring round-trip: '{ring}'");
    var hello = HgpPacket.Parse("hgp0 hello pixel-7 2 Dad's Pixel");
    Check(hello.Kind == HgpPacketKind.Hello && hello.Slot == 2 && hello.Name == "Dad's Pixel", "hello with name");
    Check(HgpPacket.Parse("hgp0 ring x y 1 2 3").Kind == HgpPacketKind.Invalid, "malformed ring rejected");
    Check(HgpPacket.Parse("nope sync 1").Kind == HgpPacketKind.Invalid, "bad magic rejected");

    var clock = new HgpClockMap(8);
    clock.AddSample(100.000, 5.0030);
    clock.AddSample(100.010, 5.0101);
    clock.AddSample(100.020, 5.0250);
    Check(Math.Abs(clock.Offset - (5.0101 - 100.010)) < 1e-9, "clock map keeps min one-way offset");
    Check(Math.Abs(clock.ToLocal(101.0) - (101.0 + clock.Offset)) < 1e-12, "clock map ToLocal");

    var q = new LookbehindInputQueue(0.040);
    var released = new List<double>();
    void Sink(ref GameInput input) => released.Add(input.Time);
    q.Enqueue(GameInput.Create(1.010, ProKeysAction.GreenKey, true));
    q.Enqueue(GameInput.Create(1.000, ProKeysAction.RedKey, true));
    q.Enqueue(GameInput.Create(1.020, ProKeysAction.GreenKey, false));
    q.DrainUpTo(1.015, Sink);
    Check(released.SequenceEqual(new[] { 1.000, 1.010 }), "lookbehind releases in time order up to engine time");
    q.Enqueue(GameInput.Create(1.005, ProKeysAction.BlueKey, true));
    Check(q.LateCount == 1, "lookbehind counts inputs later than the budget");
    q.DrainUpTo(2.0, Sink);
    Check(released.SequenceEqual(new[] { 1.000, 1.010, 1.005, 1.020 }), "late input released immediately (engine will clamp)");

    Check(HgpRingerSlots.InstrumentForSlot(0) == Instrument.FiveFretGuitar
        && HgpRingerSlots.InstrumentForSlot(3) == Instrument.Keys
        && ChartEnumExtensions.PossibleInstruments(GameMode.ProKeys).Intersect(HgpRingerSlots.Instruments).Count() == 5,
        "all ringer slots are playable in Five-Lane Keys (GameMode.ProKeys)");

    Console.WriteLine(failures == 0 ? "selftest OK" : $"selftest: {failures} failure(s)");
    return failures == 0 ? 0 : 1;
}

int Prepare(string exportsDir, string outDir)
{
    Directory.CreateDirectory(outDir);
    foreach (var src in Directory.GetDirectories(exportsDir))
    {
        if (!File.Exists(Path.Combine(src, "notes.mid"))) continue;
        var dst = Path.Combine(outDir, Path.GetFileName(src));
        Directory.CreateDirectory(dst);
        foreach (var f in new[] { "notes.mid", "song.ini" })
            File.Copy(Path.Combine(src, f), Path.Combine(dst, f), true);

        // YARG's scanner rejects charts with no audio; a placeholder lets it scan, then real stems overwrite it
        var placeholder = Path.Combine(dst, BellSynth.StemNames[0] + ".wav");
        if (!File.Exists(placeholder)) BellSynth.WriteWav(placeholder, new float[BellSynth.SampleRate / 10]);
    }

    var songs = SongLoader.Scan(outDir, Console.Out);
    foreach (var song in songs)
    {
        var sw = Stopwatch.StartNew();
        var stems = BellSynth.RenderStems(song, song.Directory);
        Console.WriteLine($"{song.Title,-32} {string.Join(", ", stems)}  ({sw.ElapsedMilliseconds} ms)");
    }

    Console.WriteLine($"Prepared {songs.Count} song folder(s) in {Path.GetFullPath(outDir)}");
    return songs.Count > 0 ? 0 : 1;
}

int ScanCmd(string songsDir)
{
    var sw = Stopwatch.StartNew();
    var songs = SongLoader.Scan(songsDir, Console.Out);
    Console.WriteLine($"YARG.Core scan: {songs.Count} song(s) in {sw.ElapsedMilliseconds} ms\n");
    Console.WriteLine("| Song | Ringer part (instrument) | Expert notes | Lanes used | Stem |");
    Console.WriteLine("|---|---|---|---|---|");
    foreach (var song in songs)
    {
        foreach (var instrument in song.Ringers)
        {
            var part = SongLoader.RingerPart(song.Chart, instrument);
            int notes = part.Notes.Sum(n => SongLoader.All(n).Count());
            var lanes = part.Notes.SelectMany(SongLoader.All).Select(n => n.Fret).Distinct().OrderBy(x => x);
            int slot = Array.IndexOf(HgpRingerSlots.Instruments, instrument);
            string stem = BellSynth.StemNames[slot] + ".wav";
            bool hasStem = File.Exists(Path.Combine(song.Directory, stem));
            Console.WriteLine($"| {song.Title} | {slot + 1} ({instrument}) | {notes} | {string.Join(" ", lanes)} | {(hasStem ? stem : "missing")} |");
        }
    }
    return songs.Count > 0 ? 0 : 1;
}

int Latency(string songsDir)
{
    double human = double.Parse(Opt("--human", "0"));
    double clock = double.Parse(Opt("--clock", "0"));
    int seeds = int.Parse(Opt("--seeds", "5"));
    var budgets = Opt("--budgets", "0,20,40,60,80").Split(',').Select(double.Parse).ToArray();

    var songs = SongLoader.Scan(songsDir, Console.Out);
    Console.WriteLine($"{songs.Count} songs x {songs.Sum(s => s.Ringers.Count) / Math.Max(1, songs.Count)} ringers avg, " +
        $"{seeds} seeds; human σ {human} ms; clock-sync σ {clock} ms; 60 fps; YARG EnginePreset.Default (Five-Lane Keys)\n");
    Console.WriteLine("System error = judged hit time − true strike time (excludes the player's own timing error).\n");
    Console.WriteLine("| Network (one-way) | Net p95 | Policy | Hit % | Overhits | |err| p50 | |err| p95 | |err| max | Inputs clamped by engine | Later than budget |");
    Console.WriteLine("|---|---|---|---|---|---|---|---|---|---|");

    var sw = Stopwatch.StartNew();
    foreach (var net in NetProfile.All)
    {
        foreach (var budget in budgets)
        {
            var results = new List<SimResult>();
            for (int seed = 0; seed < seeds; seed++)
                foreach (var song in songs)
                    foreach (var ringer in song.Ringers)
                        results.Add(LatencySim.Run(song, ringer, net, budget, human, clock, 1000 * seed + ringer.GetHashCode()));

            var errs = results.SelectMany(r => r.SystemErrorsMs).Select(Math.Abs).ToList();
            var delays = results.SelectMany(r => r.NetDelaysMs).ToList();
            int notes = results.Sum(r => r.Notes), hits = results.Sum(r => r.Hits);
            string policy = budget == 0 ? "stock YARG" : $"lookbehind {budget} ms";
            Console.WriteLine($"| {net.Name} | {LatencySim.Percentile(delays, 0.95):0.0} ms | {policy} | {100.0 * hits / notes:0.0} % " +
                $"| {results.Sum(r => r.Overhits)} | {LatencySim.Percentile(errs, 0.5):0.0} ms | {LatencySim.Percentile(errs, 0.95):0.0} ms " +
                $"| {(errs.Count > 0 ? errs.Max() : double.NaN):0.0} ms | {results.Sum(r => r.InputsClamped)} | {results.Sum(r => r.LateForBudget)} |");
        }
    }
    Console.WriteLine($"\n({sw.ElapsedMilliseconds} ms)");
    YargLogger.FlushLogQueue();
    return 0;
}

int Send()
{
    int port = int.Parse(Opt("--port", HgpBridge_DefaultPort().ToString()));
    int ringers = int.Parse(Opt("--ringers", "4"));
    string? songDir = Opt("--song", "");
    var net = Opt("--net", "typical") switch
    {
        "ideal" => NetProfile.All[0],
        "good" => NetProfile.All[1],
        "congested" => NetProfile.All[3],
        _ => NetProfile.All[2],
    };
    double countdown = double.Parse(Opt("--countdown", "5"));

    using var udp = new UdpClient();
    udp.Connect(IPAddress.Loopback, port);
    var clock = Stopwatch.StartNew();
    double Now() => clock.Elapsed.TotalSeconds;
    void SendPacket(HgpPacket p)
    {
        var bytes = Encoding.UTF8.GetBytes(p.ToString());
        udp.Send(bytes, bytes.Length);
    }

    for (int r = 0; r < ringers; r++) SendPacket(HgpPacket.Hello($"sim{r + 1}", r, $"Sim ringer {r + 1}"));
    Console.WriteLine($"Joined {ringers} simulated ringer(s) on 127.0.0.1:{port} (net: {net.Name}).");

    var events = new List<(double send, HgpPacket p)>();
    if (!string.IsNullOrEmpty(songDir))
    {
        var song = SongLoader.Scan(Path.GetDirectoryName(Path.GetFullPath(songDir))!, TextWriter.Null)
            .First(s => Path.GetFullPath(s.Directory).TrimEnd('\\') == Path.GetFullPath(songDir).TrimEnd('\\'));
        var rng = new Random(7);
        double t0 = Now() + countdown;
        for (int r = 0; r < Math.Min(ringers, song.Ringers.Count); r++)
        {
            long seq = 0;
            double lastSend = 0;
            foreach (var parent in SongLoader.RingerPart(song.Chart, song.Ringers[r]).Notes)
            {
                foreach (var note in parent.AllNotes)
                {
                    int bell = Math.Max(0, note.Fret - 1);
                    double strike = t0 + note.Time;
                    double send = Math.Max(lastSend, strike + net.Sample(rng));
                    lastSend = send;
                    events.Add((send, HgpPacket.Ring($"sim{r + 1}", bell, true, strike, ++seq)));
                    events.Add((Math.Max(send, strike + 0.06), HgpPacket.Ring($"sim{r + 1}", bell, false, strike + 0.06, ++seq)));
                }
            }
        }
        events.Sort((a, b) => a.send.CompareTo(b.send));
        Console.WriteLine($"Playing '{song.Title}' in {countdown} s: start the song in YARG so its first beat lines up (smoke test; absolute offset depends on your start).");
    }

    double nextSync = 0;
    int idx = 0;
    double stopAt = events.Count > 0 ? events[^1].send + 2 : Now() + 30;
    while (Now() < stopAt)
    {
        double now = Now();
        if (now >= nextSync) { SendPacket(HgpPacket.Sync(now)); nextSync = now + 0.1; }
        while (idx < events.Count && events[idx].send <= now) SendPacket(events[idx++].p);
        Thread.Sleep(1);
    }

    for (int r = 0; r < ringers; r++) SendPacket(HgpPacket.Bye($"sim{r + 1}"));
    Console.WriteLine($"Sent {idx} ring packets.");
    return 0;
}

static int HgpBridge_DefaultPort() => 47800;
