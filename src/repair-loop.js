function cleanFiles(value) {
  const src = Array.isArray(value) ? value : [], seen = new Set(), out = [];
  for (const item of src) {
    const path = String(item?.path || '').replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 240), content = String(item?.content || '');
    if (!path || path.includes('..') || seen.has(path) || Buffer.byteLength(content, 'utf8') > 200000) continue;
    seen.add(path); out.push({ path, content }); if (out.length >= 120) break;
  }
  return out;
}

export async function runBoundedRepair({ files, runner, repair, maxAttempts = 2, projectId = '' } = {}) {
  if (!runner?.run) throw new Error('runner is required');
  if (typeof repair !== 'function') throw new Error('repair function is required');
  const limit = Math.min(Math.max(Number(maxAttempts) || 0, 0), 3); let current = cleanFiles(files); const attempts = [];
  for (let attempt = 0; attempt <= limit; attempt += 1) {
    const execution = await runner.run(current, { projectId, attempt });
    attempts.push({ attempt, passed: execution.passed, summary: execution.summary, runtime: execution.runtime });
    if (execution.passed) return { passed: true, files: current, attempts, execution };
    if (attempt === limit) return { passed: false, files: current, attempts, execution };
    const response = await repair({ files: current, attempt: attempt + 1, diagnostics: execution.summary, instruction: 'Repair only the files needed to fix the observed execution failure. Return the complete replacement project as files. Do not remove working functionality or add secrets.' });
    const repaired = cleanFiles(response?.files);
    if (!repaired.length) return { passed: false, files: current, attempts, execution, repair_error: 'Repair agent returned no usable files' };
    current = repaired;
  }
  throw new Error('unreachable');
}
