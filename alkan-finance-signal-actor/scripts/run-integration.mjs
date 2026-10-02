// Cross-platform runner for the opt-in live Socrata integration test.
// Sets the gate env var in-process (so it works on Windows cmd, where the
// `VAR=val cmd` shell syntax is not supported) and runs the test file.
import { spawnSync } from 'node:child_process';

const env = { ...process.env, RUN_SOCRATA_INTEGRATION: '1' };
const result = spawnSync(process.execPath, ['--test', 'tests/integration.socrata.test.js'], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
