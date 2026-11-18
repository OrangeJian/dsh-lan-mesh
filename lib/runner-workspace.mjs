import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function gitRaw(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const { stdout } = await exec('git', args, { cwd, env, timeout: 10000, windowsHide: true });
  return stdout;
}

async function git(cwd, ...args) {
  return (await gitRaw(cwd, ...args)).trim();
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

/**
 * Read-only proof that a previously released workspace is really gone: the
 * workspace directory must no longer exist and Git must no longer register the
 * worktree. This never deletes or mutates anything; it only reports evidence.
 *
 * The expected child path is derived from the canonical resourcesRoot plus the
 * deterministic key, never by following a link at the resource directory: a
 * symlink/junction, a wrong entry type, or an identity/boundary mismatch would
 * redirect the check away from the originally registered path and hide a live
 * worktree, so each is retained conservatively. Git registration is compared
 * with -z parsing (no quote escaping, no trim) so whitespace paths cannot be
 * read as falsely absent.
 */
export async function verifyRunnerWorkspaceRemoved({binding,repoId,baseCommit,resourcesRoot,key,io = {}}) {
  verifyBinding(binding,repoId,baseCommit);
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) fail('WORKSPACE_UNAVAILABLE');
  if (typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key)) fail('WORKSPACE_UNAVAILABLE');
  // An injected filesystem is only ever used for read-only absence checks, so
  // recovery can distinguish a confirmed ENOENT from an unknown I/O fault.
  const resolve = io.realpath ?? realpath;
  const stat = io.lstat ?? lstat;
  const normalize = value => process.platform === 'win32' ? value.replace(/\\/g,'/').toLowerCase() : value;

  // The resources root is trusted configuration; canonicalize it once and
  // derive the only child directory this execution may own.
  let root;
  try {
    root = await resolve(resourcesRoot);
  } catch (error) {
    // A genuinely absent root is known evidence of removal; every other fault
    // is an unknown observation and must not be reported as success.
    if (error.code !== 'ENOENT') fail('WORKSPACE_UNAVAILABLE');
  }
  const expectedRoot = join(root ?? resourcesRoot, key);
  const workspace = join(expectedRoot, 'workspace');
  let resourceRootExists = false;

  if (root) {
    let entry;
    try {
      entry = await stat(expectedRoot);
    } catch (error) {
      if (error.code !== 'ENOENT') fail('WORKSPACE_UNAVAILABLE');
    }
    if (entry) {
      resourceRootExists = true;
      // A link here would send the rest of the check to a different directory
      // while Git still registers the original path. Never follow it.
      if (entry.isSymbolicLink() || !entry.isDirectory()) fail('PATH_ESCAPE');
      let observed;
      try {
        observed = await resolve(expectedRoot);
      } catch (error) {
        if (error.code !== 'ENOENT') fail('WORKSPACE_UNAVAILABLE');
      }
      if (observed) {
        // The resolved child must be exactly the owned child: no alias, no
        // escape outside the canonical root, no substitution of another key.
        if (normalize(observed) !== normalize(expectedRoot) || relative(root, observed) !== key) fail('PATH_ESCAPE');
        let workspaceEntry;
        try {
          workspaceEntry = await stat(join(observed, 'workspace'));
        } catch (error) {
          if (error.code !== 'ENOENT') fail('WORKSPACE_UNAVAILABLE');
        }
        if (workspaceEntry) {
          if (workspaceEntry.isSymbolicLink()) fail('PATH_ESCAPE');
          fail('WORKSPACE_STILL_PRESENT');
        }
      }
    }
  }

  const repoRoot = await resolve(binding.root);
  const list = await gitRaw(repoRoot, 'worktree', 'list', '--porcelain', '-z');
  const target = normalize(workspace);
  const stillRegistered = list.split('\0').some(record => {
    if (!record.startsWith('worktree ')) return false;
    return normalize(record.slice('worktree '.length)) === target;
  });
  if (stillRegistered) fail('WORKTREE_STILL_REGISTERED');
  return {repoId, baseCommit, resourceRoot: resourceRootExists ? expectedRoot : null, workspace, removed: true, resourceRootExists};
}
