function assertAllowed(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} '${value}' is not allowed`);
}

function assertSafePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('path is required');
  if (filePath.startsWith('/') || filePath.includes('..') || filePath.includes('\\')) {
    throw new Error('Unsafe repository path');
  }
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

    async 'repo.create_file'({ repository, branch, path, content, message }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertAllowed(branch, allowedBranches, 'Branch');
      assertSafePath(path);
      if (typeof content !== 'string') throw new Error('content must be a string');
      if (!message) throw new Error('commit message is required');
      return client.createFile({ repository, branch, path, content, message });
    },

    async 'repo.update_file'({ repository, branch, path, content, message, sha }) {
      assertAllowed(repository, allowedRepositories, 'Repository');
      assertAllowed(branch, allowedBranches, 'Branch');
      assertSafePath(path);
      if (typeof content !== 'string') throw new Error('content must be a string');
      if (!message || !sha) throw new Error('commit message and sha are required');
      return client.updateFile({ repository, branch, path, content, message, sha });
    }
  };
}

export const DEFAULT_TOOL_ALLOWLIST = Object.freeze({
  planner: ['repo.read_file'],
  builder: ['repo.read_file', 'repo.create_file', 'repo.update_file'],
  qa: ['repo.read_file']
});
