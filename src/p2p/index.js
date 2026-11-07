// P2P facade (S6 room, S7 lost taps, S8 share link). Owner: aaron.
// Contracts: coord/contracts/stage-6.md, stage-7-p2p.md, stage-8.md
export { createRoom, joinRoom } from './room.js'
export { shareWeek, importWeek } from './share.js'
export { parseKey, roomLink, weekLink } from './util.js'
// App-shell adapter: src/core/main.js calls startP2P({ bus, ai }) and routes window.lec.p2p(method, ...args) to it.
export { startP2P } from './host.js'
export { startP2P as default } from './host.js'
