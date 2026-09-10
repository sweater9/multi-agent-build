function assertAllowed(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} '${value}' is not allowed`);
}

function assertSafePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('path is required');
  if (filePath.startsWith('/') || filePath.includes('..') || filePath.includes('\\')) {
    throw new Error('Unsafe repository path');
  }
}

function assertFeatureBranch(branch, allowedBranches) {
  assertAllowed(branch, allowedBranches, 'Branch');
  if (branch === 'main' || branch === 'master') throw new Error('Direct writes to protected base branch are not allowed');
}

export function createRepositoryHandlers({
  client,
  allowedRepositories = [],
  allowedBranches = ['feature/agent-build']
} = {}) {
  if (!client) throw new Error('repository client is required');

  return {
    async 'repo.read_file'({ repository, path, ref = 'main' }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertSafePath(path);
      return client.readFile({ repository, path, ref });
    },

    async 'repo.create_branch'({ repository, branch, base = 'main' }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertFeatureBranch(branch, allowedBranches);
      return client.createBranch({ repository, branch, base });
    },

    async 'repo.compare'({ repository, base = 'main', head }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertFeatureBranch(head, allowedBranches);
      return client.compare({ repository, base, head });
    },

    async 'repo.create_file'({ repository, branch, path, content, message }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertFeatureBranch(branch, allowedBranches);
      assertSafePath(path);
      if (typeof content !== 'string') throw new Error('content must be a string');
      if (!message) throw new Error('commit message is required');
      return client.createFile({ repository, branch, path, content, message });
    },

    async 'repo.update_file'({ repository, branch, path, content, message, sha }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertFeatureBranch(branch, allowedBranches);
      assertSafePath(path);
      if (typeof content !== 'string') throw new Error('content must be a string');
      if (!message || !sha) throw new Error('commit message and sha are required');
      return client.updateFile({ repository, branch, path, content, message, sha });
    }
  };
}

export const DEFAULT_TOOL_ALLOWLIST = Object.freeze({
  planner: ['repo.read_file'],
  builder: ['repo.read_file', 'repo.create_branch', 'repo.create_file', 'repo.update_file', 'repo.compare'],
  qa: ['repo.read_file', 'repo.compare']
});
