import { JsonFileStateStore } from './state-store.js';

function normalizeDirectory(value) {
  const directory = String(value || '').trim();
  return directory || '.multi-agent-runs';
}

export function createStateStoreFromEnvironment(env = process.env) {
  const backend = String(env.WORKFLOW_STATE_BACKEND || 'file').trim().toLowerCase();
  if (backend !== 'file') {
    throw new Error(`Unsupported WORKFLOW_STATE_BACKEND: ${backend}`);
  }

  const directory = normalizeDirectory(env.WORKFLOW_STATE_DIR);
  const requireDurable = String(env.REQUIRE_DURABLE_STATE || '').toLowerCase() === 'true';
  const durableMount = String(env.DURABLE_STATE_MOUNT || '').trim();

  if (requireDurable) {
    if (!durableMount) throw new Error('DURABLE_STATE_MOUNT is required when REQUIRE_DURABLE_STATE=true');
    if (!directory.startsWith(`${durableMount}/`) && directory !== durableMount) {
      throw new Error('WORKFLOW_STATE_DIR must be inside DURABLE_STATE_MOUNT');
    }
  }

  return {
    store: new JsonFileStateStore({ directory }),
    metadata: {
      backend,
      directory,
      durability_required: requireDurable,
      durable_mount: durableMount || null
    }
  };
}
