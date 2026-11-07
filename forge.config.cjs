// Electron Forge config (owner: filip). Builds a real "LecScribe.app" for macOS (arm64, unsigned).
//   npm run package   -> out/LecScribe-darwin-arm64/LecScribe.app
//   npm run make      -> + .dmg / .zip in out/make/
// Uses @qvac/sdk's own Forge plugin (aryan, docs.qvac.tether.io "Build an Electron app"): it bundles the
// Bare worker into qvac/worker.entry.mjs, verifies + prunes addon prebuilds and forces asar: false.
// Models are NOT bundled: they stay in the user's QVAC cache (run `npm run ai:warm` once on the Mac).
const fs = require('fs')
const path = require('path')
const QvacForgePlugin = require('@qvac/sdk/electron-forge')

// The UI loads these at runtime (Demo deck, Shift+E explain, Play clip backup); everything else in
// fixtures/ is test data and stays out of the app.
const KEEP_FIXTURES = new Set(['/fixtures/deck.pdf', '/fixtures/explain.wav', '/fixtures/lecture.wav'])
const IGNORE = /^\/(tests|coord|out|models|\.git|\.claude|\.github|\.vscode)(\/|$)|^\/(CLAUDE(\.local)?\.md|\.env.*|forge\.config\.cjs)$/

function ignore (file) {
  if (!file) return false
  const p = file.replace(/\\/g, '/')
  if (p === '/fixtures') return false
  if (p.startsWith('/fixtures/')) return !KEEP_FIXTURES.has(p)
  return IGNORE.test(p)
}

const icon = path.join(__dirname, 'build', 'icon') // build/icon.icns (macOS); added once the human picks a design
const hasIcon = fs.existsSync(`${icon}.icns`)

module.exports = {
  packagerConfig: {
    name: 'LecScribe',
    executableName: 'LecScribe',
    appBundleId: 'uk.ac.manchester.lecscribe',
    appCategoryType: 'public.app-category.education',
    appCopyright: 'LecScribe team, University of Manchester',
    ...(hasIcon ? { icon } : {}),
    asar: false, // QVAC's Bare worker cannot load addons from inside app.asar (the plugin enforces this too)
    ignore,
    extendInfo: {
      NSMicrophoneUsageDescription: 'LecScribe listens to the lecture on this Mac to transcribe it and write notes. Audio never leaves the device.'
    }
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { name: 'LecScribe' } }
  ],
  plugins: [new QvacForgePlugin({ logLevel: 'info' })]
}
