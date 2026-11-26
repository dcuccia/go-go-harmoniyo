// VSCO-2 CE, pinned to 440300901dfe9275fd84e0b7763af1f8443ae62e (CC0-1.0).
// Sample data is never in the repository. The offsets and peaks were measured on these exact WAVs.
export const HARP_SAMPLES = [
  [38, 'D2', 'b9cbdc08e43fc0b28ac70246df991cb390f5cbd7f31519b3cc7f70d283b70566', 0.0439, 0.0184],
  [41, 'F2', 'd5c0fb42c176af334fd6f6d1b97858556619c51e177efb5b0c6c23bc19ce6dad', 0.0346, 0.0123],
  [45, 'A2', '1df9f4d138ca3931fcb458bcdf01304cadf2e5f4eef67bbc17b0e42c0e60fce6', 0.0385, 0.0301],
  [48, 'C3', 'e5d232771704e140959819de8cf2a3e0ba49d021ca77354c42664ce4fce6d9f3', 0.0021, 0.0136],
  [52, 'E3', 'aafa9d41ec0f77da8f2891055af8b3f9557e0ba1f1df93d53ae6e1fda07afae5', 0.0536, 0.0317],
  [55, 'G3', '62600eb1b37bc2829ca65351f7ca7e506c9ae472abd5bea0765a8b8fa7df2772', 0.068, 0.0579],
  [59, 'B3', 'f6f71be8c640822ef48a448b245585659acdfcc7ed5774e10f37be2fc02fcab4', 0.0351, 0.0536],
  [62, 'D4', 'ebfde8aab4411019e37e3426f4dd88d6a52a38c2d0261d7f10ec63d8ff584dc7', 0.0261, 0.0715],
  [65, 'F4', 'db27ebbb37334c10e06f2ae63f4d9ff555e4d11704fcc6f0bcf503863867e577', 0.0146, 0.0721],
  [69, 'A4', '3665f3975cad4a33f46784aa4f896f4b4319ba2b7831e892d975bc38c9f09f23', 0.0213, 0.1232],
] as const;

export const harpSample = (midi: number): (typeof HARP_SAMPLES)[number] =>
  HARP_SAMPLES.reduce((a, b) => Math.abs(b[0] - midi) < Math.abs(a[0] - midi) ? b : a);
