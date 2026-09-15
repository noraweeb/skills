import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFindOptions, runFind, searchSkillsAPI } from './find.ts';

vi.mock('./detect-agent.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detect-agent.ts')>();
  return { ...actual, getAgentName: vi.fn(actual.getAgentName) };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseFindOptions', () => {
  it('separates and normalizes an owner from a multi-word query', () => {
    expect(parseFindOptions(['react', 'native', '--owner', 'Vercel'])).toEqual({
      query: 'react native',
      options: { owner: 'vercel' },
      errors: [],
    });
  });

  it('supports the --owner=value form', () => {
    expect(parseFindOptions(['--owner=vercel-labs', 'next'])).toEqual({
      query: 'next',
      options: { owner: 'vercel-labs' },
      errors: [],
    });
  });

  it('rejects missing and invalid owners', () => {
    expect(parseFindOptions(['react', '--owner']).errors).toEqual([
      '--owner requires a GitHub owner',
    ]);
    expect(parseFindOptions(['react', '--owner', 'not/an/owner']).errors).toEqual([
      '--owner must be a valid GitHub owner',
    ]);
  });
});

describe('searchSkillsAPI', () => {
  it('sends the owner as an API query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchSkillsAPI('react native', 'vercel');

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('react native');
    expect(url.searchParams.get('owner')).toBe('vercel');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('prints every result returned for a non-interactive query', async () => {
    const skills = Array.from({ length: 11 }, (_, index) => ({
      id: `owner/repo/skill-${index + 1}`,
      name: `skill-${index + 1}`,
      installs: 11 - index,
      source: 'owner/repo',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ skills }),
      })
    );
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runFind(['owner/repo']);

    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain('owner/repo@skill-1');
    expect(output).toContain('owner/repo@skill-11');
  });

  it('includes a <copilot-ref> tag per result when running inside GitHub Copilot', async () => {
    const { getAgentName } = await import('./detect-agent.ts');
    vi.mocked(getAgentName).mockResolvedValue('github-copilot');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            { id: 'owner/repo/skill-1', name: 'skill-1', installs: 5, source: 'owner/repo' },
          ],
        }),
      })
    );
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runFind(['owner/repo']);

    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain(
      '<copilot-ref kind="repo" target-id="https://github.com/owner/repo" label="owner/repo" />'
    );
  });

  it('omits the <copilot-ref> tag when not running inside GitHub Copilot', async () => {
    const { getAgentName } = await import('./detect-agent.ts');
    vi.mocked(getAgentName).mockResolvedValue(null);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            { id: 'owner/repo/skill-1', name: 'skill-1', installs: 5, source: 'owner/repo' },
          ],
        }),
      })
    );
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runFind(['owner/repo']);

    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).not.toContain('<copilot-ref');
  });
});
