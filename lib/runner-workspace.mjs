import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Verify a workspace against a binding loaded from trusted local configuration. */
export async function verifyRunnerWorkspace({ binding, repoId, baseCommit, workspace }) {
  if (!binding || typeof repoId !== 'string' || !repoId || binding.repoId !== repoId) fail('REPO_MISMATCH');
  if (typeof baseCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseCommit)) fail('INVALID_BASE_COMMIT');
  if (typeof workspace !== 'string' || !isAbsolute(workspace) ||
      typeof binding.root !== 'string' || !isAbsolute(binding.root)) fail('WORKSPACE_UNAVAILABLE');

  // Repository and worktree discovery must use the checked local directories.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const rev = async (cwd, flag) => {
    const { stdout } = await exec('git', ['rev-parse', '--path-format=absolute', flag], {
      cwd, env, timeout: 10000, windowsHide: true,
    });
    return stdout.trim();
  };

  let ownRoot, candidate, ownTop, candidateTop, ownCommon, candidateCommon, head;
  try {
    [ownRoot, candidate] = await Promise.all([realpath(binding.root), realpath(workspace)]);
    [ownTop, candidateTop, ownCommon, candidateCommon, head] = await Promise.all([
      rev(ownRoot, '--show-toplevel').then(realpath),
      rev(candidate, '--show-toplevel').then(realpath),
      rev(ownRoot, '--git-common-dir').then(realpath),
      rev(candidate, '--git-common-dir').then(realpath),
      rev(candidate, 'HEAD'),
    ]);
  } catch {
    fail('WORKSPACE_UNAVAILABLE');
  }
  if (ownTop !== ownRoot || candidateTop !== candidate) fail('WORKSPACE_NOT_ROOT');
  if (ownCommon !== candidateCommon) fail('REPO_MISMATCH');
  if (ownRoot === candidate) fail('WORKTREE_REQUIRED');
  if (head !== baseCommit) fail('BASE_COMMIT_MISMATCH');
  return { repoId, baseCommit, workspace: candidate };
}
