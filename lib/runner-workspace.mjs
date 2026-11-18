import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const { stdout } = await exec('git', args, { cwd, env, timeout: 10000, windowsHide: true });
  return stdout.trim();
}

function verifyBinding(binding, repoId, baseCommit) {
  if (!binding || typeof repoId !== 'string' || !repoId || binding.repoId !== repoId) fail('REPO_MISMATCH');
  if (typeof baseCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseCommit)) fail('INVALID_BASE_COMMIT');
  if (typeof binding.root !== 'string' || !isAbsolute(binding.root)) fail('WORKSPACE_UNAVAILABLE');
}

/** Prepare within a trusted, existing resource directory owned by this execution. */
export async function prepareRunnerWorkspace({ binding, repoId, baseCommit, resourceRoot }) {
  verifyBinding(binding, repoId, baseCommit);
  if (typeof resourceRoot !== 'string' || !isAbsolute(resourceRoot)) fail('WORKSPACE_UNAVAILABLE');
  const [root, resource] = await Promise.all([realpath(binding.root), realpath(resourceRoot)]);
  const top = await realpath(await git(root, 'rev-parse', '--path-format=absolute', '--show-toplevel'));
  if (top !== root) fail('WORKSPACE_NOT_ROOT');
  const offset = relative(root, resource);
  if (!offset || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith('..'+sep))) fail('WORKSPACE_INSIDE_SOURCE');
  const resolved = await git(root, 'rev-parse', '--verify', '--end-of-options', baseCommit+'^{commit}').catch(()=>null);
  if (resolved !== baseCommit) fail('BASE_COMMIT_MISMATCH');

  const workspace = join(resource, 'workspace');
  try {
    await mkdir(workspace);
  } catch (error) {
    if (error.code === 'EEXIST') fail('WORKSPACE_EXISTS');
    throw error;
  }
  // Keep an incomplete reservation for reconciliation if Git fails or loses its response.
  const hooks = await mkdtemp(join(resource, 'empty-hooks-'));
  await git(root, '-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '--detach', '--quiet', workspace, baseCommit);
  return verifyRunnerWorkspace({ binding, repoId, baseCommit, workspace });
}

/** Verify a workspace against a binding loaded from trusted local configuration. */
export async function verifyRunnerWorkspace({ binding, repoId, baseCommit, workspace }) {
  verifyBinding(binding, repoId, baseCommit);
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) fail('WORKSPACE_UNAVAILABLE');

  // Repository and worktree discovery must use the checked local directories.
  const rev = (cwd, flag) => git(cwd, 'rev-parse', '--path-format=absolute', flag);

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

/** Release only after the owner confirms quiescence and evidence collection. */
export async function releaseRunnerWorkspace({binding,repoId,baseCommit,resourceRoot,canRelease}) {
  verifyBinding(binding,repoId,baseCommit);
  if (typeof canRelease !== 'function') fail('RELEASE_NOT_AUTHORIZED');
  if (typeof resourceRoot !== 'string' || !isAbsolute(resourceRoot)) fail('WORKSPACE_UNAVAILABLE');
  const resource = await realpath(resourceRoot);
  const workspace = join(resource,'workspace');
  const entry = await lstat(workspace);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(workspace) !== workspace) fail('WORKSPACE_MISMATCH');
  const root = await realpath(binding.root);
  const offset = relative(root,workspace);
  if (!offset || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith('..'+sep))) fail('WORKSPACE_INSIDE_SOURCE');
  await verifyRunnerWorkspace({binding,repoId,baseCommit,workspace});
  if (await git(workspace,'rev-parse','--abbrev-ref','HEAD') !== 'HEAD') fail('WORKTREE_NOT_DETACHED');
  const changes = await git(workspace,'-c','core.fsmonitor=false','status','--porcelain=v1','--untracked-files=all','--ignored','--ignore-submodules=none');
  if (changes) fail('WORKSPACE_DIRTY');
  if (await canRelease() !== true) fail('RELEASE_NOT_AUTHORIZED');
  // Git performs its own cleanliness and ownership checks. Never use --force.
  await git(root,'worktree','remove','--',workspace);
  return {repoId,baseCommit,released:true};
}
