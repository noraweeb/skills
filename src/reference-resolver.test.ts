import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { materializeExternalReferences } from './reference-resolver.ts';

describe('materializeExternalReferences', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'reference-resolver-test-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('copies a repo-root reference linked with a relative path and rewrites the link', async () => {
    const skillDir = join(repoRoot, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'See `../../references/checklist.md` for details.\n');
    mkdirSync(join(repoRoot, 'references'), { recursive: true });
    writeFileSync(join(repoRoot, 'references', 'checklist.md'), '# Checklist\n');

    const copied = await materializeExternalReferences(skillDir, repoRoot);

    expect(copied).toEqual([join('references', 'checklist.md')]);
    expect(existsSync(join(skillDir, 'references', 'checklist.md'))).toBe(true);
    expect(readFileSync(join(skillDir, 'references', 'checklist.md'), 'utf-8')).toBe(
      '# Checklist\n'
    );

    const rewritten = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    expect(rewritten).toBe('See `references/checklist.md` for details.\n');
  });

  it('leaves links that already point inside the skill directory untouched', async () => {
    const skillDir = join(repoRoot, 'skills', 'my-skill');
    mkdirSync(join(skillDir, 'assets'), { recursive: true });
    writeFileSync(join(skillDir, 'assets', 'logo.png'), 'fake-binary');
    writeFileSync(join(skillDir, 'SKILL.md'), 'See `./assets/logo.png` for the logo.\n');

    const copied = await materializeExternalReferences(skillDir, repoRoot);

    expect(copied).toEqual([]);
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toBe(
      'See `./assets/logo.png` for the logo.\n'
    );
  });

  it('ignores links that would escape the repo root', async () => {
    const skillDir = join(repoRoot, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'See `../../../../../../etc/passwd` please.\n');

    const copied = await materializeExternalReferences(skillDir, repoRoot);

    expect(copied).toEqual([]);
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toBe(
      'See `../../../../../../etc/passwd` please.\n'
    );
  });

  it('ignores links to files that do not exist', async () => {
    const skillDir = join(repoRoot, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'See `../../references/missing.md` please.\n');

    const copied = await materializeExternalReferences(skillDir, repoRoot);

    expect(copied).toEqual([]);
    expect(existsSync(join(skillDir, 'references'))).toBe(false);
  });

  it('recursively pulls in files referenced by a copied reference file', async () => {
    const skillDir = join(repoRoot, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'See `../../references/a.md`.\n');
    mkdirSync(join(repoRoot, 'references'), { recursive: true });
    mkdirSync(join(repoRoot, 'shared'), { recursive: true });
    writeFileSync(join(repoRoot, 'references', 'a.md'), 'Also see `../shared/b.md`.\n');
    writeFileSync(join(repoRoot, 'shared', 'b.md'), '# B\n');

    const copied = await materializeExternalReferences(skillDir, repoRoot);

    expect(copied.sort()).toEqual([join('references', 'a.md'), join('shared', 'b.md')].sort());
    // The link between the two copied files is still correct as-is because
    // their relative positions (references/ and shared/, both one level
    // under the skill dir) mirror their original positions in the repo.
    expect(readFileSync(join(skillDir, 'references', 'a.md'), 'utf-8')).toBe(
      'Also see `../shared/b.md`.\n'
    );
    expect(existsSync(join(skillDir, 'shared', 'b.md'))).toBe(true);
  });

  it('does nothing when the skill directory is outside the repo root', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-skill-'));
    try {
      writeFileSync(join(outsideDir, 'SKILL.md'), 'See `../../references/a.md`.\n');
      const copied = await materializeExternalReferences(outsideDir, repoRoot);
      expect(copied).toEqual([]);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
