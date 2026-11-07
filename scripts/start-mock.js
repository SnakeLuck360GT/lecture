// Kept for old instructions: same as `npm run start:mock` (node scripts/start.js --mock).
process.argv.splice(2, 0, '--mock')
await import('./start.js')
