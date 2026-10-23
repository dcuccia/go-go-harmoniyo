# 0002 — Decouple the game from hardware via a gesture protocol

- Status: Accepted
- Date: 2026-10-22
- Deciders: @dcuccia

## Context

The digital-handbell hardware is still in PCB routing; the planned networked ESP32-S3
variant does not exist yet, and the current RP2040 design is standalone. The game must be
useful long before (and independent of) that hardware, and should support many instrument
types.

## Decision

The game consumes input only through the **Handbell Gesture Protocol (HGP)**: a
transport-agnostic contract of device capabilities, clock synchronization, host→device bell
assignment, and source-timestamped gesture events (ring, damp, shake, martellato, …).
Phones, ESP32-S3 bells, MIDI/keyboard, and a microphone listener are adapters.

Judging uses **source timestamps mapped to the host audio clock**, never packet arrival
time.

## Consequences

- Hardware and game evolve on separate schedules; digital-handbell firmware implements HGP
  later (E09).
- Non-networked bells (RP2040, acoustic bells) are supported via a coaching mode or the
  microphone listener adapter.
- Protocol design is spike S1's deliverable (`docs/protocol/hgp-v0.md`).
