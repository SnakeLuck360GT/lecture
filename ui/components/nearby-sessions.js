// "Nearby sessions": live LecScribe sessions on the same network (owner: aryan). Mounted by filip
// in the Library sidebar. See coord/contracts/discovery.md.
//
//   import { mountNearbySessions } from './components/nearby-sessions.js'
//   mountNearbySessions(document.getElementById('nearby-sessions'), {
//     lec: window.lec,
//     onJoin: (link, session) => joinRoom(link)   // existing join flow
//   })
//
// Talks only through window.lec: lec.discovery('listNearby') + lec.on('discovery:nearby').

const STYLE_ID = 'lec-nearby-style'
const CSS = `
.lec-nearby { font: inherit; color: var(--ink, #1f2328); }
.lec-nearby__head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 6px; font-size: 11px;
  letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #6b6f76); }
.lec-nearby__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.lec-nearby__item { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; width: 100%;
  padding: 7px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer; -webkit-app-region: no-drag; }
.lec-nearby__item:hover { background: var(--panel, #fff); border-color: var(--line, #e3dfd6); }
.lec-nearby__item:focus-visible { outline: 2px solid var(--accent, #2f6f5e); outline-offset: 1px; }
.lec-nearby__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger, #c2412d); animation: lec-nearby-pulse 1.6s ease-in-out infinite; }
.lec-nearby__text { min-width: 0; }
.lec-nearby__title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lec-nearby__host { font-size: 11.5px; color: var(--muted, #6b6f76); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lec-nearby__code { font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: .04em; color: var(--muted, #6b6f76); }
.lec-nearby__empty { font-size: 12px; line-height: 1.4; color: var(--muted, #6b6f76); padding: 2px 0 4px; }
@keyframes lec-nearby-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .lec-nearby__dot { animation: none } }
`

const fmt = (c) => (/^\d{6}$/.test(c) ? `${c.slice(0, 3)} ${c.slice(3)}` : String(c || ''))

/**
 * @param {HTMLElement} el
 * @param {{ lec: any, onJoin: (link: string, session: object) => void }} deps
 * @returns {{ destroy(): void }}
 */
export function mountNearbySessions (el, { lec = window.lec, onJoin } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style')
    st.id = STYLE_ID
    st.textContent = CSS
    document.head.appendChild(st)
  }
  el.classList.add('lec-nearby')
  el.innerHTML = `<div class="lec-nearby__head"><span>Nearby sessions</span></div>
    <ul class="lec-nearby__list" aria-live="polite"></ul>`
  const ul = el.querySelector('ul')
  let destroyed = false

  const render = (list) => {
    if (destroyed) return
    ul.innerHTML = ''
    if (!list || !list.length) {
      const li = document.createElement('li')
      li.className = 'lec-nearby__empty'
      li.textContent = 'No live sessions nearby. Ask the lecturer for the 6-digit code.'
      ul.appendChild(li)
      return
    }
    for (const s of list) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'lec-nearby__item'
      b.title = `Join "${s.title}" (code ${fmt(s.code)})`
      b.innerHTML = '<span class="lec-nearby__dot" aria-hidden="true"></span><span class="lec-nearby__text"><div class="lec-nearby__title"></div><div class="lec-nearby__host"></div></span><span class="lec-nearby__code"></span>'
      b.querySelector('.lec-nearby__title').textContent = s.title || 'Live lecture'
      b.querySelector('.lec-nearby__host').textContent = s.hostName ? `on ${s.hostName}` : 'live now'
      b.querySelector('.lec-nearby__code').textContent = fmt(s.code)
      b.addEventListener('click', () => onJoin?.(s.link, s))
      li.appendChild(b)
      ul.appendChild(li)
    }
  }

  render([])
  const off = lec?.on?.('discovery:nearby', (list) => render(list))
  Promise.resolve(lec?.discovery?.('listNearby')).then((list) => { if (Array.isArray(list)) render(list) }).catch(() => {})

  return {
    destroy () {
      destroyed = true
      try { typeof off === 'function' && off() } catch {}
      el.innerHTML = ''
      el.classList.remove('lec-nearby')
    }
  }
}
