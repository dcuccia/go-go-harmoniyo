# 0003 — Holiday 2026 v1 scope

- Status: Accepted
- Date: 2026-10-22
- Deciders: @dcuccia

## Context

First real use: Christmas 2026, 3–5 family members playing carols in a living room. Players
have iPhones (younger players) and Pixel phones (adults). The owner's Windows PC will drive
the TV. Long-term target is a low-budget classroom with 4–12 ringers on a shared screen;
cross-platform reach is highly valued.

## Decision

v1 (release target Dec 18, 2026) is:
- **Setting:** one shared screen, one host device (Windows PC → TV by HDMI to start).
- **Controllers:** phones as handbells via a web page (iOS Safari + Android Chrome), joined
  by QR code over home Wi-Fi; no app install.
- **Songs:** public-domain carols imported from MIDI/MusicXML with automatic bell-to-ringer
  assignment; per-file license recorded. Clone Hero/YARG chart mapping is later (M9).
- **Out of scope:** online play, accounts, digital-handbell hardware, microphone scoring,
  licensed music.

The host engine is **not** decided here; see spikes S2–S6 and the M2 decision gate.

## Consequences

- The phone controller is web technology regardless of host engine.
- Any host engine must accept HGP input from the LAN.
- iPhone testing needs access to an iPhone before the Dec 7–13 playtest.
