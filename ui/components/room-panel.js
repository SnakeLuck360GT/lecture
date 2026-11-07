// Host "Share live session" panel: room link + QR + peer count. Owner: aaron. Mounted by filip.
//
//   import { mountRoomPanel } from './components/room-panel.js'
//   const panel = mountRoomPanel(el, { getRoomOptions: () => ({ title, moduleId, weekId: lectureId }) })
//   panel.destroy()
//
// Talks only to window.lec: lec.p2p('createRoom'|'leaveRoom'|'info'|'qr') and bus events p2p:peers / p2p:status.
import { injectStyle, h, setKids, icon, copyText, friendlyError, BASE_CSS } from './p2p-shared.js'

const CSS = BASE_CSS + `
.lec-room-panel { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: var(--ink, #1f2328); }
.lec-room-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lec-room-panel__title { font-weight: 600; font-size: 13px; }
.lec-room-panel__peers { display: inline-flex; align-items: center; gap: 6px; color: var(--muted, #6b6f76); font-size: 12px; }
.lec-room-panel__peers.is-live { color: var(--accent, #2f6f5e); }
.lec-room-panel__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.lec-room-panel__body { display: grid; grid-template-columns: 112px 1fr; gap: 12px; align-items: start; }
.lec-room-panel__qr { width: 112px; height: 112px; border-radius: 8px; border: 1px solid var(--line, #e3dfd6); background: #fff; padding: 4px; }
.lec-room-panel__qr svg { width: 100%; height: 100%; display: block; }
.lec-room-panel__side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.lec-room-panel__link { padding: 6px 8px; border-radius: 6px; background: var(--paper, #f6f4ef); border: 1px solid var(--line, #e3dfd6); user-select: all; }
.lec-room-panel__row { display: flex; gap: 6px; flex-wrap: wrap; }
.lec-room-panel__code { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 10px 12px; border-radius: 8px;
  background: var(--accent-soft, rgba(47,111,94,.1)); border: 1px solid var(--line, #e3dfd6); }
.lec-room-panel__code-label { font-size: 12px; color: var(--muted, #6b6f76); }
.lec-room-panel__code-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px; font-weight: 700; letter-spacing: .08em;
  color: var(--ink, #1f2328); font-variant-numeric: tabular-nums; user-select: all; }
`

// The join code survives re-mounts of the panel (popover opened/closed) within this window.
let currentAdvert = null // { code, link }
const hasDiscovery = () => typeof window.lec?.discovery === 'function'
export const formatCode = (c) => String(c || '').replace(/^(\d{3})(\d{3})$/, '$1 $2')

export function mountRoomPanel (el, { getRoomOptions = () => ({}), toast } = {}) {
  injectStyle('lec-room-panel-style', CSS)
  const lec = window.lec
  let destroyed = false
  let state = { role: null }
  let peers = 0
  let busy = false
  let error = ''
  let qrSvg = ''
  let copied = false

  const root = h('div', { class: 'lec-room-panel' })
  el.replaceChildren(root)

  function render () {
    if (destroyed) return
    const live = state.role === 'host'
    const head = h('div', { class: 'lec-room-panel__head' },
      h('span', { class: 'lec-room-panel__title' }, 'Live session'),
      live ? h('span', { class: `lec-room-panel__peers ${peers > 0 ? 'is-live' : ''}`, title: 'Devices connected peer to peer' },
        icon('users'), `${peers} ${peers === 1 ? 'device' : 'devices'}`) : null
    )
    if (!live) {
      setKids(root, head,
        h('p', { class: 'lec-muted', style: 'margin:0' }, 'Let coursemates follow the slides and notes on their own devices, directly from this laptop.'),
        h('div', { class: 'lec-room-panel__row' },
          h('button', { class: 'lec-btn lec-btn--primary', disabled: busy || state.role === 'peer', onclick: start }, icon('share'), busy ? 'Opening…' : 'Share live session')),
        state.role === 'peer' ? h('p', { class: 'lec-muted', style: 'margin:0' }, 'You joined someone else’s session.') : null,
        error ? h('p', { class: 'lec-err', style: 'margin:0' }, error) : null)
      return
    }
    const code = currentAdvert && currentAdvert.link === state.link ? currentAdvert.code : null
    const qr = h('div', { class: 'lec-room-panel__qr', title: 'Scan to join' })
    qr.innerHTML = qrSvg // generated locally by src/p2p (qrcode package), not user input
    setKids(root, head,
      code ? h('div', { class: 'lec-room-panel__code', title: 'Coursemates nearby can type this code in Join a live session' },
        h('span', { class: 'lec-room-panel__code-label' }, 'Join code'),
        h('span', { class: 'lec-room-panel__code-value' }, formatCode(code))) : null,
      h('div', { class: 'lec-room-panel__body' }, qr,
        h('div', { class: 'lec-room-panel__side' },
          h('span', { class: 'lec-muted' }, 'Join link'),
          h('div', { class: 'lec-room-panel__link lec-mono' }, state.link),
          h('div', { class: 'lec-room-panel__row' },
            h('button', { class: 'lec-btn', onclick: copy }, icon(copied ? 'check' : 'copy'), copied ? 'Copied' : 'Copy link'),
            h('button', { class: 'lec-btn lec-btn--quiet', onclick: stop, disabled: busy }, icon('stop'), 'Stop sharing')))),
      error ? h('p', { class: 'lec-err', style: 'margin:0' }, error) : null)
  }

  async function refreshQr () {
    try { qrSvg = state.link ? await lec.p2p('qr', state.link) : '' } catch { qrSvg = '' }
  }
  async function start () {
    busy = true; error = ''; render()
    try {
      state = await lec.p2p('createRoom', getRoomOptions() || {})
      peers = state.peers || 0
      await refreshQr()
      await advertise()
    } catch (err) { error = friendlyError(err) }
    busy = false; render()
  }
  // 6-digit join code (aryan's src/discovery). Optional: the panel works without it.
  async function advertise () {
    if (!hasDiscovery() || !state.link) return
    if (currentAdvert?.link === state.link) return
    try {
      const opts = getRoomOptions() || {}
      const r = await lec.discovery('advertise', { title: opts.title || 'Live lecture', link: state.link })
      if (r?.code) currentAdvert = { code: r.code, link: state.link }
    } catch (err) { console.warn('[room-panel] join code unavailable:', err?.message || err) }
  }
  async function stop () {
    busy = true; render()
    if (hasDiscovery()) { try { await lec.discovery('stopAdvertising') } catch {} }
    currentAdvert = null
    try { state = await lec.p2p('leaveRoom') } catch (err) { error = friendlyError(err) }
    busy = false; peers = 0; qrSvg = ''; render()
  }
  async function copy () {
    copied = await copyText(state.link)
    if (copied && toast) toast('Join link copied')
    render()
    setTimeout(() => { copied = false; render() }, 1500)
  }

  const offs = [
    lec.on('p2p:peers', (p) => { peers = p?.count ?? 0; render() }),
    lec.on('p2p:status', (s) => { if (s?.role === 'host' && s.state === 'error') { error = s.error || 'Sharing failed'; render() } }),
    lec.on('discovery:advertising', (a) => { currentAdvert = a?.code ? { code: a.code, link: a.link } : null; render() })
  ]

  // Restore state if a room is already open (e.g. the view was re-mounted).
  lec.p2p('info').then(async (info) => { state = info || { role: null }; peers = info?.peers || 0; if (state.role === 'host') { await refreshQr(); await advertise() } render() }).catch(() => render())
  render()

  return {
    destroy () { destroyed = true; offs.forEach((off) => off && off()); el.replaceChildren() }
  }
}
