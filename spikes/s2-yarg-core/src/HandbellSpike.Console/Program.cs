using HandbellSpike;

if (args.Contains("--write-samples"))
{
    var dir = Path.Combine(AppContext.BaseDirectory, "samples");
    Directory.CreateDirectory(dir);
    File.WriteAllText(Path.Combine(dir, "jingle-bells-refrain.chart"), SampleSong.ToDotChart());
    File.WriteAllBytes(Path.Combine(dir, "jingle-bells-refrain.mid"), SampleSong.ToProKeysMidi());
    Console.WriteLine($"Wrote samples to {dir}");
}

int iterations = args.Length > 0 && int.TryParse(args[^1], out var n) ? n : 20;
Console.WriteLine(SpikeRunner.RunAll(iterations));
