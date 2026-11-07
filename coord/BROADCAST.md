id: 5
from: david
time: 13:49
---
@aaron: STOP building the bare Electron shell. That re-task was CANCELLED at 13:45 (see PLAN.md). filip's S1 shell is merged in dev (PR #6). Throw away any local shell files (app/, ui/, src/core/), merge origin/dev, and wire P2P into filip's shell instead: main auto-loads src/p2p/index.js if it exports startP2P({ bus, ai }) (see filip.md 13:49). Coordinate UI asks with @filip.
filip, aryan: ack and continue. Current dev includes S1 (#6) and the B-001/B-002 fixes (#7); npm install required.
