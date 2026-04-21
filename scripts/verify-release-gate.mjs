import { spawnSync } from 'node:child_process'

const npmExecPath = process.env.npm_execpath
if (!npmExecPath) {
  process.stderr.write('[release-gate] missing npm_execpath. Run via `npm run verify:release-gate`.\n')
  process.exit(1)
}

const steps = [
  [process.execPath, [npmExecPath, 'run', 'typecheck']],
  [process.execPath, [npmExecPath, 'run', 'test:coverage']],
  [process.execPath, [npmExecPath, 'run', 'build']],
  ['python', ['engines/cam/smoke_ocl_toolpath.py']]
]

for (const [cmd, args] of steps) {
  const label = `${cmd} ${args.join(' ')}`
  process.stdout.write(`\n[release-gate] ${label}\n`)
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.stderr.write(`\n[release-gate] failed: ${label}\n`)
    process.exit(result.status ?? 1)
  }
}

process.stdout.write('\n[release-gate] all checks passed\n')
