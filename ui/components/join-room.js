// "Join a session" box (sidebar footer): paste a lecscribe://room/ link -> this device becomes a peer viewer.
// Owner: aaron. Mounted by filip.
//
//   import { mountJoinRoom } from './components/join-room.js'
//   const join = mountJoinRoom(el, { onJoined: (info) => showLectureView({ peer: true }), onLeft: () => showLibrary() })
//
// After joining, the host's slides:loaded / slide:changed / note:added arrive on the normal bus, so the usual
// Lecture view renders them. Talks only to window.lec: lec.p2p('joinRoom'|'leaveRoom'|'info') + p2p:status events.
import { injectStyle, h, setKids, icon, friendlyError, BASE_CSS } from './p2p-shared.js'

const CSS = BASE_CSS + `
.lec-join-room { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink, #1f2328); }
.lec-join-room__label { font-size: 12px; font-weight: 600; color: var(--muted, #6b6f76); }
.lec-join-room__row { display: flex; gap: 6px; }
.lec-join-room__status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted, #6b6f76); }
.lec-join-room__status.is-ok { color: var(--accent, #2f6f5e); }
.lec-join-room__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.lec-join-room__status.is-wait .lec-join-room__dot { animation: lec-join-pulse 1.2s infinite; }
@keyframes lec-join-pulse { 50% { opacity: .3; } }
`

export function mountJoinRoom (el, { onJoined, onLeft } = {}) {
  injectStyle('lec-join-room-style', CSS)
  const lec = window.lec
  let destroyed = false
  let role = null
  let conn = 'idle' // idle | connecting | connected
  let busy = false
  let error = ''
  let slow = false // joined, but no connection to the lecturer after SLOW_MS
  let slowTimer = null
  const SLOW_MS = 20000
  const CALL_TIMEOUT_MS = 15000
  const armSlow = () => {
    clearTimeout(slowTimer)
    slow = false
    slowTimer = setTimeout(() => { if (conn !== 'connected') { slow = true; render() } }, SLOW_MS)
  }

  const root = h('div', { class: 'lec-join-room' })
  el.replaceChildren(root)
  const input = h('input', { class: 'lec-input', type: 'text', placeholder: 'Link or 6-digit code', spellcheck: 'false', 'aria-label': 'Session link or join code' })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join() })

  function render () {
    if (destroyed) return
    if (role === 'peer') {
      const ok = conn === 'connected'
      setKids(root, 
        h('span', { class: 'lec-join-room__label' }, 'Following a live session'),
        h('div', { class: `lec-join-room__status ${ok ? 'is-ok' : 'is-wait'}` }, h('span', { class: 'lec-join-room__dot' }), ok ? 'Connected to the lecturer' : 'Looking for the lecturer…'),
        !ok && slow ? h('span', { class: 'lec-muted' }, 'Can’t reach the lecturer’s laptop yet. Are you both on the same Wi-Fi or hotspot? Still trying…') : null,
        h('div', { class: 'lec-join-room__row' }, h('button', { class: 'lec-btn lec-btn--quiet', onclick: leave, disabled: busy }, 'Leave session')),
        error ? h('span', { class: 'lec-err' }, error) : null)
      return
    }
    setKids(root, 
      h('span', { class: 'lec-join-room__label' }, 'Join a live session'),
      h('div', { class: 'lec-join-room__row' }, input,
        h('button', { class: 'lec-btn', onclick: join, disabled: busy || role === 'host', title: role === 'host' ? 'You are hosting a session' : 'Join' }, icon('join'), busy ? 'Joining…' : 'Join')),
      error ? h('span', { class: 'lec-err' }, error) : null)
  }

  async function join () {
    let link = input.value.trim()
    if (!link) { error = 'Paste the link or type the 6-digit code your lecturer shared.'; render(); return }
    // A 6-digit join code ("482 913", "482-913") -> resolve it to the room link (aryan's src/discovery).
    const digits = link.replace(/[\s-]/g, '')
    if (/^\d{6}$/.test(digits)) {
      if (typeof lec.discovery !== 'function') { error = 'Join codes aren’t available in this version. Paste the full link instead.'; render(); return }
      busy = true; error = ''; render()
      try {
        link = await lec.discovery('resolveCode', digits)
      } catch (err) {
        busy = false
        error = /CODE_NOT_FOUND/.test(String(err?.message || err?.code)) ? 'No live session with that code. Check the code with the lecturer, and that you’re on the same Wi-Fi or hotspot.' : friendlyError(err)
        render()
        return
      }
    }
    busy = true; error = ''; conn = 'connecting'; render()
    // B-014: never leave the button stuck on "Joining…" if main is slow to answer.
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('JOIN_SLOW')), CALL_TIMEOUT_MS) })
    try {
      const info = await Promise.race([lec.p2p('joinRoom', link), timeout])
      role = info?.role || 'peer'
      if (info?.connected) conn = 'connected'
      input.value = ''
      armSlow()
      if (onJoined) onJoined(info)
    } catch (err) {
      conn = 'idle'
      error = /JOIN_SLOW/.test(String(err?.message)) ? 'LecScribe is taking too long to join. Try again in a moment.' : friendlyError(err)
    }
    clearTimeout(timer)
    busy = false; render()
  }
  async function leave () {
    busy = true; render()
    try { await lec.p2p('leaveRoom') } catch {}
    role = null; conn = 'idle'; busy = false; slow = false; clearTimeout(slowTimer); render()
    if (onLeft) onLeft()
  }

  const off = lec.on('p2p:status', (s) => {
    if (s?.role !== 'peer') return
    if (s.state === 'connected') { conn = 'connected'; slow = false; clearTimeout(slowTimer) } else if (s.state === 'connecting') { conn = 'connecting'; if (role === 'peer') armSlow() }
    else if (s.state === 'error') error = s.error || 'Connection problem'
    render()
  })
  const offEnd = lec.on('room:ended', () => { error = 'The lecturer ended the session.'; render() })

  lec.p2p('info').then((info) => { role = info?.role || null; if (info?.connected) conn = 'connected'; render() }).catch(() => render())
  render()

  return { destroy () { destroyed = true; clearTimeout(slowTimer); off && off(); offEnd && offEnd(); el.replaceChildren() } }
}
