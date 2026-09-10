function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function splitRepository(repository) {
  const [owner, repo, extra] = String(repository || '').split('/');
  if (!owner || !repo || extra) throw new Error('repository must be owner/name');
  return { owner, repo };
}

function boundedText(value, max = 4000) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

export class GitHubRestClient {
  constructor({ token, apiBase = 'https://api.github.com', fetchImpl = globalThis.fetch } = {}) {
    if (!token) throw new Error('GitHub token is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.token = token;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  async request(method, repository, path, body = null) {
    const { owner, repo } = splitRepository(repository);
    const response = await this.fetch(`${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
      method,
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: boundedText(text) }; }
    }
    if (!response.ok) {
      const message = data?.message || `GitHub request failed with ${response.status}`;
      throw new Error(boundedText(message, 1000));
    }
    return data;
  }

  async readFile({ repository, path, ref = 'main' }) {
    const data = await this.request('GET', repository, `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return {
      content: Buffer.from(data.content || '', data.encoding || 'base64').toString('utf-8'),
      sha: data.sha,
      path: data.path
    };
  }

  async createBranch({ repository, branch, base = 'main' }) {
    const baseRef = await this.request('GET', repository, `/git/ref/heads/${encodeURIComponent(base)}`);
    return this.request('POST', repository, '/git/refs', {
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha
    });
  }

  async createFile({ repository, branch, path, content, message }) {
    return this.request('PUT', repository, `/contents/${encodePath(path)}`, {
      branch,
      message,
      content: Buffer.from(content, 'utf-8').toString('base64')
    });
  }

  async updateFile({ repository, branch, path, content, message, sha }) {
    return this.request('PUT', repository, `/contents/${encodePath(path)}`, {
      branch,
      message,
      sha,
      content: Buffer.from(content, 'utf-8').toString('base64')
    });
  }

  async compare({ repository, base, head }) {
    const data = await this.request('GET', repository, `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return {
      files: Array.isArray(data.files) ? data.files.map((file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes })) : [],
      additions: Array.isArray(data.files) ? data.files.reduce((sum, file) => sum + (file.additions || 0), 0) : 0,
      deletions: Array.isArray(data.files) ? data.files.reduce((sum, file) => sum + (file.deletions || 0), 0) : 0,
      ahead_by: data.ahead_by ?? null
    };
  }

  async openPullRequest({ repository, base, head, title, body = '' }) {
    const data = await this.request('POST', repository, '/pulls', { base, head, title, body, draft: false });
    return { number: data.number, url: data.html_url, state: data.state, head: data.head?.ref, base: data.base?.ref };
  }

  async getCiStatus({ repository, ref }) {
    const runs = await this.request('GET', repository, `/actions/runs?branch=${encodeURIComponent(ref)}&per_page=20`);
    const relevant = Array.isArray(runs.workflow_runs) ? runs.workflow_runs : [];
    if (relevant.length === 0) return { status: 'unknown', checks: [] };
    const latestByWorkflow = new Map();
    for (const run of relevant) {
      const key = String(run.workflow_id || run.name || run.id);
      if (!latestByWorkflow.has(key)) latestByWorkflow.set(key, run);
    }
    const checks = [...latestByWorkflow.values()].map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url || null
    }));
    const pending = checks.some((check) => check.status !== 'completed');
    const failed = checks.some((check) => check.status === 'completed' && check.conclusion !== 'success');
    return {
      status: pending ? 'in_progress' : failed ? 'failure' : 'success',
      checks
    };
  }

  async ciDiagnostics({ repository, runId, maxJobs = 10 }) {
    if (!Number.isInteger(Number(runId))) throw new Error('runId must be an integer');
    const data = await this.request('GET', repository, `/actions/runs/${Number(runId)}/jobs?per_page=${Math.min(Math.max(maxJobs, 1), 20)}`);
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      failed_steps: Array.isArray(job.steps)
        ? job.steps.filter((step) => step.conclusion && step.conclusion !== 'success' && step.conclusion !== 'skipped').map((step) => ({ name: step.name, conclusion: step.conclusion }))
        : []
    }));
  }

  async ciStatus(args) {
    return this.getCiStatus(args);
  }
}
