import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostRuntimeInstance, createHostStopProofSource } from '../lib/host-stop-evidence.mjs';
import { createHostReclaimEvidenceProvider } from '../lib/runner-reclaim-evidence.mjs';
import { executionResourceKey } from '../lib/runner-resources.mjs';
import { resultHash } from '../lib/task-result-context.mjs';

const NODE = 'node-b';
const SESSION = 'session-stop-1';
const EXECUTION = 'exec-stop-1';
const GENERATION = 1;
const KEY = executionResourceKey(EXECUTION, GENERATION);
const RESULT = { status: 'succeeded', summary: 'done' };
const RESULT_HASH = resultHash(RESULT);

test('the runtime instance id is a concrete per-process identity, not the node id', () => {
  const a = createHostRuntimeInstance({ now: () => 1_700_000_000_000, nonce: () => 'aaaa-bbbb' });
  const b = createHostRuntimeInstance({ now: () => 1_700_000_000_000, nonce: () => 'cccc-dddd' });
  assert.equal(a.id, '1700000000000:aaaa-bbbb');
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, NODE);
  assert.equal(a.startedAt, new Date(1_700_000_000_000).toISOString());
});

function source({ instance, confirm, live = [] } = {}) {
  return createHostStopProofSource({
    instance: instance ?? createHostRuntimeInstance(),
    confirmDescendantsStopped: confirm ?? (async () => true),
    listLiveAgents: () => live,
  });
}

test('a completed lifecycle plus a descendant confirmation yields the fixed attestation', async () => {
  const instance = createHostRuntimeInstance();
  const stop = source({ instance, confirm: async request => {
    assert.equal(request.executionId, EXECUTION);
    assert.equal(request.generation, GENERATION);
    assert.equal(request.key, KEY);
    assert.equal(request.resultHash, RESULT_HASH);
    assert.equal(request.hostInstanceId, instance.id);
    assert.equal(request.sessionId, SESSION);
    return true;
  } });
  stop.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
  stop.recordEnd({ executionId: EXECUTION });
  const proof = await stop.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  });
  assert.deepEqual(proof, {
    executionId: EXECUTION, generation: GENERATION, key: KEY, resultHash: RESULT_HASH,
    hostInstanceId: instance.id, stopped: true,
    source: `host:agent-lifecycle:${instance.id}`,
  });
});

test('refusals are fail closed for every missing lifecycle fact', async () => {
  const instance = createHostRuntimeInstance();
  const stop = source({ instance });
  // Never started on this host.
  await assert.rejects(stop.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'NOT_STARTED_ON_THIS_HOST' });

  stop.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
  // Wrong generation.
  await assert.rejects(stop.readStopProof({
    executionId: EXECUTION, generation: 2, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'STALE_EXECUTION' });
  // A different (e.g. restarted) host instance cannot be attested.
  await assert.rejects(stop.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: 'other-instance',
  }), { code: 'INSTANCE_MISMATCH' });
  // Session still live: the followup has not resolved.
  await assert.rejects(stop.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'SESSION_LIVE' });

  stop.recordEnd({ executionId: EXECUTION });
  // With the default confirmation backend the proof is now possible; a
  // backend that refuses or errors keeps the proof refused.
  await stop.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  });

  const throwing = source({ instance, confirm: async () => { throw new Error('no os backend'); } });
  throwing.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
  throwing.recordEnd({ executionId: EXECUTION });
  await assert.rejects(throwing.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'DESCENDANTS_UNPROVEN' });

  const refusing = source({ instance, confirm: async () => false });
  refusing.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
  refusing.recordEnd({ executionId: EXECUTION });
  await assert.rejects(refusing.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'DESCENDANTS_UNPROVEN' });
});

test('a source without a descendant-process backend refuses every proof', async () => {
  const instance = createHostRuntimeInstance();
  // Construction succeeds (the product wires this source unconditionally),
  // but no proof is ever possible: the refusal is at request time.
  const backendless = createHostStopProofSource({ instance });
  backendless.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
  backendless.recordEnd({ executionId: EXECUTION });
  await assert.rejects(backendless.readStopProof({
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, hostInstanceId: instance.id,
  }), { code: 'DESCENDANTS_UNPROVEN' });
  assert.throws(() => createHostStopProofSource({ instance: { id: 'bad id with spaces' } }), { code: 'BAD_CONFIG' });
  assert.throws(() => createHostStopProofSource({ instance, listLiveAgents: 'not-a-function' }), { code: 'BAD_CONFIG' });
});

// ------------------------------------------------- adapter composition -----

function baseEntry() {
  return {
    descriptor: {
      roomId: 'room-stop', taskId: 'task-stop', executionId: EXECUTION,
      generation: GENERATION, leaderKey: 'node-a/leader', actorKey: 'node-a/leader',
      workerKey: `${NODE}/${SESSION}`, title: 'Stop evidence', detail: '',
    },
    state: 'succeeded', started: true, seq: 2, result: structuredClone(RESULT),
    workspaceResource: {
      generation: GENERATION, repoId: 'repo-stop', baseCommit: 'a'.repeat(40),
      key: KEY, phase: 'prepared',
    },
  };
}

async function withLedger(label, fn) {
  const dir = await mkdtemp(join(tmpdir(), `host-stop-evidence-${label}-`));
  const ledgerFile = join(dir, 'team.json');
  await writeFile(ledgerFile, JSON.stringify({ version: 1, workerExecutions: { [EXECUTION]: baseEntry() } }));
  try { await fn({ ledgerFile }); } finally { await rm(dir, { recursive: true, force: true }); }
}

function request() {
  return {
    executionId: EXECUTION, generation: GENERATION, key: KEY,
    resultHash: RESULT_HASH, repoId: 'repo-stop', baseCommit: 'a'.repeat(40),
  };
}

test('the real source satisfies the reclaim adapter end-to-end once lifecycle and descendants hold', async () => {
  await withLedger('adapter-positive', async ({ ledgerFile }) => {
    const instance = createHostRuntimeInstance();
    const stop = source({ instance });
    stop.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
    stop.recordEnd({ executionId: EXECUTION });
    const provider = createHostReclaimEvidenceProvider({
      nodeId: NODE, ledgerFile, hostInstanceId: instance.id,
      readStopProof: stop.readStopProof,
    });
    const value = await provider(request());
    assert.equal(value.quiescence.stopped, true);
    assert.equal(value.quiescence.source, `host:agent-lifecycle:${instance.id}`);
    assert.equal(value.retention.retained, true);
    assert.equal(value.retention.resultHash, RESULT_HASH);
  });
});

test('an unfinished lifecycle keeps the reclaim adapter refused (fail closed)', async () => {
  await withLedger('adapter-incomplete', async ({ ledgerFile }) => {
    const instance = createHostRuntimeInstance();
    const stop = source({ instance });
    stop.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
    const provider = createHostReclaimEvidenceProvider({
      nodeId: NODE, ledgerFile, hostInstanceId: instance.id,
      readStopProof: stop.readStopProof,
    });
    await assert.rejects(provider(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
  });
});

test('a host process restart invalidates prior bindings (new instance id)', async () => {
  await withLedger('adapter-restart', async ({ ledgerFile }) => {
    const old = createHostRuntimeInstance();
    const restarted = createHostRuntimeInstance();
    const stop = source({ instance: restarted });
    // The old instance recorded start+end before dying; the new one has none.
    const legacy = source({ instance: old });
    legacy.recordStart({ executionId: EXECUTION, generation: GENERATION, sessionId: SESSION });
    legacy.recordEnd({ executionId: EXECUTION });
    const provider = createHostReclaimEvidenceProvider({
      nodeId: NODE, ledgerFile, hostInstanceId: restarted.id,
      readStopProof: stop.readStopProof,
    });
    await assert.rejects(provider(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
  });
});

test('records are per-process and never persisted: reopening cannot attest', async () => {
  await withLedger('adapter-memory-only', async ({ ledgerFile }) => {
    // No source is wired at all: the adapter refuses rather than falling back
    // to idle/absent/archived observations.
    const provider = createHostReclaimEvidenceProvider({
      nodeId: NODE, ledgerFile, hostInstanceId: createHostRuntimeInstance().id,
      readStopProof: async () => { throw new Error('no backend'); },
    });
    await assert.rejects(provider(request()), { code: 'QUIESCENCE_UNAVAILABLE' });
    // The durable ledger byte content is untouched by every refusal above.
    const raw = await readFile(ledgerFile, 'utf8');
    assert.equal(JSON.parse(raw).workerExecutions[EXECUTION].state, 'succeeded');
  });
});
