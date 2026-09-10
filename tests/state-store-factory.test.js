import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateStoreFromEnvironment } from '../src/state-store-factory.js';

test('file state remains available for local development', () => {
  const result = createStateStoreFromEnvironment({ WORKFLOW_STATE_DIR: '.runs' });
  assert.equal(result.metadata.backend, 'file');
  assert.equal(result.metadata.directory, '.runs');
  assert.equal(result.metadata.durability_required, false);
});

test('durable mode requires an explicit mount', () => {
  assert.throws(
    () => createStateStoreFromEnvironment({ REQUIRE_DURABLE_STATE: 'true', WORKFLOW_STATE_DIR: '/var/data/runs' }),
    /DURABLE_STATE_MOUNT is required/
  );
});

test('durable mode requires state directory inside the mount', () => {
  assert.throws(
    () => createStateStoreFromEnvironment({
      REQUIRE_DURABLE_STATE: 'true',
      DURABLE_STATE_MOUNT: '/var/data',
      WORKFLOW_STATE_DIR: '/tmp/runs'
    }),
    /inside DURABLE_STATE_MOUNT/
  );
});

test('durable mode accepts a state directory inside the mount', () => {
  const result = createStateStoreFromEnvironment({
    REQUIRE_DURABLE_STATE: 'true',
    DURABLE_STATE_MOUNT: '/var/data',
    WORKFLOW_STATE_DIR: '/var/data/multi-agent-runs'
  });
  assert.equal(result.metadata.durability_required, true);
  assert.equal(result.metadata.durable_mount, '/var/data');
});

test('unknown state backend fails closed', () => {
  assert.throws(
    () => createStateStoreFromEnvironment({ WORKFLOW_STATE_BACKEND: 'redis' }),
    /Unsupported WORKFLOW_STATE_BACKEND/
  );
});
