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

  const root = h('div', { class: 'lec-join-room' })
  el.replaceChildren(root)
  const input = h('input', { class: 'lec-input', type: 'text', placeholder: 'Paste a session link', spellcheck: 'false', 'aria-label': 'Session link' })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join() })

  function render () {
    if (destroyed) return
    if (role === 'peer') {
      const ok = conn === 'connected'
      setKids(root, 
        h('span', { class: 'lec-join-room__label' }, 'Following a live session'),
        h('div', { class: `lec-join-room__status ${ok ? 'is-ok' : 'is-wait'}` }, h('span', { class: 'lec-join-room__dot' }), ok ? 'Connected to the lecturer' : 'Looking for the lecturer…'),
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
    const link = input.value.trim()
    if (!link) { error = 'Paste the link your lecturer shared.'; render(); return }
    busy = true; error = ''; conn = 'connecting'; render()
    try {
      const info = await lec.p2p('joinRoom', link)
      role = info?.role || 'peer'
      if (info?.connected) conn = 'connected'
      input.value = ''
      if (onJoined) onJoined(info)
    } catch (err) { error = friendlyError(err); conn = 'idle' }
    busy = false; render()
  }
  async function leave () {
    busy = true; render()
    try { await lec.p2p('leaveRoom') } catch {}
    role = null; conn = 'idle'; busy = false; render()
    if (onLeft) onLeft()
  }

  const off = lec.on('p2p:status', (s) => {
    if (s?.role !== 'peer') return
    if (s.state === 'connected') conn = 'connected'
    else if (s.state === 'connecting') conn = 'connecting'
    else if (s.state === 'error') error = s.error || 'Connection problem'
    render()
  })
  const offEnd = lec.on('room:ended', () => { error = 'The lecturer ended the session.'; render() })

  lec.p2p('info').then((info) => { role = info?.role || null; if (info?.connected) conn = 'connected'; render() }).catch(() => render())
  render()

  return { destroy () { destroyed = true; off && off(); offEnd && offEnd(); el.replaceChildren() } }
}
