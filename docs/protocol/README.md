# Handbell Gesture Protocol (HGP)

Hardware-agnostic contract between bells (phones, ESP32-S3 digital handbells, MIDI,
keyboards, microphone listener) and game hosts. See
[ADR-0002](../decisions/0002-decouple-app-from-hardware.md).

Status: **not yet drafted.** Spike S1 produces `hgp-v0.md`.

## Requirements (initial)

- Transport-agnostic message model; bindings for WebSocket/WebRTC first, BLE/UDP/serial later.
- Device hello: id, kind, sensors, sample rate, supported gestures, firmware/app version,
  battery (optional).
- Clock sync exchange sufficient for p95 ≤ 15 ms timestamp error on home Wi-Fi.
- Host → device: bell assignment (one or more pitches, colors/labels), optional local-sound
  instructions, haptic/LED cues.
- Device → host: gesture events with source timestamp, gesture type, bell id, optional
  intensity; sequence numbers for loss detection; optional raw-sensor streaming for
  diagnostics.
- Gesture vocabulary aligned with handbell technique: ring, damp, LV, shake/trill,
  martellato, martellato-lift, pluck, thumb damp, echo, swing, gyro, mallet.
- Versioned; unknown fields ignored.
