# aaron (CODER), Stage(s): S6, S7 (P2P half), S8
## Status (updated 13:27)
- Doing: building src/p2p (room + lost taps) against stub bus, 2-instance test on one machine
- Done: setup, ack #1/#2, contracts stage-6, 7-p2p, 8
- Next: sim-taps script, share link (S8), then PR to dev after S1 lands
- Blocked on: nothing
## Messages (newest first)
- [13:27] @all: P2P contracts published: contracts/stage-6.md (createRoom/joinRoom, room.link; the peer bus re-emits slides:loaded/slide:changed/note:added so the same viewer works), stage-7-p2p.md (peer.lost(i), host emits lost:counts, scripts/sim-taps.js), stage-8.md (shareWeek(bundle) -> link, importWeek(link) -> bundle). Runs in Node/Electron main, like the AI.
- [13:27] @filip: UI asks (details in the contracts): host "Share room" (link text + QR + peer count from p2p:peers); launch "Join a room" paste box -> read-only viewer; "I am lost" button -> peer.lost(i); heatmap from lost:counts; Share-week button + paste-link box in a missed week. Deps hyperswarm/corestore/hypercore/hyperdrive/b4a/hypercore-id-encoding: I will add them to package.json in my PR (additive) unless you prefer to.
- [13:25] @david: ack #2 (macOS target; my code stays cross-platform: node path APIs, node-only scripts). Contracts S6/S7-p2p/S8 coming in ~10 min.
- [13:20] @david: ack #1, ack PLAN, stages S6, S7 (P2P half), S8. Starting P2P spike + contracts now.
- [13:19] @all: aaron setup done.
## Provides / Needs   (include verified SDK/API notes here so others don't repeat the research)
- Pears (verified from installed READMEs, 13:30): hyperswarm@4.17.2 (swarm.join(topic,{server,client}), discovery.flushed(), swarm.flush(), on("connection",(socket,info))), corestore@7.16.1 (new Corestore(dir), store.get({name}|key), store.replicate(socket)), hypercore@11.40.3 (valueEncoding json, append, get, createReadStream({live:true}), registerExtension (legacy but works), discoveryKey), hyperdrive@13.3.4 (put/get/entry). Native addon rocksdb-native ships darwin-arm64 + win32 prebuilds.
## Decisions
- Project folder is C:\Users\aaron\Documents\Projects\lecture (human's start folder was not empty).
## Demo notes (for the presentation: what works, how to run it, URLs, screenshots, impressive numbers)
