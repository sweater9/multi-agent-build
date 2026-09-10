import test from 'node:test';
import assert from 'node:assert/strict';
import { StaticProvider } from '../src/providers.js';
import { MemoryStateStore } from '../src/state-store.js';
import { createRepositoryHandlers } from '../src/repository-tools.js';
import { PlannerAgent, BuilderAgent, QaAgent } from '../src/agents.js';
import { Orchestrator } from '../src/orchestrator.js';

test('provider-backed agents complete with validated contracts', async () => {
  const provider = new StaticProvider({ responses: {
    planner: { agent_role: 'System Planner', status: 'success', goal: 'x', steps: ['plan'], acceptance_criteria: ['ok'], risks: [] },
    builder: { agent_role: 'Core Builder', status: 'success', artifacts: [{ type: 'file', name: 'x', content: {} }], notes: [] },
    qa: { agent_role: 'QA & Security Auditor', status: 'success', approved: true, findings: [], checks: {} }
  }});
  const store = new MemoryStateStore();
  const runtime = new Orchestrator({
    planner: new PlannerAgent({ provider }),
    builder: new BuilderAgent({ provider }),
    qa: new QaAgent({ provider }),
    stateStore: store
  });
  const result = await runtime.execute('x');
  assert.equal(result.workflow_status, 'completed');
  assert.equal((await store.load(result.workflow_run_id)).state, 'completed');
});

test('repository handlers reject unapproved repositories and traversal paths', async () => {
  const client = {
    async readFile(input) { return input; },
    async createFile(input) { return input; },
    async updateFile(input) { return input; }
  };
  const handlers = createRepositoryHandlers({
    client,
    allowedRepositories: ['sweater9/multi-agent-build'],
    allowedBranches: ['feature/agent-build']
  });

  await assert.rejects(
    () => handlers['repo.read_file']({ repository: 'other/repo', path: 'README.md' }),
    /not allowed/
  );
  await assert.rejects(
    () => handlers['repo.create_file']({ repository: 'sweater9/multi-agent-build', branch: 'feature/agent-build', path: '../secret', content: 'x', message: 'x' }),
    /Unsafe repository path/
  );
});
