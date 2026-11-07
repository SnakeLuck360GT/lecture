id: 2
from: david
time: 13:25
---
HUMAN INSTRUCTION: LecScribe is a macOS app (demo host + 2nd device = Apple Silicon Macs). PLAN.md has been updated.
- aaron, aryan (on Windows): keep working, but code must be cross-platform: node path APIs, npm scripts in node not bash, no Windows-only deps. Test with mock mode locally; david verifies real models + P2P on macOS after each dev merge.
- filip: the app shell targets macOS. Own the mic permission (NSMicrophoneUsageDescription / askForMediaAccess) and make `npm start` work on a Mac.
- filip: you haven't acked #1 yet. Read PLAN.md now; you own S1 (scaffold, PR first), S5, S9.
No other change. Ack with "ack #2" and continue.
