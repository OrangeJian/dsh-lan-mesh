import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTeamStore } from '../lib/team-store.mjs';
import { emptyTeamState } from '../lib/team-state.mjs';

test('transactions serialize and survive reopening', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-team-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openTeamStore({ directory });
  await Promise.all(Array.from({ length: 12 }, (_, n) => store.transact(state => {
    state.nonces[n] = 1000;
    return { state, value: n };
  })));
  const reopened = await openTeamStore({ directory });
  assert.equal(Object.keys(reopened.read().nonces).length, 12);
  assert.deepEqual(reopened.read(), store.read());
  const copy = store.read();
  copy.version = 99;
  assert.equal(store.read().version, 1);
});

test('corrupt storage fails closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-team-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'team.json'), '{bad');
  await assert.rejects(openTeamStore({ directory }), { code: 'TEAM_STORAGE' });
  const state = emptyTeamState();
  state.workerExecutions = { broken: { state: 'runnin' } };
  await writeFile(join(directory, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory }), { code: 'TEAM_STORAGE' });
});

test('parseable corrupt worker ledger fails closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-team-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = emptyTeamState();
  state.workerExecutions = null;
  await writeFile(join(directory, 'team.json'), JSON.stringify(state));
  await assert.rejects(openTeamStore({ directory }), { code: 'TEAM_STORAGE' });
});

test('failed rename does not commit memory and queue remains usable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-team-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let fail = true;
  const fs = await import('node:fs/promises');
  const store = await openTeamStore({ directory, io: { ...fs, rename: async (...args) => {
    if (fail) throw new Error('disk failure');
    return fs.rename(...args);
  } } });
  await assert.rejects(store.transact(state => { state.nonces.a = 1; return { state }; }), /disk failure/);
  assert.equal(store.read().nonces.a, undefined);
  fail = false;
  await store.transact(state => { state.nonces.b = 2; return { state }; });
  assert.equal((await openTeamStore({ directory })).read().nonces.b, 2);
});
