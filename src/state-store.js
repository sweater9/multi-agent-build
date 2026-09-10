import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonFileStateStore {
  constructor({ directory = '.multi-agent-runs' } = {}) {
    this.directory = directory;
  }

  async save(run) {
    if (!run?.workflow_run_id) throw new Error('workflow_run_id is required');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, `${run.workflow_run_id}.json`);
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(run, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(temp, target);
    return target;
  }

  async load(workflowRunId) {
    if (!/^[a-f0-9-]+$/i.test(String(workflowRunId))) throw new Error('Invalid workflow_run_id');
    const target = path.join(this.directory, `${workflowRunId}.json`);
    return JSON.parse(await fs.readFile(target, 'utf-8'));
  }
}

export class MemoryStateStore {
  constructor() { this.runs = new Map(); }
  async save(run) {
    this.runs.set(run.workflow_run_id, structuredClone(run));
    return run.workflow_run_id;
  }
  async load(workflowRunId) {
    const run = this.runs.get(workflowRunId);
    if (!run) throw new Error('Workflow run not found');
    return structuredClone(run);
  }
}
