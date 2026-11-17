import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let parseEnv: (src: string) => Record<string, string>;
let loadEnv: (filePath?: string) => Record<string, string>;

before(async () => {
  const envMod = await import('../dist/env.js');
  parseEnv = envMod.parseEnv;
  loadEnv = envMod.loadEnv;
});

describe('Dependency-free .env loader', () => {
  it('parses basic, commented, and empty lines', () => {
    const content = `
# Comment line
FOO=bar
  # Indented comment

BAZ=qux
export EXPORTED=value
`;
    const parsed = parseEnv(content);
    assert.deepEqual(parsed, {
      FOO: 'bar',
      BAZ: 'qux',
      EXPORTED: 'value'
    });
  });

  it('supports single and double quoted values with escapes', () => {
    const content = `
DOUBLE="hello \\"world\\"\\nnext"
SINGLE='simple single quoted # not a comment'
UNQUOTED=some_value # trailing comment
`;
    const parsed = parseEnv(content);
    assert.equal(parsed.DOUBLE, 'hello "world"\nnext');
    assert.equal(parsed.SINGLE, 'simple single quoted # not a comment');
    assert.equal(parsed.UNQUOTED, 'some_value');
  });

  it('never overrides variables already set in process.env', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
    const envFile = path.join(tmpDir, '.env');
    await fs.writeFile(
      envFile,
      'PRESET_KEY=from_file\nNEW_KEY=from_file_new\n'
    );

    const originalPreset = 'already_set_in_process_env';
    process.env.PRESET_KEY = originalPreset;
    delete process.env.NEW_KEY;

    try {
      const loaded = loadEnv(envFile);
      assert.equal(loaded.PRESET_KEY, 'from_file');
      assert.equal(loaded.NEW_KEY, 'from_file_new');

      assert.equal(process.env.PRESET_KEY, originalPreset, 'existing env var was overridden!');
      assert.equal(process.env.NEW_KEY, 'from_file_new', 'new env var was not set');
    } finally {
      delete process.env.PRESET_KEY;
      delete process.env.NEW_KEY;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('gracefully handles missing file without throwing', () => {
    const loaded = loadEnv('/tmp/nonexistent-env-file-' + Date.now());
    assert.deepEqual(loaded, {});
  });
});
