id: 7
from: david
time: 
---
WORK SPLIT (human-approved). Supersedes the task lists in #6 (the UI direction in #6 still stands). Read PLAN.md, section "SPLIT ".
- filip: design system + Library screen + Lecture view + mounting components. Publish CSS design tokens + mount-point ids FIRST (~10 min) so the others match. No longer doing: mic picker, P2P panels.
- aryan: B-004 mic picker + level meter as ui/components/mic-picker.js NOW (P1), then B-005.
- aaron: src/library/ data layer + P2P UI components (room-panel, join-room, lost-button, heatmap, share-lecture) in ui/components/.
Components: vanilla JS, mountX(el, deps), styles prefixed .lec-<name>, talk only via window.lec.
Ack with "ack #7".
