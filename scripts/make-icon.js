// Renders build/icon.svg -> build/icon.png (1024 px) with Electron, then build/icon.icns + build/icon.ico
// with png2icons (pure JS). Run: npm run icon   (re-run after editing the SVG)
// Electron entry point: this file is launched as `electron scripts/make-icon.js`.
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { app, BrowserWindow } = require('electron')
const png2icons = require('png2icons')

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const B = (f) => join(ROOT, 'build', f)

app.whenReady().then(async () => {
  try {
    const svg = await readFile(B('icon.svg'), 'utf8')
    const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, backgroundColor: '#00000000', useContentSize: true, webPreferences: { offscreen: true } })
    // The SVG fills the viewport whatever the display scaling is; the capture is resized to 1024 below.
    const sized = svg.replace('<svg ', '<svg style="display:block;width:100vw;height:100vh" ')
    const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;width:100vw;height:100vh}</style></head><body>${sized}</body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 500))
    const img = await win.webContents.capturePage()
    const png = img.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG()
    await writeFile(B('icon.png'), png)
    await writeFile(B('icon.icns'), png2icons.createICNS(png, png2icons.BICUBIC2, 0))
    await writeFile(B('icon.ico'), png2icons.createICO(png, png2icons.BICUBIC2, 0, true, true))
    console.log('[icon] wrote build/icon.png, build/icon.icns, build/icon.ico')
    app.exit(0)
  } catch (e) {
    console.error('[icon] failed:', e)
    app.exit(1)
  }
})
