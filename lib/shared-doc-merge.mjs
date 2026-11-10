/**
 * Deterministic line-level three-way merge for shared Markdown documents.
 *
 * Contract: docs/shared-doc-interfaces.md §5 (merge), §2 (limits), §7 (codes).
 *
 * Everything here is pure: no I/O, no clock, no randomness. The same three
 * inputs always produce a byte-identical result, `hunks` included. Conflict
 * markers are never emitted as a successful merge — a real disagreement is
 * always reported as `{ status: 'conflict', hunks }`.
 *
 * Content normalization follows §1 exactly: `\r\n` → `\n`, then surrounding
 * whitespace is dropped, and nothing inside is rewritten. That form is the
 * canonical one — `contentHash` is always taken over it — so two nodes that
 * received the same document through different editors agree on its hash and
 * therefore on §4 checkpoints. `lib/shared-doc-state.mjs` applies the identical
 * rule; if either copy changes, replicas compute two different hashes for one
 * document and honest peers get reported as `diverged`. A test pins the two
 * together.
 *
 * Line model: `splitLines` maps the normalized form to `content.split('\n')`,
 * with `''` meaning "no lines" rather than one empty line, and `lines.join('\n')`
 * as its exact inverse. Normalized content never starts or ends with a newline,
 * so the last line is never a phantom empty element and a diff cannot invent a
 * change that is not there.
 */
import { createHash } from 'node:crypto';
import { diffArrays } from 'diff';
import { TransportError } from './transport.mjs';

export const MAX_DOC_CONTENT_BYTES = 256 * 1024;
export const MAX_DOC_PATCH_BYTES = 128 * 1024;

const CONTENT_TOO_LARGE = 'DOC_CONTENT_TOO_LARGE';
const PATCH_TOO_LARGE = 'DOC_PATCH_TOO_LARGE';
const PATCH_MISMATCH = 'DOC_PATCH_MISMATCH';

/**
 * Normalize a document body exactly as §1 specifies.
 *
 * Order matters: the line endings are unified first, then the surrounding
 * whitespace is dropped. `.trim()` also removes the `\r` a lone CRLF at the edge
 * would leave, so doing it the other way round could still yield a stray `\r`.
 * @param {string} content - raw body.
 * @returns {string} canonical body: `\n`-separated, no surrounding whitespace.
 */
export function normalizeContent(content) {
  if (typeof content !== 'string') throw new TypeError('content must be a string');
  return content.replace(/\r\n/g, '\n').trim();
}

/** sha256 hex of the normalized UTF-8 bytes. */
export function hashContent(content) {
  return createHash('sha256').update(normalizeContent(content), 'utf8').digest('hex');
}

/** Canonical base→next patch as `CleanHunk[]`; JSON serializable. */
export function diffLines(base, next) {
  const hunks = hunksBetween(splitLines(base), splitLines(next));
  assertPatchBytes(hunks);
  return hunks;
}

/** `diffLines` spelled as "the patch that produces `content` from `base`". */
export function patchFromContent(base, content) {
  return diffLines(base, content);
}

/**
 * Apply a canonical patch to `base` and return the normalized result.
 * An impossible patch (wrong types, overlapping or out-of-order hunks, a hunk
 * outside the base) throws `DOC_PATCH_MISMATCH`.
 */
export function applyPatch(base, patch) {
  const baseLines = splitLines(base);
  const hunks = validatePatch(patch, baseLines.length);
  return applyHunks(baseLines, hunks).join('\n');
}

/**
 * Three-way merge of `current` and `proposed` against `base`.
 * @param {{base: string, current: string, proposed: string}} input
 * @returns {{status: 'clean', content: string, hunks: object[]}
 *   | {status: 'conflict', hunks: object[]}}
 */
export function mergeMarkdown({ base, current, proposed } = {}) {
  const normalizedBase = normalizeContent(base);
  const normalizedCurrent = normalizeContent(current);
  const normalizedProposed = normalizeContent(proposed);
  const baseLines = splitLines(normalizedBase);

  let merged;
  if (normalizedBase === normalizedCurrent) {
    merged = splitLines(normalizedProposed);
  } else if (normalizedBase === normalizedProposed) {
    merged = splitLines(normalizedCurrent);
  } else {
    const currentHunks = hunksBetween(baseLines, splitLines(normalizedCurrent));
    const proposedHunks = hunksBetween(baseLines, splitLines(normalizedProposed));
    const regions = mergeRegions(baseLines, currentHunks, proposedHunks);
    if (regions.conflicts.length) return { status: 'conflict', hunks: regions.conflicts };
    merged = regions.lines;
  }

  const content = merged.join('\n');
  assertContentBytes(content);
  // Deliberately not size-checked: a clean merge must stay re-appliable.
  return { status: 'clean', content, hunks: hunksBetween(baseLines, merged) };
}

// --- line model ----------------------------------------------------------

function splitLines(content) {
  const normalized = normalizeContent(content);
  return normalized === '' ? [] : normalized.split('\n');
}

// --- diff → canonical hunks ----------------------------------------------

/**
 * Consecutive added/removed runs collapse into one hunk, so an edit that
 * replaces three lines with two is a single `{baseStart, baseCount, lines}`.
 * Pure insertions get `baseCount: 0`; pure deletions have empty `lines`.
 */
function hunksBetween(baseLines, nextLines) {
  const hunks = [];
  let basePos = 0;
  let pending = null;
  const flush = () => {
    if (pending) {
      hunks.push(pending);
      pending = null;
    }
  };
  for (const part of diffArrays(baseLines, nextLines)) {
    if (part.added) {
      if (!pending) pending = { baseStart: basePos, baseCount: 0, lines: [] };
      pending.lines.push(...part.value);
    } else if (part.removed) {
      if (!pending) pending = { baseStart: basePos, baseCount: 0, lines: [] };
      pending.baseCount += part.value.length;
      basePos += part.value.length;
    } else {
      flush();
      basePos += part.value.length;
    }
  }
  flush();
  return hunks;
}

function applyHunks(baseLines, hunks) {
  const out = [];
  let pos = 0;
  for (const hunk of hunks) {
    for (let index = pos; index < hunk.baseStart; index += 1) out.push(baseLines[index]);
    out.push(...hunk.lines);
    pos = hunk.baseStart + hunk.baseCount;
  }
  for (let index = pos; index < baseLines.length; index += 1) out.push(baseLines[index]);
  return out;
}

function validatePatch(patch, baseLength) {
  if (!Array.isArray(patch)) throw mismatch('patch must be an array of hunks');
  let previousEnd = 0;
  return patch.map((hunk, index) => {
    if (!hunk || typeof hunk !== 'object' || Array.isArray(hunk)) throw mismatch(`hunk ${index} must be an object`);
    const { baseStart, baseCount, lines } = hunk;
    if (!Number.isSafeInteger(baseStart) || baseStart < 0) throw mismatch(`hunk ${index} has an invalid baseStart`);
    if (!Number.isSafeInteger(baseCount) || baseCount < 0) throw mismatch(`hunk ${index} has an invalid baseCount`);
    if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) throw mismatch(`hunk ${index} has invalid lines`);
    if (baseStart < previousEnd) throw mismatch(`hunk ${index} overlaps or is out of order`);
    if (baseStart + baseCount > baseLength) throw mismatch(`hunk ${index} lies past the end of the base`);
    previousEnd = baseStart + baseCount;
    return { baseStart, baseCount, lines: [...lines] };
  });
}

function mismatch(message) {
  return new TransportError(message, PATCH_MISMATCH);
}

function assertContentBytes(content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_DOC_CONTENT_BYTES) {
    throw new TransportError(`content exceeds ${MAX_DOC_CONTENT_BYTES} bytes`, CONTENT_TOO_LARGE, 413);
  }
}

function assertPatchBytes(hunks) {
  if (Buffer.byteLength(JSON.stringify(hunks), 'utf8') > MAX_DOC_PATCH_BYTES) {
    throw new TransportError(`patch exceeds ${MAX_DOC_PATCH_BYTES} bytes`, PATCH_TOO_LARGE, 413);
  }
}

// --- three-way reconciliation --------------------------------------------

/**
 * Two changes collide when their base intervals overlap. A pure insertion is a
 * zero-length interval: it collides with another insertion at the same offset
 * and with a rewrite it lands strictly inside. Insertions exactly on a rewrite
 * boundary do not collide — they are the line-drift case and are ordered
 * deterministically, insertions first at an equal `baseStart`.
 */
function touches(left, right) {
  const leftEnd = left.baseStart + left.baseCount;
  const rightEnd = right.baseStart + right.baseCount;
  if (left.baseCount === 0 && right.baseCount === 0) return left.baseStart === right.baseStart;
  if (left.baseCount === 0) return right.baseStart < left.baseStart && left.baseStart < rightEnd;
  if (right.baseCount === 0) return left.baseStart < right.baseStart && right.baseStart < leftEnd;
  return left.baseStart < rightEnd && right.baseStart < leftEnd;
}

/**
 * Cluster every hunk that touches a hunk from the other side, then resolve each
 * cluster once. A cluster reached by both sides is a conflict only when the two
 * sides disagree about the region's lines — identical edits merge cleanly.
 */
function mergeRegions(baseLines, currentHunks, proposedHunks) {
  const entries = [
    ...currentHunks.map((hunk) => ({ hunk, side: 'current' })),
    ...proposedHunks.map((hunk) => ({ hunk, side: 'proposed' })),
  ];
  const parent = entries.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parent[rightRoot] = leftRoot;
    else parent[leftRoot] = rightRoot;
  };

  currentHunks.forEach((currentHunk, currentIndex) => {
    proposedHunks.forEach((proposedHunk, proposedIndex) => {
      if (touches(currentHunk, proposedHunk)) union(currentIndex, currentHunks.length + proposedIndex);
    });
  });

  const clusters = new Map();
  entries.forEach((entry, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(entry);
  });

  const regions = [];
  for (const members of clusters.values()) {
    const currentMembers = members.filter((member) => member.side === 'current').map((member) => member.hunk);
    const proposedMembers = members.filter((member) => member.side === 'proposed').map((member) => member.hunk);
    const baseStart = Math.min(...members.map((member) => member.hunk.baseStart));
    const baseEnd = Math.max(...members.map((member) => member.hunk.baseStart + member.hunk.baseCount));
    regions.push({ baseStart, baseEnd, currentMembers, proposedMembers });
  }
  regions.sort((left, right) => left.baseStart - right.baseStart || left.baseEnd - right.baseEnd);

  const lines = [];
  const conflicts = [];
  let pos = 0;
  for (const region of regions) {
    for (let index = pos; index < region.baseStart; index += 1) lines.push(baseLines[index]);
    // Each cluster only ever sees its own hunks: clusters are disjoint, so
    // borrowing hunks from a neighbouring cluster would duplicate their lines.
    const currentView = regionView(baseLines, region.baseStart, region.baseEnd, region.currentMembers);
    const proposedView = regionView(baseLines, region.baseStart, region.baseEnd, region.proposedMembers);
    const bothSides = region.currentMembers.length > 0 && region.proposedMembers.length > 0;
    if (bothSides && !sameLines(currentView, proposedView)) {
      conflicts.push({
        baseStart: region.baseStart,
        baseCount: region.baseEnd - region.baseStart,
        currentLines: currentView,
        proposedLines: proposedView,
      });
    } else {
      lines.push(...(region.currentMembers.length ? currentView : proposedView));
    }
    pos = region.baseEnd;
  }
  for (let index = pos; index < baseLines.length; index += 1) lines.push(baseLines[index]);

  conflicts.sort((left, right) => left.baseStart - right.baseStart || left.baseCount - right.baseCount);
  return { lines, conflicts };
}

/** One side's version of base range [start, end), with its own hunks applied. */
function regionView(baseLines, start, end, hunks) {
  const relevant = hunks
    .filter((hunk) => hunk.baseStart <= end && hunk.baseStart + hunk.baseCount >= start)
    .sort((left, right) => left.baseStart - right.baseStart || left.baseCount - right.baseCount);
  const out = [];
  let pos = start;
  for (const hunk of relevant) {
    for (let index = pos; index < Math.max(pos, hunk.baseStart); index += 1) out.push(baseLines[index]);
    out.push(...hunk.lines);
    pos = Math.max(pos, hunk.baseStart + hunk.baseCount);
  }
  for (let index = pos; index < end; index += 1) out.push(baseLines[index]);
  return out;
}

function sameLines(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}
