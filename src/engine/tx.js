// Transactional mutation recorder. Every state change made by AI ops goes through a Tx,
// which records {p: path, b: before, a: after}. Undo walks the patches backwards and only
// restores a path whose current value still equals what we wrote (conflict guard), so a
// manual edit the user made afterwards is never clobbered by a rollback.

import { deepClone, deepEqual, isPlainObject } from './util.js';

export function getPath(root, path) {
    let cur = root;
    for (const k of path) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[k];
    }
    return cur;
}

function ensureParent(root, path) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!isPlainObject(cur[k]) && !Array.isArray(cur[k])) cur[k] = {};
        cur = cur[k];
    }
    return cur;
}

export function setPath(root, path, value) {
    if (!path.length) throw new Error('empty path');
    const parent = ensureParent(root, path);
    const k = path[path.length - 1];
    if (value === undefined) delete parent[k];
    else parent[k] = value;
}

export class Tx {
    constructor(root) {
        this.root = root;
        this.patches = [];
    }
    get(path) {
        return getPath(this.root, path);
    }
    set(path, value) {
        const before = getPath(this.root, path);
        if (deepEqual(before, value)) return;
        this.patches.push({ p: [...path], b: deepClone(before), a: deepClone(value) });
        setPath(this.root, path, deepClone(value));
    }
    del(path) {
        this.set(path, undefined);
    }
    /** Convenience: numeric add with clamping. Returns applied delta. */
    add(path, delta, lo = -Infinity, hi = Infinity) {
        const before = Number(getPath(this.root, path)) || 0;
        const after = Math.min(hi, Math.max(lo, before + Number(delta || 0)));
        this.set(path, after);
        return after - before;
    }
}

/**
 * Undo recorded patches (newest first). Returns number of patches skipped due to conflicts.
 * @param {object} root
 * @param {{p:string[],b:any,a:any}[]} patches
 */
export function undoPatches(root, patches) {
    let conflicts = 0;
    for (let i = patches.length - 1; i >= 0; i--) {
        const { p, b, a } = patches[i];
        const cur = getPath(root, p);
        if (deepEqual(cur, a)) {
            setPath(root, p, deepClone(b));
        } else {
            conflicts++;
        }
    }
    return conflicts;
}
