import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerAgent, BuilderAgent } from '../src/agents.js';
import { Orchestrator } from '../src/orchestrator.js';
import { ToolGateway } from '../src/security.js';
import { createRepositoryHandlers, DEFAULT_TOOL_ALLOWLIST } from '../src/repository-tools.js';

function qaResult(approved, findings = []) {
  return {
    agent_id: 'qa_test',
    agent_role: 'QA & Security Auditor',
    status: approved ? 'success' : 'blocked',
    approved,
    findings
  };
}

test('orchestrator repairs once then completes', async () => {
  let qaCalls = 0;
  const builderAttempts = [];
  const builder = {
    async run({ attempt, previousQa }) {
      builderAttempts.push({ attempt, previousQa });
      return { artifacts: [{ type: 'code', name: `attempt-${attempt}` }], notes: [] };
    }
  };
  const qa = {
    async run() {
      qaCalls += 1;
      return qaCalls === 1
        ? qaResult(false, [{ severity: 'high', code: 'FIX_ME', message: 'repair required' }])
        : qaResult(true, []);
    }
  };

  const result = await new Orchestrator({
    planner: new PlannerAgent(), builder, qa, maxRepairAttempts: 2
  }).execute('Repair until QA passes');

  assert.equal(result.workflow_status, 'completed');
  assert.equal(result.repair_attempts, 1);
  assert.equal(builderAttempts.length, 2);
  assert.equal(builderAttempts[1].previousQa.findings[0].code, 'FIX_ME');
});

test('orchestrator blocks after bounded repair attempts', async () => {
  let builds = 0;
  const builder = { async run() { builds += 1; return { artifacts: [], notes: [] }; } };
  const qa = { async run() { return qaResult(false, [{ severity: 'high', code: 'STILL_BAD', message: 'blocked' }]); } };

  const result = await new Orchestrator({
    planner: new PlannerAgent(), builder, qa, maxRepairAttempts: 1
  }).execute('Do not loop forever');

  assert.equal(result.workflow_status, 'blocked');
  assert.equal(result.repair_attempts, 1);
  assert.equal(builds, 2);
});

test('repository gateway supports scoped branch creation and diff review', async () => {
  const calls = [];
  const client = {
    async readFile(input) { calls.push(['read', input]); return { content: 'ok' }; },
    async createBranch(input) { calls.push(['branch', input]); return { branch: input.branch }; },
    async compare(input) { calls.push(['compare', input]); return { files: [{ path: 'src/app.js' }] }; },
    async createFile(input) { calls.push(['create', input]); return { sha: '1' }; },
    async updateFile(input) { calls.push(['update', input]); return { sha: '2' }; }
  };
  const handlers = createRepositoryHandlers({
    client,
    allowedRepositories: ['owner/repo'],
    allowedBranches: ['feature/agent-build']
  });
  const gateway = new ToolGateway({ allowlist: DEFAULT_TOOL_ALLOWLIST, handlers });

  await gateway.invoke('builder', 'repo.create_branch', {
    repository: 'owner/repo', branch: 'feature/agent-build', base: 'main'
  });
  const diff = await gateway.invoke('qa', 'repo.compare', {
    repository: 'owner/repo', base: 'main', head: 'feature/agent-build'
  });

  assert.equal(diff.files[0].path, 'src/app.js');
  await assert.rejects(
    () => handlers['repo.create_file']({ repository: 'owner/repo', branch: 'main', path: 'x.js', content: 'x', message: 'bad' }),
    /not allowed|Direct writes/
  );
  await assert.rejects(
    () => handlers['repo.create_file']({ repository: 'owner/repo', branch: 'feature/agent-build', path: '../secret', content: 'x', message: 'bad' }),
    /Unsafe repository path/
  );
});
