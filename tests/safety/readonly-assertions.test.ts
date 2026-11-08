import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        scanDirectory(fullPath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Safety Boundary Assertions: Strict Read-Only Verification', () => {
  const srcFiles = scanDirectory(path.resolve(__dirname, '../../src'));

  it('scans all TypeScript source files in src/', () => {
    assert.ok(srcFiles.length > 0, 'Source file list must not be empty');
  });

  it('asserts zero occurrences of writeFlash in production source code', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.strictEqual(
        /\.writeFlash\s*\(/.test(content),
        false,
        `Prohibited API writeFlash detected in ${file}`
      );
    }
  });

  it('asserts zero occurrences of eraseFlash in production source code', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.strictEqual(
        /\.eraseFlash\s*\(/.test(content),
        false,
        `Prohibited API eraseFlash detected in ${file}`
      );
    }
  });

  it('asserts zero occurrences of eraseRegion in production source code', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.strictEqual(
        /\.eraseRegion\s*\(/.test(content),
        false,
        `Prohibited API eraseRegion detected in ${file}`
      );
    }
  });

  it('asserts zero occurrences of destructive AVRDUDE write flags (:w: or -e)', () => {
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.strictEqual(/flash:w:/i.test(content), false, `Prohibited flash write flag in ${file}`);
      assert.strictEqual(/eeprom:w:/i.test(content), false, `Prohibited eeprom write flag in ${file}`);
      assert.strictEqual(/lock:w:/i.test(content), false, `Prohibited lock write flag in ${file}`);
      assert.strictEqual(/fuse:w:/i.test(content), false, `Prohibited fuse write flag in ${file}`);
    }
  });
});
