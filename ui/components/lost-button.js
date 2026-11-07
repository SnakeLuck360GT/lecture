// "I'm lost" toggle for a PEER device (student following a live session). Owner: aaron. Mounted by filip.
//
//   import { mountLostButton } from './components/lost-button.js'
//   const lost = mountLostButton(el, { getSlideIndex: () => currentIndex })
//
// Pressed state is per slide: it follows slide:changed. Counts reach the lecturer anonymously (device counts, no
// names). Hidden unless this device has joined a session. Talks only to window.lec.
import { injectStyle, h, icon, friendlyError, BASE_CSS } from './p2p-shared.js'

const CSS = BASE_CSS + `
.lec-lost-button { display: inline-flex; align-items: center; gap: 8px; }
.lec-lost-button[hidden] { display: none; }
.lec-btn.lec-lost-button__btn[aria-pressed="true"], .lec-btn.lec-lost-button__btn[aria-pressed="true"]:hover:not(:disabled) { background: var(--danger, #c2412d); border-color: var(--danger, #c2412d); color: #fff; }
.lec-lost-button__hint { font-size: 12px; color: var(--muted, #6b6f76); }
`

export function mountLostButton (el, { getSlideIndex = () => 0 } = {}) {
  injectStyle('lec-lost-button-style', CSS)
  const lec = window.lec
  let destroyed = false
  let inRoom = false
  let lostState = {}
  let current = Number(getSlideIndex()) || 0
  let busy = false
  let error = ''

  const btn = h('button', { class: 'lec-btn lec-lost-button__btn', 'aria-pressed': 'false' })
  btn.addEventListener('click', toggle)
  const hint = h('span', { class: 'lec-lost-button__hint' })
  const root = h('div', { class: 'lec-lost-button' }, btn, hint)
  el.replaceChildren(root)

  function render () {
    if (destroyed) return
    root.hidden = !inRoom
    const pressed = !!lostState[current]
    btn.setAttribute('aria-pressed', String(pressed))
    btn.disabled = busy
    btn.title = pressed ? 'Tap again if it makes sense now' : 'Tell the lecturer this slide lost you (anonymous)'
    btn.replaceChildren(icon('hand'), pressed ? 'Lost on this slide' : 'I’m lost')
    hint.textContent = error || (pressed ? 'The lecturer sees a count, not your name.' : '')
    hint.className = error ? 'lec-err' : 'lec-lost-button__hint'
  }

  async function toggle () {
    busy = true; error = ''; render()
    try { lostState = await lec.p2p('lost', current, !lostState[current]) || {} } catch (err) { error = friendlyError(err) }
    busy = false; render()
  }

  const offs = [
    lec.on('slide:changed', (e) => { if (Number.isInteger(e?.index)) { current = e.index; render() } }),
    lec.on('lost:state', (s) => { lostState = s || {}; render() }),
    lec.on('p2p:status', (s) => { if (s?.role === 'peer') { inRoom = s.state !== 'error'; render() } }),
    lec.on('room:ended', () => { inRoom = false; render() })
  ]
  lec.p2p('info').then(async (info) => {
    inRoom = info?.role === 'peer'
    if (inRoom) lostState = await lec.p2p('lostState').catch(() => ({})) || {}
    render()
  }).catch(() => render())
  render()

  return {
    /** Optional: tell the button which slide is showing (if you don't use slide:changed). */
    setSlideIndex (i) { current = Number(i) || 0; render() },
    destroy () { destroyed = true; offs.forEach((off) => off && off()); el.replaceChildren() }
  }
}
