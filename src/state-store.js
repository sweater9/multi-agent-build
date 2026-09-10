import fs from 'node:fs/promises';
import path from 'node:path';

function targetFromRun(run) {
  return run?.delivery?.target || null;
}

export class JsonFileStateStore {
  constructor({ directory = '.multi-agent-runs' } = {}) {
    this.directory = directory;
    this.eventDirectory = path.join(directory, '.events');
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

  async findAwaitingByTarget({ repository, branch }) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const matches = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const run = JSON.parse(await fs.readFile(path.join(this.directory, entry.name), 'utf-8'));
        const target = targetFromRun(run);
        if (run.state === 'awaiting_ci' && target?.repository === repository && target?.branch === branch) {
          matches.push(run.workflow_run_id);
        }
      } catch {
        // Ignore unrelated/corrupt files here; load() remains strict for a selected run.
      }
    }
    return matches;
  }

  async claimEvent(deliveryId) {
    if (!/^[A-Za-z0-9._:-]+$/.test(String(deliveryId))) throw new Error('Invalid delivery id');
    await fs.mkdir(this.eventDirectory, { recursive: true, mode: 0o700 });
    const marker = path.join(this.eventDirectory, `${deliveryId}.claimed`);
    try {
      const handle = await fs.open(marker, 'wx', 0o600);
      await handle.writeFile(`${new Date().toISOString()}\n`, 'utf-8');
      await handle.close();
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
  }
}

export class MemoryStateStore {
  constructor() {
    this.runs = new Map();
    this.events = new Set();
  }

  async save(run) {
    this.runs.set(run.workflow_run_id, structuredClone(run));
    return run.workflow_run_id;
  }

  async load(workflowRunId) {
    const run = this.runs.get(workflowRunId);
    if (!run) throw new Error('Workflow run not found');
    return structuredClone(run);
  }

  async findAwaitingByTarget({ repository, branch }) {
    return [...this.runs.values()]
      .filter((run) => {
        const target = targetFromRun(run);
        return run.state === 'awaiting_ci' && target?.repository === repository && target?.branch === branch;
      })
      .map((run) => run.workflow_run_id);
  }

  async claimEvent(deliveryId) {
    if (this.events.has(deliveryId)) return false;
    this.events.add(deliveryId);
    return true;
  }
}
