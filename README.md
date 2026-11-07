# LecScribe

**The smart way to listen to lectures.** LecScribe is a lecture companion that listens on your own laptop, follows the slides, and writes margin notes for what the lecturer *says* that isn't *on the slide*. There's no cloud and no accounts: all AI runs on-device through **Tether QVAC**, and coursemates join peer-to-peer through **Pears**.

Built at a hackathon by David Xie, Aryan Saha, Aaron Mathew and Filip Mazur.

---

## ⚠️ Platform support

| Platform | Host a lecture (listen, AI notes, share) | View a lecture (join, follow, notes) |
|---|---|---|
| **macOS, Apple Silicon** (tested on an M5, macOS 26) | ✅ **Yes**: the only supported host | ✅ Yes |
| **Windows** | ❌ **No**: the QVAC AI workers don't run on Windows, so hosting is disabled | ✅ **Viewer only**: join with a 6-digit code or link and receive slides, live transcript and notes |
| Linux | Untested | Untested |

**In short: the lecturer's laptop must be a Mac. Windows laptops can only join and view.**

---

## Features

- **Follows along:** shows the slides and **auto-advances** when the lecturer moves on (speech matched against slide embeddings). There's a manual override and an *Auto-follow* switch.
- **Live transcript:** instant grey text in under 1 s, then accurate final text (Whisper large-v3-turbo).
- **Margin notes:** background agents write sticky notes only for points **said but not on the slide**, labelled as AI-generated and linked to their slide and transcript.
- **Auto-saved notes + ★ Important:** every note is saved; star the ones that matter. Each module has an **Important** list.
- **Exam flag:** say "*this will come up in the exam*" and the note gets a red **Exam** pill.
- **"I'm lost" + heatmap:** viewers tap *I'm lost*, and the lecturer sees anonymous per-slide counts.
- **Explain slide:** the lecturer records a quick re-explanation, which is summarised and pinned as a *Lecturer explanation* note. *Explain this* also lets any viewer ask the host's AI.
- **Library:** modules → lectures, each lecture with **its own vector store**. Summaries, personal notes (**local to your device only**), and **Ask across lectures** search.
- **Peer to peer (Pears):** share a live session with a **6-digit code** / QR / link, or pick it from **Nearby sessions**. Peers receive slides, transcript and notes live, with no server. **Share notes** sends a missed lecture to a coursemate.
- **Present mode:** **F** = fullscreen, **Esc** exits, arrows/clicker to navigate.

---

## Quick start

### macOS host (lecturer)

```bash
git clone https://github.com/SnakeLuck360GT/lecture.git && cd lecture
npm install
npm run ai:warm     # once, WITH internet: downloads + smoke-tests all models (~3.5 GB, cached in ~/.qvac)
npm start           # launch LecScribe (from Terminal.app, not a VS Code terminal)
```

1. **New module** → **New lecture** → **Open PDF** (or *Demo deck*).
2. Pick the microphone (watch the level meter) → **Start listening**.
3. **Live session → Share live session** shows the 6-digit code for coursemates.

Packaged app: `npm run package` → `out/LecScribe-darwin-arm64/LecScribe.app`.

### Windows viewer (coursemate)

```bash
git clone https://github.com/SnakeLuck360GT/lecture.git && cd lecture
npm install
npm start
```

In the Library sidebar, either click the session under **Nearby sessions** or type the **6-digit code** under **Join a live session**. All host controls are hidden on Windows.

### Networking

- Host and viewers need to be on the **same network**, ideally a **phone hotspot**. University Wi-Fi such as eduroam isolates devices and blocks peer-to-peer connections.
- Start the live session **after** the Mac has joined the network.
- On a Mac, **never click Join / Nearby on the host**: joining turns the device into a viewer and stops its AI.

---

## Demo tips

- Plug in the charger and keep the Mac awake (`caffeinate -dims`).
- Run **one** LecScribe window only.
- Keyboard: **F** present · **Esc** exit · **Shift+L** simulate 3 "I'm lost" taps (heatmap, works offline) · **Shift+E** explain the current slide from `fixtures/explain.wav`.
- Notes appear about 12 s into a slide (≥ ~40 spoken words) or when you move to the next slide.

---

## Development

| Command | What it does |
|---|---|
| `npm start` | Run the app (real models) |
| `npm run start:mock` | Run with mock AI (no models; any OS) |
| `npm test` | Contract + unit tests (`tests/`, `src/**/*.test.js`) |
| `npm run ai:warm` | Download + smoke-test all models |
| `npm run ai:live-demo` | Stream a WAV through the live AI pipeline in the terminal |
| `npm run sim-taps -- <link>` | Simulate "I'm lost" taps from fake peers |
| `node tests/soak/soak.mjs 30 ./soak-out` | 30-min soak test (memory/crash logging, macOS) |
| `npm run package` | Build `LecScribe.app` (macOS arm64) |

**Layout:** `src/ai/` (QVAC: STT, embeddings, tracker, note agents, explain, OCR) · `src/p2p/` (Pears rooms, lost taps, share links) · `src/library/` (modules, lectures, per-lecture vector stores) · `src/discovery/` (6-digit codes, nearby sessions) · `src/core/` + `ui/` (Electron app) · `tests/`, `fixtures/` (tests and demo inputs).

Team process: `CLAUDE.md` (rules) and `coord/` on `main` (spec, plan, bugs, test plan).
