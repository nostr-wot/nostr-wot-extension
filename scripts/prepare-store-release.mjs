import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Shared by both stores: only a published, tested commit already on main. */
export function prepareRelease(tag, run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()) {
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'Expected a stable release tag');
  const release = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'isDraft,isPrerelease,tagName']));
  assert.ok(release.isDraft === false && release.isPrerelease === false && release.tagName === tag, 'Release is not stable and published');
  const commit = run('git', ['rev-parse', `refs/tags/${tag}^{commit}`]);
  assert.match(commit, /^[a-f0-9]{40}$/);
  run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
  const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'tests.yml', '--commit', commit, '--event', 'push', '--limit', '30', '--json', 'conclusion,headSha']));
  assert.ok(runs.some(r => r.headSha === commit && r.conclusion === 'success'), 'Exact release commit has no successful push CI');
  run('git', ['checkout', '--detach', commit]);
  const version = run(process.execPath, ['-p', "require('./package.json').version"]);
  assert.equal(tag, `v${version}`, 'Tag/package version mismatch');
  return { commit, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { commit, version } = prepareRelease(process.env.RELEASE_TAG);
  appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${version}\nRELEASE_COMMIT=${commit}\n`);
}
