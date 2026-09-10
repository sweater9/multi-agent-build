import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class HashChainedAuditLog {
  constructor({ directory = '.multi-agent-runs/audit' } = {}) {
    this.directory = directory;
  }

  async append(event) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'audit.ndjson');
    let previousHash = '0'.repeat(64);
    try {
      const current = await fs.readFile(file, 'utf-8');
      const lines = current.trim().split('\n').filter(Boolean);
      if (lines.length) previousHash = JSON.parse(lines.at(-1)).hash;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const record = {
      timestamp: new Date().toISOString(),
      previous_hash: previousHash,
      event
    };
    const output = { ...record, hash: digest(JSON.stringify(record)) };
    await fs.appendFile(file, `${JSON.stringify(output)}\n`, { encoding: 'utf-8', mode: 0o600 });
    return output;
  }
}
