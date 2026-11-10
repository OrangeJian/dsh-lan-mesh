import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const api = await import('../lib/shared-doc-merge.mjs').catch(() => ({}));

const merge = (base, current, proposed) => api.mergeMarkdown({ base, current, proposed });
const lines = (...values) => values.join('\n');

test('module exports the frozen merge surface', () => {
  for (const name of ['mergeMarkdown', 'normalizeContent', 'hashContent', 'diffLines', 'applyPatch', 'patchFromContent']) {
    assert.equal(typeof api[name], 'function', `${name} must be exported`);
  }
  assert.equal(api.MAX_DOC_CONTENT_BYTES, 256 * 1024);
  assert.equal(api.MAX_DOC_PATCH_BYTES, 128 * 1024);
});

test('normalization follows §1: CRLF unified, then surrounding whitespace dropped', () => {
  assert.equal(typeof api.normalizeContent, 'function');
  assert.equal(api.normalizeContent('a\r\nb\r\n'), 'a\nb');
  assert.equal(api.normalizeContent('  padded  \n'), 'padded');
  assert.equal(api.normalizeContent('\n\n  a\nb  \n\n'), 'a\nb');
  assert.equal(api.normalizeContent('a\rb'), 'a\rb', 'a lone CR is not a line ending §1 rewrites');
  assert.equal(api.normalizeContent('内部  空格 保留'), '内部  空格 保留');
  assert.equal(api.normalizeContent(''), '');
  assert.equal(api.normalizeContent('   '), '');
  assert.throws(() => api.normalizeContent(null), /string/i);
});

test('hashContent is the sha256 of normalized UTF-8 bytes', () => {
  assert.equal(typeof api.hashContent, 'function');
  assert.match(api.hashContent('hello'), /^[0-9a-f]{64}$/);
  assert.equal(api.hashContent('a\r\nb'), api.hashContent('a\nb'));
  assert.equal(api.hashContent('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  // Trim and line-ending normalization must both feed the hash, or the same
  // document typed in two editors would hash differently.
  assert.equal(api.hashContent('  a\r\nb  '), api.hashContent('a\nb'));
  assert.equal(api.hashContent('a\nb'), createHash('sha256').update('a\nb', 'utf8').digest('hex'));
  assert.notEqual(api.hashContent('a\nb'), api.hashContent('a\nB'));
});

test('hashContent agrees with the state layer normalization, byte for byte', () => {
  // `lib/shared-doc-state.mjs` normalizes bodies with
  // `content.replace(/\r\n/g, '\n').trim()`. The coordinator writes
  // `revision.resultHash` with `hashContent` while the state layer writes
  // `contentHash` with its own copy; if the two rules ever drift apart, one
  // document gets two hashes and §4 reports an honest peer as `diverged`,
  // halting sync on a document whose data is perfectly fine.
  const stateLayerNormalize = (content) => content.replace(/\r\n/g, '\n').trim();
  for (const sample of [
    'hello',
    '  hello  ',
    'a\r\nb',
    '\n\n  a\nb  \n\n',
    '内部  空格 🎉',
    '',
    '   ',
    'trailing newline\n',
    '\r\n\r\nleading blank lines',
  ]) {
    const expected = createHash('sha256').update(stateLayerNormalize(sample), 'utf8').digest('hex');
    assert.equal(api.hashContent(sample), expected, `hash mismatch for ${JSON.stringify(sample)}`);
  }
});

test('clean merge results are normalized the way §1 requires', () => {
  // The coordinator stores this string as the revision body, so it must already
  // be in the canonical form the hash is taken over: no surrounding whitespace.
  const padded = merge('  a\nb  ', '  a\nc  ', '  A\nb  ');
  assert.equal(padded.status, 'clean');
  assert.equal(padded.content, 'A\nc');
  assert.equal(padded.content, api.normalizeContent(padded.content));
  assert.equal(merge('a\r\nb', 'a\r\nb\r\nc\r\n', 'A\r\nb').content, 'A\nb\nc');
});

test('trivial sides short-circuit to the other side', () => {
  const base = lines('a', 'b', 'c');
  const changed = lines('a', 'B', 'c');
  assert.deepEqual(merge(base, base, changed), { status: 'clean', content: changed, hunks: api.diffLines(base, changed) });
  assert.deepEqual(merge(base, changed, base), { status: 'clean', content: changed, hunks: api.diffLines(base, changed) });
  assert.equal(merge(base, base, base).status, 'clean');
});

test('disjoint edits merge cleanly in base order', () => {
  const base = ['# Title', 'one', 'two', 'three', 'four', 'five'].join('\n');
  const current = ['# Title', 'ONE', 'two', 'three', 'four', 'five'].join('\n');
  const proposed = ['# Title', 'one', 'two', 'three', 'four', 'FIVE'].join('\n');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, ['# Title', 'ONE', 'two', 'three', 'four', 'FIVE'].join('\n'));
});

test('line drift from a head insertion does not disturb a tail edit', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const current = lines('X', 'Y', 'a', 'b', 'c', 'd', 'e');
  const proposed = lines('a', 'b', 'c', 'd', 'E');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, lines('X', 'Y', 'a', 'b', 'c', 'd', 'E'));
});

test('line drift from a head deletion does not disturb a tail edit', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const current = lines('c', 'd', 'e');
  const proposed = lines('a', 'b', 'c', 'd', 'E');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, lines('c', 'd', 'E'));
});

test('deleting a line another side edits is a conflict, not a silent drop', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const result = merge(base, lines('c', 'd', 'e'), lines('A', 'b', 'c', 'd', 'e'));
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.hunks, [{ baseStart: 0, baseCount: 2, currentLines: [], proposedLines: ['A', 'b'] }]);
});

test('changes to the same line on both sides conflict without markers', () => {
  const base = lines('a', 'b', 'c');
  const result = merge(base, lines('a', 'B1', 'c'), lines('a', 'B2', 'c'));
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.hunks, [{ baseStart: 1, baseCount: 1, currentLines: ['B1'], proposedLines: ['B2'] }]);
  assert.equal(result.content, undefined);
  assert.ok(!JSON.stringify(result).includes('<<<<<<<'));
});

test('overlapping line ranges conflict across the whole union', () => {
  const base = lines('a', 'b', 'c', 'd');
  const current = lines('a', 'B', 'C', 'd');
  const proposed = lines('a', 'b', 'X', 'd');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.hunks, [{ baseStart: 1, baseCount: 2, currentLines: ['B', 'C'], proposedLines: ['b', 'X'] }]);
});

test('identical edits on both sides merge cleanly once', () => {
  const base = lines('a', 'b', 'c');
  const same = lines('a', 'B', 'c');
  const result = merge(base, same, same);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, same);
});

test('insertions at the same offset conflict, at different offsets keep both', () => {
  const base = lines('a', 'b');
  assert.equal(merge(base, lines('a', 'X', 'b'), lines('a', 'Y', 'b')).status, 'conflict');
  const spread = merge(base, lines('a', 'X', 'b'), lines('a', 'b', 'Y'));
  assert.equal(spread.status, 'clean');
  assert.equal(spread.content, lines('a', 'X', 'b', 'Y'));
});

test('empty documents on either side behave as plain inserts and deletes', () => {
  assert.deepEqual(
    merge('', '', lines('hello', 'world')),
    { status: 'clean', content: lines('hello', 'world'), hunks: [{ baseStart: 0, baseCount: 0, lines: ['hello', 'world'] }] },
  );
  assert.equal(merge(lines('a', 'b'), '', '').content, '');
  assert.equal(merge('', lines('a'), lines('b')).status, 'conflict');
  assert.equal(merge('', '', '').content, '');
});

test('unicode and emoji lines merge without byte damage', () => {
  const base = lines('标题', '内容 🎉', '结尾');
  const current = lines('新标题', '内容 🎉', '结尾');
  const proposed = lines('标题', '内容 🎉', '结尾 ✅');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, lines('新标题', '内容 🎉', '结尾 ✅'));
});

test('missing trailing newline survives a clean merge', () => {
  const base = 'a\nb';
  const current = 'a\nb\nc';
  const proposed = 'A\nb';
  assert.equal(merge(base, current, proposed).content, 'A\nb\nc');
  assert.equal(api.applyPatch('a\nb', api.diffLines('a\nb', 'a\nb\nc')), 'a\nb\nc');
});

test('CRLF inputs are merged as LF', () => {
  const result = merge('a\r\nb\r\nc', 'a\r\nB\r\nc', 'a\r\nb\r\nC');
  assert.equal(result.status, 'clean');
  assert.equal(result.content, 'a\nB\nC');
});

test('merge is deterministic across repeated calls', () => {
  const base = lines('# Doc', 'alpha', 'beta', 'gamma', 'delta');
  const current = lines('# Doc!', 'alpha', 'BETA', 'gamma', 'delta');
  const proposed = lines('# Doc', 'alpha', 'beta', 'gamma', 'DELTA');
  const first = merge(base, current, proposed);
  const second = merge(base, current, proposed);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('conflict output is deterministic and equally ordered on both sides', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const current = lines('a', 'B', 'c', 'd', 'E');
  const proposed = lines('a', 'X', 'c', 'd', 'Y');
  const first = merge(base, current, proposed);
  assert.deepEqual(first, merge(base, current, proposed));
  assert.deepEqual(first.hunks.map((hunk) => hunk.baseStart), [1, 4]);
});

test('diffLines produces canonical JSON-safe hunks that apply back', () => {
  const base = lines('a', 'b', 'c', 'd');
  const next = lines('a', 'B', 'c', 'd', 'e');
  const patch = api.diffLines(base, next);
  assert.deepEqual(patch, [
    { baseStart: 1, baseCount: 1, lines: ['B'] },
    { baseStart: 4, baseCount: 0, lines: ['e'] },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), patch);
  assert.equal(api.applyPatch(base, patch), next);
  assert.equal(api.applyPatch(base, JSON.parse(JSON.stringify(patch))), next);
});

test('patchFromContent matches diffLines and round-trips through applyPatch', () => {
  for (const [base, next] of [
    ['', 'only'],
    ['x', ''],
    [lines('a', 'b', 'c'), lines('c', 'b', 'a')],
    [lines('1', '2', '3', '4'), lines('1', '3', '5', '4')],
  ]) {
    const patch = api.patchFromContent(base, next);
    assert.deepEqual(patch, api.diffLines(base, next));
    assert.deepEqual(JSON.parse(JSON.stringify(patch)), patch);
    assert.equal(api.applyPatch(base, patch), next);
  }
});

test('applyPatch rejects a patch that does not fit the base', () => {
  assert.equal(typeof api.applyPatch, 'function');
  for (const bad of [
    null,
    {},
    [{ baseStart: 0, baseCount: 5, lines: [] }],
    [{ baseStart: -1, baseCount: 0, lines: ['x'] }],
    [{ baseStart: 0, baseCount: 0, lines: 'x' }],
    [{ baseStart: 1, baseCount: 0, lines: ['x'] }, { baseStart: 0, baseCount: 0, lines: ['y'] }],
    [{ baseStart: 1.5, baseCount: 0, lines: ['x'] }],
  ]) {
    assert.throws(() => api.applyPatch(lines('a', 'b'), bad), (error) => {
      assert.equal(error.name, 'TransportError');
      assert.equal(error.code, 'DOC_PATCH_MISMATCH');
      return true;
    });
  }
});

test('oversized merged content throws DOC_CONTENT_TOO_LARGE', () => {
  const filler = 'x'.repeat(1024);
  const base = Array.from({ length: 20 }, () => filler);
  const current = [...base, ...Array.from({ length: 250 }, () => filler)];
  const proposed = ['head', ...base];
  assert.throws(() => api.mergeMarkdown({ base: base.join('\n'), current: current.join('\n'), proposed: proposed.join('\n') }), (error) => {
    assert.equal(error.name, 'TransportError');
    assert.equal(error.code, 'DOC_CONTENT_TOO_LARGE');
    assert.equal(error.status, 413);
    return true;
  });
});

test('oversized patch throws DOC_PATCH_TOO_LARGE', () => {
  const line = 'y'.repeat(1024);
  const base = '';
  const next = Array.from({ length: 200 }, () => line).join('\n');
  assert.throws(() => api.diffLines(base, next), (error) => {
    assert.equal(error.name, 'TransportError');
    assert.equal(error.code, 'DOC_PATCH_TOO_LARGE');
    return true;
  });
});

test('merged content is always re-derivable from the returned hunks', () => {
  const base = lines('a', 'b', 'c', 'd', 'e', 'f');
  const current = lines('a', 'b', 'C', 'd', 'e', 'f');
  const proposed = lines('a', 'b', 'c', 'd', 'e', 'F', 'g');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'clean');
  assert.equal(api.applyPatch(base, result.hunks), result.content);
  assert.equal(api.hashContent(result.content), api.hashContent(api.applyPatch(base, result.hunks)));
});

test('a whole-file replacement from one side wins over untouched other side', () => {
  const base = lines('a', 'b', 'c');
  const rewritten = lines('z', 'y', 'x');
  const result = merge(base, rewritten, base);
  assert.equal(result.status, 'clean');
  assert.equal(result.content, rewritten);
  assert.equal(merge(base, base, rewritten).content, rewritten);
});

test('deletion against an edit inside the deleted range conflicts', () => {
  const base = lines('a', 'b', 'c', 'd');
  const current = lines('a', 'd');
  const proposed = lines('a', 'b', 'C', 'd');
  const result = merge(base, current, proposed);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.hunks, [{ baseStart: 1, baseCount: 2, currentLines: [], proposedLines: ['b', 'C'] }]);
});
