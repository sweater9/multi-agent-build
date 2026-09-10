export const STATES = Object.freeze({
  RECEIVED: 'received',
  PLANNING: 'planning',
  BUILDING: 'building',
  QA_REVIEW: 'qa_review',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  FAILED: 'failed'
});

export function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('plan must be an object');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new TypeError('plan.steps must be a non-empty array');
  if (!Array.isArray(plan.acceptance_criteria) || plan.acceptance_criteria.length === 0) {
    throw new TypeError('plan.acceptance_criteria must be a non-empty array');
  }
  return plan;
}

export function validateBuild(build) {
  if (!build || typeof build !== 'object') throw new TypeError('build must be an object');
  if (!Array.isArray(build.artifacts)) throw new TypeError('build.artifacts must be an array');
  if (!Array.isArray(build.notes)) throw new TypeError('build.notes must be an array');
  return build;
}

export function validateQa(qa) {
  if (!qa || typeof qa !== 'object') throw new TypeError('qa must be an object');
  if (typeof qa.approved !== 'boolean') throw new TypeError('qa.approved must be boolean');
  if (!Array.isArray(qa.findings)) throw new TypeError('qa.findings must be an array');
  return qa;
}
