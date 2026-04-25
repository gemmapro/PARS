// @vitest-environment node

/**
 * archive.test.js — Birim testleri: generateArchiveName, generateManifest,
 * generateReadme, collectFiles, validateDist, runBuild
 */

import { vi } from 'vitest';

// child_process mock — hoisted so it applies before imports
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import {
  generateArchiveName,
  generateManifest,
  generateReadme,
  collectFiles,
  validateDist,
  runBuild,
} from './archive.js';

// ---------------------------------------------------------------------------
// generateArchiveName
// ---------------------------------------------------------------------------

describe('generateArchiveName', () => {
  it('known date produces exact expected string', () => {
    const date = new Date(2026, 3, 15, 14, 30, 22); // April 15 2026 14:30:22 local
    expect(generateArchiveName('2.0.0', date)).toBe(
      'parspel-build-2.0.0-20260415-143022.zip'
    );
  });

  it('single-digit month/day/hour/min/sec are zero-padded', () => {
    const date = new Date(2026, 0, 5, 9, 7, 3); // Jan 5 2026 09:07:03 local
    expect(generateArchiveName('1.0.0', date)).toBe(
      'parspel-build-1.0.0-20260105-090703.zip'
    );
  });

  it('result matches expected regex pattern', () => {
    const date = new Date(2026, 3, 15, 14, 30, 22);
    const result = generateArchiveName('2.0.0', date);
    expect(result).toMatch(/^parspel-build-.+-\d{8}-\d{6}\.zip$/);
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  const pkg = { name: 'parspel', version: '2.0.0' };
  const files = [
    { absolutePath: '/project/dist/index.html', archivePath: 'parspel-build/dist/index.html' },
    { absolutePath: '/project/package.json', archivePath: 'parspel-build/package.json' },
  ];
  const date = new Date('2026-04-15T14:30:22.000Z');

  it('returns a valid JSON string', () => {
    const result = generateManifest(pkg, files, date);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('parsed JSON has all required fields', () => {
    const result = JSON.parse(generateManifest(pkg, files, date));
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('buildDate');
    expect(result).toHaveProperty('nodeVersion');
    expect(result).toHaveProperty('includedFiles');
  });

  it('buildDate is ISO 8601 format', () => {
    const result = JSON.parse(generateManifest(pkg, files, date));
    expect(result.buildDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('includedFiles contains the archivePaths from the files array', () => {
    const result = JSON.parse(generateManifest(pkg, files, date));
    expect(result.includedFiles).toContain('parspel-build/dist/index.html');
    expect(result.includedFiles).toContain('parspel-build/package.json');
  });

  it('nodeVersion equals process.version', () => {
    const result = JSON.parse(generateManifest(pkg, files, date));
    expect(result.nodeVersion).toBe(process.version);
  });
});

// ---------------------------------------------------------------------------
// generateReadme
// ---------------------------------------------------------------------------

describe('generateReadme', () => {
  const version = '2.0.0';
  const date = new Date(2026, 3, 15, 14, 30, 22);

  it('contains build date string', () => {
    const result = generateReadme(version, date, false);
    // The readme uses toLocaleString('tr-TR') — just check it contains the year
    expect(result).toContain('2026');
  });

  it('contains version string', () => {
    const result = generateReadme(version, date, false);
    expect(result).toContain('2.0.0');
  });

  it('contains npm install --production', () => {
    const result = generateReadme(version, date, false);
    expect(result).toContain('npm install --production');
  });

  it('contains npx serve dist', () => {
    const result = generateReadme(version, date, false);
    expect(result).toContain('npx serve dist');
  });

  it('when envIncluded=true, contains .env warning text', () => {
    const result = generateReadme(version, date, true);
    expect(result).toContain('.env');
  });

  it('when envIncluded=false, does NOT contain .env warning text', () => {
    const result = generateReadme(version, date, false);
    expect(result).not.toContain('.env');
  });
});

// ---------------------------------------------------------------------------
// collectFiles
// ---------------------------------------------------------------------------

describe('collectFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
    // Create dist/index.html
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html></html>');
    // Create package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'parspel', version: '2.0.0' })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns entries with archivePath starting with parspel-build/', () => {
    const entries = collectFiles(tmpDir);
    for (const entry of entries) {
      expect(entry.archivePath).toMatch(/^parspel-build\//);
    }
  });

  it('package.json is always included', () => {
    const entries = collectFiles(tmpDir);
    const archivePaths = entries.map((e) => e.archivePath);
    expect(archivePaths).toContain('parspel-build/package.json');
  });

  it('package-lock.json included only when it exists', () => {
    // Without package-lock.json
    let entries = collectFiles(tmpDir);
    let archivePaths = entries.map((e) => e.archivePath);
    expect(archivePaths).not.toContain('parspel-build/package-lock.json');

    // With package-lock.json
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    entries = collectFiles(tmpDir);
    archivePaths = entries.map((e) => e.archivePath);
    expect(archivePaths).toContain('parspel-build/package-lock.json');
  });

  it('.env included only when it exists', () => {
    // Without .env
    let entries = collectFiles(tmpDir);
    let archivePaths = entries.map((e) => e.archivePath);
    expect(archivePaths).not.toContain('parspel-build/.env');

    // With .env
    fs.writeFileSync(path.join(tmpDir, '.env'), 'KEY=value');
    entries = collectFiles(tmpDir);
    archivePaths = entries.map((e) => e.archivePath);
    expect(archivePaths).toContain('parspel-build/.env');
  });
});

// ---------------------------------------------------------------------------
// validateDist — error scenarios (Task 5.2)
// ---------------------------------------------------------------------------

describe('validateDist', () => {
  let tmpDir;
  let exitSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-dist-test-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("when dist/ doesn't exist, process.exit(1) is called", () => {
    const nonExistent = path.join(tmpDir, 'dist');
    expect(() => validateDist(nonExistent)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('when dist/ exists but is empty, process.exit(1) is called', () => {
    const emptyDist = path.join(tmpDir, 'dist');
    fs.mkdirSync(emptyDist);
    expect(() => validateDist(emptyDist)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('when dist/ exists and has files, does NOT call process.exit', () => {
    const distPath = path.join(tmpDir, 'dist');
    fs.mkdirSync(distPath);
    fs.writeFileSync(path.join(distPath, 'index.html'), '<html></html>');
    expect(() => validateDist(distPath)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runBuild — error scenarios (Task 5.2)
// ---------------------------------------------------------------------------

describe('runBuild', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('when execSync throws, process.exit(1) is called', () => {
    execSync.mockImplementation(() => {
      throw new Error('Build failed');
    });
    expect(() => runBuild()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('when execSync succeeds, does NOT call process.exit', () => {
    execSync.mockImplementation(() => undefined);
    expect(() => runBuild()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
