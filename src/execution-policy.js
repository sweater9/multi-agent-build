const MAX_FILES = 120;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

function parsePackage(files) {
  const pkg = files.find((file) => file.path === 'package.json');
  if (!pkg) return null;
  try { return JSON.parse(pkg.content); } catch { throw new Error('Generated package.json is invalid JSON'); }
}

export function createExecutionPlan(files, { timeoutMs = 180000, memoryMb = 768 } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Project files are required');
  if (files.length > MAX_FILES) throw new Error('Project exceeds execution file limit');
  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(String(file.content || ''), 'utf8'), 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Project exceeds execution size limit');
  const pkg = parsePackage(files);
  if (!pkg) return { runtime: 'static', steps: [], limits: { timeout_ms: timeoutMs, memory_mb: memoryMb, network: 'off' } };
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const steps = [{ name: 'install', command: ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], network: 'registry-only', timeout_ms: timeoutMs }];
  if (scripts.check) steps.push({ name: 'check', command: ['npm', 'run', 'check'], network: 'off', timeout_ms: timeoutMs });
  if (scripts.test) steps.push({ name: 'test', command: ['npm', 'test'], network: 'off', timeout_ms: timeoutMs });
  if (scripts.build) steps.push({ name: 'build', command: ['npm', 'run', 'build'], network: 'off', timeout_ms: timeoutMs });
  return { runtime: 'node', steps, limits: { timeout_ms: timeoutMs, memory_mb: memoryMb, network: 'deny-by-default', max_output_bytes: 256000 } };
}

export function summarizeExecution(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const failed = steps.find((step) => step.status !== 'success');
  return { passed: Boolean(result?.passed) && !failed, failed_step: failed?.name || null, diagnostics: String(failed?.stderr || failed?.stdout || result?.error || '').slice(0, 12000), steps: steps.map(({ name, status, exit_code }) => ({ name, status, exit_code: exit_code ?? null })) };
}
