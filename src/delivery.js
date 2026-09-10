import { hasBlockingFinding } from './security.js';

const TERMINAL_SUCCESS = new Set(['success', 'passed', 'completed']);
const TERMINAL_FAILURE = new Set(['failure', 'failed', 'error', 'cancelled', 'timed_out', 'action_required']);
const NON_TERMINAL = new Set(['queued', 'pending', 'in_progress', 'requested', 'waiting']);

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeChecks(ci) {
  if (!ci) return [];
  if (Array.isArray(ci.checks)) return ci.checks;
  if (Array.isArray(ci.statuses)) return ci.statuses;
  return [];
}

export function evaluateCiStatus(ci) {
  const checks = normalizeChecks(ci);
  const overall = normalizeState(ci?.conclusion || ci?.status || ci?.state);

  if (TERMINAL_FAILURE.has(overall)) {
    return { ready: false, pending: false, findings: [{ severity: 'high', code: 'CI_FAILED', message: `CI reported ${overall}.` }] };
  }
  if (NON_TERMINAL.has(overall)) return { ready: false, pending: true, findings: [] };

  const failedChecks = checks.filter((check) => TERMINAL_FAILURE.has(normalizeState(check.conclusion || check.status || check.state)));
  if (failedChecks.length) {
    return {
      ready: false,
      pending: false,
      findings: failedChecks.map((check) => ({
        severity: 'high',
        code: 'CI_CHECK_FAILED',
        message: `${check.name || 'CI check'} failed with ${normalizeState(check.conclusion || check.status || check.state)}.`
      }))
    };
  }

  const pendingChecks = checks.filter((check) => NON_TERMINAL.has(normalizeState(check.conclusion || check.status || check.state)));
  if (pendingChecks.length) return { ready: false, pending: true, findings: [] };

  if (TERMINAL_SUCCESS.has(overall) || (checks.length > 0 && failedChecks.length === 0 && pendingChecks.length === 0)) {
    return { ready: true, pending: false, findings: [] };
  }

  return { ready: false, pending: false, findings: [{ severity: 'high', code: 'CI_STATUS_UNKNOWN', message: 'CI did not return a verifiable terminal success state.' }] };
}

export class DeliveryGate {
  constructor({ toolGateway, repositoryTarget, prTitle = 'Automated multi-agent build', prBody = '' } = {}) {
    if (!toolGateway) throw new Error('DeliveryGate requires a ToolGateway');
    if (!repositoryTarget?.repository || !repositoryTarget?.branch) throw new Error('DeliveryGate requires a repository target');
    this.toolGateway = toolGateway;
    this.repositoryTarget = repositoryTarget;
    this.prTitle = prTitle;
    this.prBody = prBody;
    this.pullRequest = null;
  }

  async ensurePullRequest(existingPullRequest = null) {
    if (existingPullRequest) {
      this.pullRequest = existingPullRequest;
      return existingPullRequest;
    }
    if (this.pullRequest) return this.pullRequest;
    this.pullRequest = await this.toolGateway.invoke('release', 'repo.open_pr', {
      repository: this.repositoryTarget.repository,
      base: this.repositoryTarget.base || 'main',
      head: this.repositoryTarget.branch,
      title: this.prTitle,
      body: this.prBody
    });
    return this.pullRequest;
  }

  async review({ qa, existingPullRequest = null }) {
    if (!qa?.approved || hasBlockingFinding(qa.findings)) {
      return { ready: false, pending: false, pull_request: null, findings: [{ severity: 'high', code: 'QA_NOT_APPROVED', message: 'QA must approve before delivery checks run.' }] };
    }

    const diff = await this.toolGateway.invoke('release', 'repo.compare', {
      repository: this.repositoryTarget.repository,
      base: this.repositoryTarget.base || 'main',
      head: this.repositoryTarget.branch
    });
    if (!diff || !Array.isArray(diff.files) || diff.files.length === 0) {
      return { ready: false, pending: false, pull_request: null, findings: [{ severity: 'high', code: 'NO_REVIEWABLE_DIFF', message: 'No reviewable repository diff exists.' }] };
    }

    const pullRequest = await this.ensurePullRequest(existingPullRequest);
    const ci = await this.toolGateway.invoke('release', 'repo.ci_status', {
      repository: this.repositoryTarget.repository,
      ref: this.repositoryTarget.branch
    });
    const evaluation = evaluateCiStatus(ci);

    return {
      ...evaluation,
      pull_request: pullRequest,
      ci_status: ci,
      diff_summary: {
        files_changed: diff.files.length,
        additions: diff.additions ?? null,
        deletions: diff.deletions ?? null
      }
    };
  }
}
