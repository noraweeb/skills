import { promises as fs } from 'fs';
import { dirname, extname, join, relative, resolve, sep } from 'path';

// Only scan text files for relative links — there's no reason to parse
// binary assets for reference paths, and it keeps this fast.
const SCANNABLE_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);

// Matches relative paths that walk upward at least once, e.g. `../../references/x.md`,
// whether inline, in backticks, or inside a markdown link `(../foo.md)`.
const RELATIVE_LINK_PATTERN = /(?:\.\.\/)+[^\s"'()<>`]+/g;

function isInside(base: string, target: string): boolean {
  const normalizedBase = resolve(base);
  const normalizedTarget = resolve(target);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(normalizedBase + sep);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans a skill's directory for relative links (e.g. `../../references/x.md`)
 * that point outside the skill's own directory but still inside the source
 * repository, copies the referenced files into the skill directory (so the
 * usual skill-copy step picks them up), and rewrites the links in place so
 * they keep resolving correctly once installed.
 *
 * Recurses into copied files in case they reference further files (bounded
 * by maxDepth). Never touches anything outside `repoRoot`.
 *
 * Returns the repo-relative paths of every file that was copied.
 */
export async function materializeExternalReferences(
  skillDir: string,
  repoRoot: string,
  maxDepth = 5
): Promise<string[]> {
  const copied: string[] = [];
  const visited = new Set<string>();
  const resolvedSkillDir = resolve(skillDir);
  const resolvedRepoRoot = resolve(repoRoot);

  // Nothing to do if the skill isn't actually inside the given repo root.
  if (!isInside(resolvedRepoRoot, resolvedSkillDir)) return copied;

  // `resolveDir` is the directory further relative links inside this file
  // should be resolved against. It's normally the file's own directory, but
  // for a file we just copied in from elsewhere in the repo, its *content*
  // still has links written relative to its *original* location, not its
  // new home inside the skill directory — so callers pass that original
  // directory through explicitly.
  async function processFile(filePath: string, depth: number, resolveDir?: string): Promise<void> {
    if (depth > maxDepth) return;
    const key = resolve(filePath);
    if (visited.has(key)) return;
    visited.add(key);

    if (!SCANNABLE_EXTENSIONS.has(extname(filePath).toLowerCase())) return;

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      return;
    }

    const matches = [...content.matchAll(RELATIVE_LINK_PATTERN)];
    if (matches.length === 0) return;

    // Directory to resolve link targets against (may differ from the file's
    // real, current directory — see the resolveDir doc comment above).
    const linkBaseDir = resolveDir ?? dirname(filePath);
    // Directory the file actually lives in right now, used to compute the
    // rewritten link so it is correct from the file's real location.
    const actualDir = dirname(filePath);
    let updated = content;

    for (const match of matches) {
      const linkText = match[0];
      const sourcePath = resolve(linkBaseDir, linkText);

      // Already inside the skill directory — the normal skill copy handles it.
      if (isInside(resolvedSkillDir, sourcePath)) continue;

      // Never read outside the source repo.
      if (!isInside(resolvedRepoRoot, sourcePath)) continue;

      if (!(await pathExists(sourcePath))) continue;

      const repoRelative = relative(resolvedRepoRoot, sourcePath);
      const destPath = join(resolvedSkillDir, repoRelative);

      if (!(await pathExists(destPath))) {
        await fs.mkdir(dirname(destPath), { recursive: true });
        await fs.copyFile(sourcePath, destPath);
        copied.push(repoRelative);
      }

      // Point the link at the copy that now lives inside the skill directory.
      const newLinkText = relative(actualDir, destPath).split(sep).join('/');
      if (newLinkText !== linkText) {
        updated = updated.split(linkText).join(newLinkText);
      }

      // The copy's content still refers to paths relative to where it used
      // to live, so keep resolving from there.
      await processFile(destPath, depth + 1, dirname(sourcePath));
    }

    if (updated !== content) {
      await fs.writeFile(filePath, updated, 'utf-8');
    }
  }

  async function walk(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        await processFile(fullPath, 0);
      }
    }
  }

  await walk(resolvedSkillDir);
  return copied;
}
