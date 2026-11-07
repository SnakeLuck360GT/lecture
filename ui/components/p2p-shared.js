// Shared helpers for aaron's P2P / library UI components. Owner: aaron.
// Colours come from filip's design tokens (CSS variables) with fallbacks, so the components match the app.

/** Inject a component stylesheet once. */
export function injectStyle (id, css) {
  if (document.getElementById(id)) return
  const st = document.createElement('style')
  st.id = id
  st.textContent = css
  document.head.appendChild(st)
}

/** Tiny element builder: h('div', { class: 'x', onclick }, child, 'text') */
export function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

/** replaceChildren that skips null/false (so optional parts can be written inline). */
export function setKids (el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false))
}

/** Inline SVG icons (consistent 16px stroke set, no emoji). */
const ICONS = {
  share: '<path d="M8 2v8M5 5l3-3 3 3M3 9v4h10V9"/>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3h8"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  users: '<circle cx="6" cy="6" r="2.5"/><path d="M1.5 13c.5-2.5 2.3-3.5 4.5-3.5s4 1 4.5 3.5"/><path d="M11 3.8a2.3 2.3 0 010 4.4M12.5 9.8c1.2.5 1.8 1.6 2 3.2"/>',
  join: '<path d="M7 3H3v10h4M10 5l3 3-3 3M13 8H6"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
  hand: '<path d="M5 8V3.5a1 1 0 012 0V7M7 7V2.5a1 1 0 012 0V7M9 7V3.5a1 1 0 012 0V9c0 3-1.5 5-4 5S3.5 12.5 3 10.5L2.2 8a1 1 0 011.8-.8L5 9"/>',
  link: '<path d="M7 9a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.6.6M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.6-.6"/>'
}
export function icon (name, cls = '') {
  const span = document.createElement('span')
  span.className = `lec-icon ${cls}`.trim()
  span.setAttribute('aria-hidden', 'true')
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`
  return span
}

/** Copy text; returns true on success. */
export async function copyText (text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' })
    ta.value = text
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/** Friendly text for P2P / share errors coming back over IPC. */
export function friendlyError (err) {
  const msg = String(err?.message || err || '')
  if (/BAD_CODE/.test(msg)) return 'A join code is 6 digits, like 482 913.'
  if (/CODE_NOT_FOUND/.test(msg)) return 'No live session with that code. Check the code, and that you’re on the same Wi-Fi or hotspot.'
  if (/BAD_LINK/.test(msg)) return 'That link doesn’t look right. Paste the whole lecscribe:// link.'
  if (/SHARE_TIMEOUT/.test(msg)) return 'Couldn’t reach anyone sharing these notes. Ask your coursemate to keep LecScribe open, then try again.'
  if (/not loaded/i.test(msg)) return 'Sharing isn’t available right now. Restart LecScribe.'
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Something went wrong.'
}

/** Shared base styles: buttons/inputs with the lec- prefix. */
export const BASE_CSS = `
.lec-icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.lec-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff); color: var(--ink, #1f2328); font: inherit; font-size: 13px;
  cursor: pointer; white-space: nowrap; -webkit-app-region: no-drag; transition: border-color .12s, background .12s, color .12s; }
.lec-btn:hover:not(:disabled) { border-color: var(--muted, #6b6f76); }
.lec-btn:disabled { opacity: .5; cursor: default; }
.lec-btn:focus-visible, .lec-input:focus-visible { outline: 2px solid var(--accent, #2f6f5e); outline-offset: 1px; }
.lec-btn--primary { background: var(--accent, #2f6f5e); border-color: var(--accent, #2f6f5e); color: var(--accent-ink, #fff); }
.lec-btn--primary:hover:not(:disabled) { border-color: var(--accent, #2f6f5e); filter: brightness(1.06); }
.lec-btn--quiet { border-color: transparent; background: transparent; color: var(--muted, #6b6f76); }
.lec-btn--quiet:hover:not(:disabled) { color: var(--ink, #1f2328); border-color: transparent; }
.lec-input { min-width: 0; flex: 1; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff);
  color: var(--ink, #1f2328); font: inherit; font-size: 13px; -webkit-app-region: no-drag; }
.lec-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; word-break: break-all; }
.lec-err { color: var(--danger, #c2412d); font-size: 12px; }
.lec-muted { color: var(--muted, #6b6f76); font-size: 12px; }
`
