// Mounting of teammates' components (owner: filip). Each component exports mountX(el, deps) -> { destroy() }.
// Imports are dynamic + guarded, so a missing or broken component never breaks the app. A few
// tiny fallbacks keep the demo path alive until aaron's components land (they are replaced
// automatically as soon as ui/components/<name>.js exists).
import { el, iconSvg, toast } from './dom.js'

/**
 * @param {string} name   file name in ui/components without .js (e.g. 'room-panel')
 * @param {HTMLElement} target
 * @param {object} deps
 * @param {(el: HTMLElement, deps: object) => { destroy(): void }} [fallback]
 */
export async function mountComponent (name, target, deps, fallback) {
  if (!target) return null
  target.replaceChildren()
  let mod = null
  try {
    mod = await import(`../components/${name}.js`)
  } catch (e) {
    if (!/Failed to fetch|not found|404|Cannot find/i.test(String(e?.message))) console.warn(`[ui] component ${name} failed to load:`, e)
  }
  const mount = mod && (Object.entries(mod).find(([k, v]) => /^mount/.test(k) && typeof v === 'function')?.[1] || (typeof mod.default === 'function' ? mod.default : null))
  try {
    if (mount) return normalise(await mount(target, deps))
  } catch (e) {
    console.error(`[ui] mounting ${name} threw:`, e)
    target.replaceChildren()
  }
  if (fallback) {
    try { return normalise(fallback(target, deps)) } catch (e) { console.error(`[ui] fallback for ${name} threw:`, e) }
  }
  return null
}

const normalise = (h) => ({ ...h, destroy: () => { try { h?.destroy?.() } catch {} } })

// ---------------- fallbacks (minimal; aaron's components replace them) ----------------

/** Sidebar: paste a room link -> joinRoom -> deps.onJoined({ key, title }). */
export function fallbackJoinRoom (target, { lec, onJoined }) {
  const form = el('form', 'fb-join')
  const input = el('input')
  input.type = 'text'
  input.placeholder = 'Paste a room link'
  input.autocomplete = 'off'
  const btn = el('button', 'btn small', 'Join')
  btn.type = 'submit'
  form.append(input, btn)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const link = input.value.trim()
    if (!link) return
    btn.disabled = true
    try {
      const r = await lec.p2p('joinRoom', link)
      input.value = ''
      onJoined?.({ key: r?.key || link, title: r?.title })
    } catch (err) {
      toast(`Could not join: ${err.message || err}`, { error: true })
    } finally { btn.disabled = false }
  })
  target.append(form)
  return { destroy () { form.remove() } }
}

/** Header: Share room -> createRoom -> link text + peer count. */
export function fallbackRoomPanel (target, { lec, getContext }) {
  const wrap = el('div', 'fb-room')
  const btn = el('button', 'btn')
  btn.type = 'button'
  btn.innerHTML = `${iconSvg('users')}<span>Share room</span>`
  const info = el('span', 'fb-room-info')
  info.hidden = true
  wrap.append(btn, info)
  let link = ''
  const offPeers = lec.on('p2p:peers', ({ count } = {}) => { if (link) info.textContent = `${count || 0} joined` })
  btn.addEventListener('click', async () => {
    if (link) {
      try { await navigator.clipboard.writeText(link); toast('Room link copied') } catch { toast(link, { ms: 8000 }) }
      return
    }
    btn.disabled = true
    try {
      const c = getContext()
      const r = await lec.p2p('createRoom', { title: c.lectureTitle, moduleId: c.moduleId, weekId: c.lectureId })
      link = r.link
      btn.querySelector('span').textContent = 'Copy room link'
      btn.title = link
      info.hidden = false
      info.textContent = `${r.peers || 0} joined`
      try { await navigator.clipboard.writeText(link); toast('Room open. Link copied to the clipboard.') } catch { toast(link, { ms: 8000 }) }
    } catch (err) {
      toast(`Could not open a room: ${err.message || err}`, { error: true })
    } finally { btn.disabled = false }
  })
  target.append(wrap)
  return { destroy () { offPeers?.(); wrap.remove() } }
}

/** Peer: "I'm lost" toggle for the current slide. */
export function fallbackLostButton (target, { lec, getContext }) {
  const state = {}
  const btn = el('button', 'btn lost-btn', "I'm lost on this slide")
  btn.type = 'button'
  const sync = () => {
    const on = !!state[getContext().slideIndex]
    btn.classList.toggle('on', on)
    btn.textContent = on ? 'Marked as lost (tap to undo)' : "I'm lost on this slide"
  }
  const off = lec.on('slide:changed', () => setTimeout(sync, 0))
  btn.addEventListener('click', async () => {
    const i = getContext().slideIndex
    state[i] = !state[i]
    sync()
    try { await lec.p2p('lost', i, state[i]) } catch (err) { toast(`Could not send: ${err.message || err}`, { error: true }) }
  })
  target.append(btn)
  return { destroy () { off?.(); btn.remove() } }
}
