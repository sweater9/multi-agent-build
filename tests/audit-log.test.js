import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HashChainedAuditLog } from '../src/audit-log.js';

test('audit records form a hash chain', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-agent-audit-'));
  const log = new HashChainedAuditLog({ directory });
  const first = await log.append({ type: 'one' });
  const second = await log.append({ type: 'two' });
  assert.equal(first.previous_hash, '0'.repeat(64));
  assert.equal(second.previous_hash, first.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  await fs.rm(directory, { recursive: true, force: true });
});
