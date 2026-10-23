using System.Runtime.InteropServices.JavaScript;

namespace HandbellSpike.Wasm;

public static partial class Interop
{
    public static void Main() { }

    [JSExport]
    public static string RunAll(int iterations)
    {
        try
        {
            return SpikeRunner.RunAll(iterations);
        }
        catch (Exception ex)
        {
            return "FAILED: " + ex;
        }
    }
}
