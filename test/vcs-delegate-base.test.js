// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

const assert = require('node:assert/strict');
const test = require('node:test');

const { VcsDelegateBase } = require('../lib/runtime');

/** @typedef {{ message: string, method: string }} CommitCall */

class ExampleVcsDelegates extends VcsDelegateBase {
  /** @param {{ prefix: string, calls: CommitCall[] }} deps */
  constructor(deps) {
    super(deps);
  }

  getCaps() {
    return {
      commits: true,
      branches: true,
      tags: false,
      staging: true,
      push_pull: false,
      fast_forward: true,
    };
  }

  async commit(params, context) {
    this.deps.calls.push({ message: params.message, method: context.method });
    return `${this.deps.prefix}:${params.message}`;
  }
}

class SharedBranchDelegates extends VcsDelegateBase {
  /** @param {{}} deps */
  constructor(deps) {
    super(deps);
  }

  getCurrentBranch(params) {
    return `branch:${params.session_id}`;
  }
}

class DerivedBranchDelegates extends SharedBranchDelegates {
  listBranches() {
    return [];
  }
}

test('VcsDelegateBase maps overridden camelCase methods to rpc delegates', async () => {
  const delegate = new ExampleVcsDelegates({ prefix: 'commit', calls: [] });
  const delegates = delegate.toDelegates();

  assert.deepEqual(Object.keys(delegates).sort(), ['vcs.commit', 'vcs.get_caps']);
  assert.equal(typeof delegates['vcs.get_caps'], 'function');
  assert.equal(typeof delegates['vcs.commit'], 'function');

  assert.deepEqual(await delegates['vcs.get_caps']({}, {}), {
    commits: true,
    branches: true,
    tags: false,
    staging: true,
    push_pull: false,
    fast_forward: true,
  });

  assert.equal(
    await delegates['vcs.commit'](
      {
        session_id: 'session-1',
        name: 'OpenVCS',
        email: 'team@example.com',
        message: 'ship it',
      },
      { host: {}, method: 'vcs.commit', requestId: 7 },
    ),
    'commit:ship it',
  );
  assert.deepEqual(delegate.deps.calls, [
    { message: 'ship it', method: 'vcs.commit' },
  ]);
});

test('VcsDelegateBase keeps inherited overrides when building delegates', async () => {
  const delegates = new DerivedBranchDelegates({}).toDelegates();

  assert.deepEqual(Object.keys(delegates).sort(), [
    'vcs.get_current_branch',
    'vcs.list_branches',
  ]);
  assert.equal(
    await delegates['vcs.get_current_branch'](
      { session_id: 'session-2' },
      { host: {}, method: 'vcs.get_current_branch', requestId: 8 },
    ),
    'branch:session-2',
  );
  assert.deepEqual(
    await delegates['vcs.list_branches'](
      { session_id: 'session-2' },
      { host: {}, method: 'vcs.list_branches', requestId: 9 },
    ),
    [],
  );
});

test('VcsDelegateBase returns a fresh delegate map on each call', async () => {
  const delegate = new ExampleVcsDelegates({ prefix: 'repeat', calls: [] });
  const firstDelegates = delegate.toDelegates();
  const secondDelegates = delegate.toDelegates();

  assert.notStrictEqual(firstDelegates, secondDelegates);
  assert.notStrictEqual(
    firstDelegates['vcs.commit'],
    secondDelegates['vcs.commit'],
  );
  assert.equal(
    await secondDelegates['vcs.commit'](
      {
        session_id: 'session-3',
        name: 'OpenVCS',
        email: 'team@example.com',
        message: 'again',
      },
      { host: {}, method: 'vcs.commit', requestId: 10 },
    ),
    'repeat:again',
  );
});

test('VcsDelegateBase throws when a base stub is called directly', () => {
  const delegate = new ExampleVcsDelegates({ prefix: 'x', calls: [] });
  assert.throws(
    // cloneRepo is a base stub (not overridden by ExampleVcsDelegates)
    () => delegate.cloneRepo({ url: 'x', dest: 'y' }, {}),
    /VCS delegate method 'cloneRepo' must be overridden/,
  );
});

test('VcsDelegateBase accepts an empty deps object without errors', () => {
  assert.doesNotThrow(() => new ExampleVcsDelegates({ prefix: '', calls: [] }));
  assert.doesNotThrow(() => new SharedBranchDelegates({}));
  const delegates = new SharedBranchDelegates({}).toDelegates();
  assert.deepEqual(Object.keys(delegates), ['vcs.get_current_branch']);
});
