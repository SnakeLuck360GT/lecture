# aaron (CODER), Stage(s): S6, S7 (P2P half), S8, S5 library data layer, P2P UI components
## Status (updated 13:54)
- Doing: src/library data layer, then P2P UI components (ui/components/)
- Done: S6/S7-p2p/S8 + startP2P adapter merged (PR #5, #9); 49/49 tests
- Next: 2-device + hotspot test with david; fix anything filip hits
- Blocked on: nothing
## Messages (newest first)
- [13:57] @aryan: re your SDK note: checked npm ls; @qvac/sdk and src/p2p share ONE copy each of hyperswarm 4.17.2 / corestore 7.16.1 / hypercore 11.40.3 / hyperdht 6.36.0 (all deduped). No version clash.
- [13:54] @all: merged PR #9 into dev: src/p2p now exports startP2P({ bus, ai }), so filip's main loads P2P automatically ("[main] P2P started"). 49/49 tests. Contract stage-6.md v1.1 has the method table.
- [13:54] @filip: re 13:49. Use window.lec.p2p(...): Share room = createRoom({ title, moduleId, weekId }) -> { link, peers } (render link + QR, update count on p2p:peers events). Join box = joinRoom(pastedText), then the normal viewer from bus events (it stops local AI). I am lost = lost(currentIndex, !pressed) -> lostState. Heatmap = lost:counts event (host). Hidden fallback key: simulateLost(slide, n). Share week = shareWeek(bundle) -> { link }; missed week paste = importWeek(link) -> bundle (notes have shared:true). All return plain data.
- [13:49] @david: ack #5. My shell is discarded (nothing was pushed), merged origin/dev (S1 #6 + #7). Now adding startP2P({ bus, ai }) to src/p2p/index.js for filip's main. PR in ~10 min.
- [13:45] @david: ack RE-TASK 13:44: building the bare Electron shell (app/main.js, app/preload.cjs, src/core/bus.js, ui/index.html placeholder). ETA 14:00. @filip: FYI, build S1 on top of it; app/, ui/, src/core/ are yours after merge.
- [13:42] @david: ack #4.
- [13:39] @all: merged PR #5 (S6 room, S7 lost-tap merge + scripts/sim-taps.js, S8 share link) into dev, pull it. Adds a ROOT package.json ("type":"module", test + sim-taps scripts, P2P deps): run npm install. @filip: fold your S1 fields into it; keep the deps.
- [13:39] @david: npm test 40/40 green on my machine incl. your tests/contracts/p2p.test.mjs over the public DHT (live note latency 51 ms). Please verify on the 2 Macs: node src/p2p/scripts/room-demo.js host | join <link>; npm run sim-taps -- <link> --spread "2:3,3:1".
- [13:39] @filip: to wire the host: const room = await createRoom({ bus, title, moduleId, weekId }) after slides load (it re-publishes slides:loaded/slide:changed/note:added by itself). Show room.link + QR + p2p:peers count. Peer mode: await joinRoom({ bus, key: pastedText }) and render from the same bus events; "I am lost" -> peer.lost(currentIndex, !pressed); heatmap <- lost:counts. Week share: shareWeek(bundle).link / importWeek(link).
- [13:29] @david: ack #3 (live mic; no change for P2P).
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
- P2P works over the real public DHT (verified 13:39, same machine): peer gets all 5 slides + images 0.5 s after joining; live note latency ~51 ms; no server.
- Heatmap on cue: `npm run sim-taps -- <room link> --slide 2 --devices 6` (fake devices join over Pears and tap). Offline fallback: room.simulateLost(slide, n).
- Share link demo: `node src/p2p/scripts/share-demo.js share` -> lecscribe://week/... ; `... import <link>` on another device.
- Risk: campus Wi-Fi may block UDP hole punching -> use a phone hotspot. Needs internet for DHT discovery (AI stays offline).
