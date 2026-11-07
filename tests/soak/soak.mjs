#!/usr/bin/env node
// H-3 soak test (owner: david). Real models on the Mac host, a long live session, resource logging.
//   node tests/soak/soak.mjs [minutes=30] [outDir=./soak-out]
// Pipeline (same main-process modules the app uses): startAI (real) + P2P host room + 1 local peer + library session.
// Input: fixtures/lecture.wav looped through ai.pushAudio in real time (100 ms frames), slides from fixtures/slides.json.
// Every 10 s logs one CSV row: t, rss of this process + every child (QVAC bare workers), cpu%, temp-file count/bytes,
// counters (finals, partials, notes, auto slide changes, stt/agent/worker errors), peer-received counts.
// At the end: summary JSON + any new macOS crash reports (~/Library/Logs/DiagnosticReports) for Electron/bare/node.
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, appendFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MIN = Number(process.argv[2] || 30)
const OUT = resolve(process.argv[3] || join(ROOT, 'soak-out'))
mkdirSync(OUT, { recursive: true })
const CSV = join(OUT, 'soak.csv'); const LOG = join(OUT, 'soak.log')
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.join(' ')}`; console.log(l); appendFileSync(LOG, l + '\n') }
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href)

const t0 = Date.now()
const crashDirs = [join(homedir(), 'Library/Logs/DiagnosticReports'), '/Library/Logs/DiagnosticReports']
const crashBefore = new Set(crashDirs.flatMap((d) => { try { return readdirSync(d).map((f) => join(d, f)) } catch { return [] } }))

// ---------- counters
const c = { finals: 0, partials: 0, notes: 0, autoSlides: 0, sttErrors: 0, agentErrors: 0, aiErrors: 0, workerErrors: 0, peerChunks: 0, peerPartials: 0, peerNotes: 0, peerSlides: 0, unhandled: 0 }
process.on('unhandledRejection', (e) => { c.unhandled++; log('UNHANDLED REJECTION', String(e?.stack || e).slice(0, 400)) })
process.on('uncaughtException', (e) => { c.unhandled++; log('UNCAUGHT EXCEPTION', String(e?.stack || e).slice(0, 400)) })
const origErr = console.error.bind(console)
console.error = (...a) => { const s = a.map(String).join(' '); if (/stt|transcri/i.test(s)) c.sttErrors++; if (/agent|summar|note/i.test(s)) c.agentErrors++; if (/worker|RPC|Bare/i.test(s)) c.workerErrors++; appendFileSync(LOG, 'ERR ' + s.slice(0, 500) + '\n'); origErr(...a) }

// ---------- pipeline
const hostBus = new EventEmitter(); hostBus.setMaxListeners(200)
const peerBus = new EventEmitter(); peerBus.setMaxListeners(200)
hostBus.on('transcript:chunk', () => c.finals++)
hostBus.on('transcript:partial', () => c.partials++)
hostBus.on('note:added', () => c.notes++)
hostBus.on('slide:changed', (e) => { if (e?.source === 'auto') c.autoSlides++ })
hostBus.on('ai:status', (s) => { if (s?.state === 'error') { c.aiErrors++; log('ai:status error', JSON.stringify(s).slice(0, 300)) } })
hostBus.on('stt:error', (e) => { c.sttErrors++; log('stt:error', JSON.stringify(e).slice(0, 200)) })
peerBus.on('transcript:chunk', () => c.peerChunks++)
peerBus.on('transcript:partial', () => c.peerPartials++)
peerBus.on('note:added', () => c.peerNotes++)
peerBus.on('slide:changed', () => c.peerSlides++)

const { startAI } = await imp('src/ai/index.js')
const ai = await startAI({ bus: hostBus, mock: process.env.LECSCRIBE_AI_MOCK === '1' })
if (typeof ai.ready === 'function') { log('waiting for models…'); await ai.ready() }
log('AI ready')

let room = null; let peer = null; let lib = null; let lectureId = null
try {
  const p2p = await imp('src/p2p/index.js')
  room = await p2p.createRoom({ bus: hostBus, storage: mkdtempSync(join(tmpdir(), 'soak-host-')), title: 'Soak · Week 3', moduleId: 'soak', weekId: 'soak' })
  peer = await p2p.joinRoom({ bus: peerBus, key: room.key, storage: mkdtempSync(join(tmpdir(), 'soak-peer-')) })
  log('P2P host room + local peer up', room.link)
} catch (e) { log('P2P setup failed (continuing without):', e.message) }
try {
  const { createLibrary } = await imp('src/library/index.js')
  lib = await createLibrary({ dir: mkdtempSync(join(tmpdir(), 'soak-lib-')), embed: ai.embed, bus: hostBus })
  const m = await lib.createModule({ name: 'Soak' }); const L = await lib.createLecture(m.id, { title: 'Soak lecture' }); lectureId = L.id
  await lib.startSession(L.id)
  log('library session started')
} catch (e) { log('library setup failed (continuing without):', e.message) }

const slides = JSON.parse(readFileSync(join(ROOT, 'fixtures/slides.json'), 'utf8')).map((s) => ({ ...s, image: join(ROOT, s.image) }))
hostBus.emit('slides:loaded', slides)

// ---------- audio: lecture.wav as Float32 16 kHz mono, looped in real time
function wavF32 (p) {
  const b = readFileSync(p); let o = 12; let data
  while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4); const n = b.readUInt32LE(o + 4); if (id === 'data') data = b.subarray(o + 8, o + 8 + n); o += 8 + n + (n % 2) }
  const f = new Float32Array(data.length / 2); for (let i = 0; i < f.length; i++) f[i] = data.readInt16LE(i * 2) / 32768; return f
}
const pcm = wavF32(join(ROOT, 'fixtures/lecture.wav'))
const FRAME = 1600 // 100 ms
let pos = 0; let loops = 0; let pushed = 0
const startAudio = Date.now()
const audioTimer = setInterval(() => {
  const due = Math.floor((Date.now() - startAudio) / 100)
  while (pushed < due) {
    if (pos >= pcm.length) {
      pos = 0; loops++
      log(`loop ${loops} done → back to slide 0`)
      hostBus.emit('slide:changed', { index: 0, source: 'manual' })
    }
    ai.pushAudio(pcm.slice(pos, pos + FRAME)); pos += FRAME; pushed++
  }
}, 50)

// ---------- resource sampling
function procTree () {
  try {
    const out = execSync('ps -Ao pid=,ppid=,rss=,pcpu=,comm=', { encoding: 'utf8' })
    const rows = out.trim().split('\n').map((l) => { const [pid, ppid, rss, cpu, ...cmd] = l.trim().split(/\s+/); return { pid: +pid, ppid: +ppid, rss: +rss, cpu: +cpu, cmd: cmd.join(' ') } })
    const kids = new Set([process.pid]); let grew = true
    while (grew) { grew = false; for (const r of rows) if (kids.has(r.ppid) && !kids.has(r.pid)) { kids.add(r.pid); grew = true } }
    return rows.filter((r) => kids.has(r.pid))
  } catch { return [] }
}
function tmpStats () {
  let files = 0; let bytes = 0
  for (const d of readdirSync(tmpdir())) {
    if (!/^(lecscribe|qvac)/i.test(d)) continue
    const p = join(tmpdir(), d)
    try { const st = statSync(p); if (st.isDirectory()) { for (const f of readdirSync(p)) { try { const s2 = statSync(join(p, f)); files++; bytes += s2.size } catch {} } } else { files++; bytes += st.size } } catch {}
  }
  return { files, bytes }
}
writeFileSync(CSV, 't_s,node_rss_mb,workers_rss_mb,total_rss_mb,cpu_pct,n_procs,tmp_files,tmp_mb,loops,finals,partials,notes,auto_slides,stt_err,agent_err,ai_err,worker_err,unhandled,peer_chunks,peer_partials,peer_notes,peer_slides\n')
const samples = []
function sample () {
  const t = Math.round((Date.now() - t0) / 1000)
  const ps = procTree(); const me = ps.find((p) => p.pid === process.pid)
  const node = (me?.rss || process.memoryUsage().rss / 1024) / 1024
  const workers = ps.filter((p) => p.pid !== process.pid).reduce((a, p) => a + p.rss, 0) / 1024
  const cpu = ps.reduce((a, p) => a + p.cpu, 0)
  const tmp = tmpStats()
  const row = { t, node: +node.toFixed(1), workers: +workers.toFixed(1), total: +(node + workers).toFixed(1), cpu: +cpu.toFixed(0), n: ps.length, tmpFiles: tmp.files, tmpMb: +(tmp.bytes / 1048576).toFixed(1), loops, ...c }
  samples.push(row)
  appendFileSync(CSV, [row.t, row.node, row.workers, row.total, row.cpu, row.n, row.tmpFiles, row.tmpMb, loops, c.finals, c.partials, c.notes, c.autoSlides, c.sttErrors, c.agentErrors, c.aiErrors, c.workerErrors, c.unhandled, c.peerChunks, c.peerPartials, c.peerNotes, c.peerSlides].join(',') + '\n')
  if (t % 60 < 10) log(`t=${t}s rss node=${row.node}MB workers=${row.workers}MB total=${row.total}MB cpu=${row.cpu}% tmp=${row.tmpFiles} files/${row.tmpMb}MB loops=${loops} finals=${c.finals} partials=${c.partials} notes=${c.notes} errs stt/agent/ai/worker/unh=${c.sttErrors}/${c.agentErrors}/${c.aiErrors}/${c.workerErrors}/${c.unhandled} peer chunks/notes=${c.peerChunks}/${c.peerNotes}`)
}
sample()
const sampler = setInterval(sample, 10_000)

// ---------- finish
setTimeout(async () => {
  clearInterval(audioTimer); clearInterval(sampler); sample()
  const crashNew = crashDirs.flatMap((d) => { try { return readdirSync(d).map((f) => join(d, f)) } catch { return [] } })
    .filter((f) => !crashBefore.has(f) && /electron|bare|node|lecscribe/i.test(f))
  const first = samples.find((s) => s.t >= 120) || samples[0]; const last = samples.at(-1)
  const slope = (k) => (last[k] - first[k]) / Math.max(1, (last.t - first.t) / 60)
  const summary = {
    minutes: MIN, loops, ...c,
    rss_mb: { start: first.total, end: last.total, max: Math.max(...samples.map((s) => s.total)), growth_per_min: +slope('total').toFixed(2) },
    node_mb_growth_per_min: +slope('node').toFixed(2), workers_mb_growth_per_min: +slope('workers').toFixed(2),
    tmp: { start_files: first.tmpFiles, end_files: last.tmpFiles, end_mb: last.tmpMb },
    newCrashReports: crashNew,
    lectureSaved: lib && lectureId ? await lib.getLecture(lectureId).then((L) => ({ transcript: L.transcript.length, slides: L.slides.length, notes: L.notes.length })).catch((e) => String(e)) : null,
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  log('SUMMARY ' + JSON.stringify(summary))
  try { await lib?.endSession?.() } catch {}
  try { await peer?.close() } catch {}
  try { await room?.close() } catch {}
  try { await ai.close() } catch {}
  process.exit(0)
}, MIN * 60_000)
log(`soak running for ${MIN} min → ${OUT}`)
