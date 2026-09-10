import test from 'node:test';
import assert from 'node:assert/strict';
import { BuilderAgent, QaAgent } from '../src/agents.js';
import { ToolGateway } from '../src/security.js';
import { createRepositoryHandlers, DEFAULT_TOOL_ALLOWLIST } from '../src/repository-tools.js';

const plan = {
  steps: ['change code'],
  acceptance_criteria: ['diff is reviewable']
};

function runtime() {
  const calls = [];
  const client = {
    async readFile(input) { calls.push(['read', input]); return { content: 'old', sha: 'abc' }; },
    async createBranch(input) { calls.push(['branch', input]); return { branch: input.branch }; },
    async createFile(input) { calls.push(['create', input]); return { sha: 'new' }; },
    async updateFile(input) { calls.push(['update', input]); return { sha: 'updated' }; },
    async compare(input) {
      calls.push(['compare', input]);
      return { files: [{ path: 'src/new.js', additions: 1, deletions: 0, patch: '+export const ok = true;' }] };
    }
  };
  const handlers = createRepositoryHandlers({
    client,
    allowedRepositories: ['owner/repo'],
    allowedBranches: ['feature/agent-build']
  });
  return {
    calls,
    gateway: new ToolGateway({ allowlist: DEFAULT_TOOL_ALLOWLIST, handlers })
  };
}

test('builder executes only controlled repository actions on configured target', async () => {
  const { gateway, calls } = runtime();
  const provider = {
    async generate() {
      return {
        artifacts: [],
        notes: [],
        repository_actions: [
          { tool: 'repo.create_branch', input: { branch: 'evil', base: 'other' } },
          { tool: 'repo.create_file', input: { repository: 'evil/repo', branch: 'main', path: 'src/new.js', content: 'export const ok = true;', message: 'Add file' } }
        ]
      };
    }
  };
  const target = { repository: 'owner/repo', base: 'main', branch: 'feature/agent-build' };
  const builder = new BuilderAgent({ provider, toolGateway: gateway, repositoryTarget: target });
  const result = await builder.run({ goal: 'change repo', plan });

  assert.equal(result.artifacts.at(-1).type, 'repository_actions');
  assert.equal(calls[0][1].branch, 'feature/agent-build');
  assert.equal(calls[1][1].repository, 'owner/repo');
  assert.equal(calls[1][1].branch, 'feature/agent-build');
});

test('QA receives repository diff and can approve it through provider', async () => {
  const { gateway, calls } = runtime();
  let seenDiff = null;
  const provider = {
    async generate({ input }) {
      seenDiff = input.repository_diff;
      return { approved: true, status: 'success', findings: [] };
    }
  };
  const qa = new QaAgent({
    provider,
    toolGateway: gateway,
    repositoryTarget: { repository: 'owner/repo', base: 'main', branch: 'feature/agent-build' }
  });
  const result = await qa.run({ goal: 'review repo', plan, build: { artifacts: [{}], notes: [] } });

  assert.equal(result.approved, true);
  assert.equal(seenDiff.files[0].path, 'src/new.js');
  assert.equal(calls.at(-1)[0], 'compare');
});

test('default QA blocks configured repository workflow with no diff', async () => {
  const client = {
    async readFile() { return {}; },
    async createBranch() { return {}; },
    async createFile() { return {}; },
    async updateFile() { return {}; },
    async compare() { return { files: [] }; }
  };
  const handlers = createRepositoryHandlers({
    client,
    allowedRepositories: ['owner/repo'],
    allowedBranches: ['feature/agent-build']
  });
  const gateway = new ToolGateway({ allowlist: DEFAULT_TOOL_ALLOWLIST, handlers });
  const qa = new QaAgent({
    toolGateway: gateway,
    repositoryTarget: { repository: 'owner/repo', base: 'main', branch: 'feature/agent-build' }
  });
  const result = await qa.run({ goal: 'review repo', plan, build: { artifacts: [{}], notes: [] } });
  assert.equal(result.approved, false);
  assert.equal(result.findings[0].code, 'NO_REPOSITORY_DIFF');
});
