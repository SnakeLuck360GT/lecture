// B-004: microphone picker + live input-level meter. Owner: aryan. Mounted by filip.
//
//   import { mountMicPicker } from './components/mic-picker.js'
//   const picker = mountMicPicker(document.getElementById('mic-picker'), {
//     onChange: (deviceId) => { if (listening) restartMic(deviceId) },  // '' = system default
//     toast: (msg) => toast(msg)                                        // optional
//   })
//   startMic(onChunk, { deviceId: picker.getDeviceId(), onLevel: picker.setLevel })
//
// - Lists inputs with listMics() (src/ai/browser/mic-capture.js); remembers the choice in localStorage.
// - Re-lists on navigator.mediaDevices 'devicechange' (the iPhone Continuity mic comes and goes).
// - If the chosen device disappears it falls back to the default, calls onChange('') and toasts.
// - Meter: shows setLevel(rms) while listening; when idle, the "Test" button opens a short
//   preview on the selected device so you can see the mic is hot before going live.
// Talks to nothing but the browser media APIs (+ window.lec.requestMic for the macOS prompt).
import { listMics } from '../../src/ai/browser/mic-capture.js'

const KEY = 'lecscribe.micDeviceId'
const STYLE_ID = 'lec-mic-picker-style'
const CSS = `
.lec-mic-picker { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; color: var(--ink, #1f2328); }
.lec-mic-picker__icon { width: 16px; height: 16px; flex: none; color: var(--muted, #6b6f76); }
.lec-mic-picker__select { appearance: none; -webkit-appearance: none; max-width: 220px; padding: 6px 26px 6px 10px; border-radius: 8px;
  border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b6f76' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 9px center;
  color: inherit; font: inherit; cursor: pointer; text-overflow: ellipsis; -webkit-app-region: no-drag; }
.lec-mic-picker__select:focus-visible { outline: 2px solid var(--accent, #2f6f5e); outline-offset: 1px; }
.lec-mic-picker__meter { position: relative; width: 56px; height: 6px; border-radius: 999px; background: var(--line, #e3dfd6); overflow: hidden; flex: none; }
.lec-mic-picker__bar { position: absolute; inset: 0 auto 0 0; width: 0%; border-radius: inherit; background: var(--accent, #2f6f5e); transition: width 80ms linear; }
.lec-mic-picker__bar.is-hot { background: var(--danger, #c2412d); }
.lec-mic-picker__test { padding: 5px 9px; border-radius: 8px; border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff); color: var(--muted, #6b6f76);
  font: inherit; font-size: 12px; cursor: pointer; -webkit-app-region: no-drag; }
.lec-mic-picker__test[aria-pressed="true"] { color: var(--accent, #2f6f5e); border-color: var(--accent, #2f6f5e); }
`

/**
 * @param {HTMLElement} el
 * @param {{ onChange?: (deviceId: string) => void, onLevel?: (rms: number) => void, toast?: (msg: string) => void }} [deps]
 * @returns {{ getDeviceId(): string, setLevel(rms: number): void, refresh(): Promise<void>, destroy(): void }}
 */
export function mountMicPicker (el, { onChange, onLevel, toast } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style')
    st.id = STYLE_ID
    st.textContent = CSS
    document.head.appendChild(st)
  }
  el.classList.add('lec-mic-picker')
  el.innerHTML = `
    <svg class="lec-mic-picker__icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 10.5A2.5 2.5 0 0 0 10.5 8V3.5a2.5 2.5 0 0 0-5 0V8A2.5 2.5 0 0 0 8 10.5Zm4-2.5a.6.6 0 0 1 1.2 0A5.2 5.2 0 0 1 8.6 13.2v1.2H10a.6.6 0 0 1 0 1.2H6a.6.6 0 0 1 0-1.2h1.4v-1.2A5.2 5.2 0 0 1 2.8 8 .6.6 0 0 1 4 8a4 4 0 0 0 8 0Z"/></svg>
    <select class="lec-mic-picker__select" aria-label="Microphone"></select>
    <span class="lec-mic-picker__meter" role="meter" aria-label="Input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="lec-mic-picker__bar"></span></span>
    <button type="button" class="lec-mic-picker__test" aria-pressed="false" title="Preview the input level">Test</button>`
  const select = el.querySelector('select')
  const meter = el.querySelector('.lec-mic-picker__meter')
  const bar = el.querySelector('.lec-mic-picker__bar')
  const testBtn = el.querySelector('.lec-mic-picker__test')

  let deviceId = load()
  let preview = null // { stop() }
  let lastExternal = 0
  let decayTimer = null
  let destroyed = false

  const show = (rms) => {
    // speech RMS is ~0.01-0.2; map with a log curve so quiet speech is still visible
    const pct = rms <= 0 ? 0 : Math.max(0, Math.min(100, ((Math.log10(rms) + 3) / 2.3) * 100))
    bar.style.width = pct.toFixed(0) + '%'
    bar.classList.toggle('is-hot', pct > 92)
    meter.setAttribute('aria-valuenow', pct.toFixed(0))
    clearTimeout(decayTimer)
    decayTimer = setTimeout(() => { bar.style.width = '0%'; meter.setAttribute('aria-valuenow', '0') }, 400)
  }

  async function refresh () {
    let mics = []
    try { mics = await listMics() } catch (e) { console.warn('[mic-picker] enumerateDevices failed', e) }
    if (destroyed) return
    const opts = [{ deviceId: '', label: 'System default' }, ...mics.filter((m) => m.deviceId && m.deviceId !== 'default')]
    select.innerHTML = ''
    for (const m of opts) {
      const o = document.createElement('option')
      o.value = m.deviceId
      o.textContent = m.label || 'Microphone'
      select.appendChild(o)
    }
    if (deviceId && !opts.some((m) => m.deviceId === deviceId)) {
      const was = deviceId
      deviceId = ''
      save('')
      // Only announce a vanished device if we had real labels (i.e. permission was granted).
      if (mics.some((m) => m.label)) {
        toast?.('Selected microphone disconnected. Using the system default.')
        onChange?.('')
      }
      void was
    }
    select.value = deviceId
    select.title = select.selectedOptions[0]?.textContent || ''
  }

  const onSelect = () => {
    deviceId = select.value
    save(deviceId)
    select.title = select.selectedOptions[0]?.textContent || ''
    onChange?.(deviceId)
    if (preview) { stopPreview(); startPreview() }
  }

  async function startPreview () {
    try {
      await window.lec?.requestMic?.()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      src.connect(an)
      const buf = new Float32Array(an.fftSize)
      let raf = 0
      const tick = () => {
        an.getFloatTimeDomainData(buf)
        let e = 0
        for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i]
        if (Date.now() - lastExternal > 500) show(Math.sqrt(e / buf.length))
        raf = requestAnimationFrame(tick)
      }
      tick()
      preview = {
        stop () {
          cancelAnimationFrame(raf)
          try { src.disconnect() } catch {}
          stream.getTracks().forEach((t) => t.stop())
          ctx.close().catch(() => {})
        }
      }
      testBtn.setAttribute('aria-pressed', 'true')
      testBtn.textContent = 'Stop'
      refresh() // labels become available once permission is granted
    } catch (e) {
      toast?.(`Microphone preview failed: ${e?.message || e}`)
      stopPreview()
    }
  }
  function stopPreview () {
    preview?.stop()
    preview = null
    testBtn.setAttribute('aria-pressed', 'false')
    testBtn.textContent = 'Test'
  }
  const onTest = () => (preview ? stopPreview() : startPreview())

  const onDeviceChange = () => refresh()
  select.addEventListener('change', onSelect)
  testBtn.addEventListener('click', onTest)
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
  refresh()

  return {
    getDeviceId: () => deviceId,
    /** Feed from startMic's onLevel while listening. Stops any idle preview (one capture at a time). */
    setLevel (rms) {
      lastExternal = Date.now()
      if (preview) stopPreview()
      show(rms)
      onLevel?.(rms)
    },
    refresh,
    destroy () {
      destroyed = true
      stopPreview()
      clearTimeout(decayTimer)
      select.removeEventListener('change', onSelect)
      testBtn.removeEventListener('click', onTest)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
      el.innerHTML = ''
      el.classList.remove('lec-mic-picker')
    }
  }
}

function load () { try { return localStorage.getItem(KEY) || '' } catch { return '' } }
function save (v) { try { localStorage.setItem(KEY, v) } catch {} }
