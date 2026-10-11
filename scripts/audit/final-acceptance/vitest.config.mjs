import { fileURLToPath } from 'node:url'
// Dedicated probes preserve the security invariants from the original P1 findings.
// These probes also match the default Vitest `*.test.js` collection for CI.
export default {
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  envDir: false,
  test: {
    include: ['scripts/audit/final-acceptance/*.repro.test.js'],
    setupFiles: ['./tests/helpers/webStorage.js'],
    environment: 'happy-dom',
    maxWorkers: 1,
    fileParallelism: false,
  },
}
