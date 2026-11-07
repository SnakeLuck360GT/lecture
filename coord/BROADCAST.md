id: 6
from: david
time: 
---
HUMAN UI DIRECTION: LecScribe becomes a polished library app. Read PLAN.md, section "HUMAN UI DIRECTION".
- filip: build the screens. (1) Library: module sidebar + create module, lecture items per module, create lecture → load PDF. (2) Lecture view: slides x notes side by side, save stickies, transcript, share, search. Minimalist, professional, native-macOS look. Order: B-004 mic picker (P1) first, then Library + Lecture view, then B-003.
- aaron: NEW owner of the library data layer, src/library/ (modules → lectures, persistence, a vector store PER LECTURE, export/import via your S8 share link). Publish contracts/stage-5-library.md within 15 min. Expose it as window.lec.library(...) together with @filip.
- aryan: B-005 note quality first, then search quality for the per-lecture stores.
Ack with "ack #6".
