// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

const assert = require('node:assert/strict');
const test = require('node:test');

const { VcsDelegateBase } = require('../lib/runtime');

/**
 * Compile-time override safety lives in `vcs-delegate-base.types.ts`, which
 * verifies that generic parameters are explicit and incompatible signatures
 * (wrong return type or params) fail the TypeScript compiler.  This file
 * tests runtime behavior using the plain Node test runner.
 * @typedef {{ message: string, method: string }} CommitCall */

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

class BinaryAwareDelegates extends VcsDelegateBase {
  getStatusPayload() {
    return {
      files: [
        {
          path: 'img.png',
          old_path: null,
          status: 'M',
          staged: false,
          resolved_conflict: false,
          hunks: [],
          binary: true,
        },
      ],
      ahead: 0,
      behind: 0,
      branch_on_remote: false,
    };
  }

  diffFile() {
    return {
      lines: ['Binary files a/img.png and b/img.png differ'],
      binary: true,
    };
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

test('VcsDelegateBase preserves binary metadata in status and diff payloads', async () => {
  const delegates = new BinaryAwareDelegates({}).toDelegates();

  assert.deepEqual(
    await delegates['vcs.get_status_payload'](
      { session_id: 'session-4' },
      { host: {}, method: 'vcs.get_status_payload', requestId: 11 },
    ),
    {
      files: [
        {
          path: 'img.png',
          old_path: null,
          status: 'M',
          staged: false,
          resolved_conflict: false,
          hunks: [],
          binary: true,
        },
      ],
      ahead: 0,
      behind: 0,
      branch_on_remote: false,
    },
  );

  assert.deepEqual(
    await delegates['vcs.diff_file'](
      { session_id: 'session-4', path: 'img.png' },
      { host: {}, method: 'vcs.diff_file', requestId: 12 },
    ),
    {
      lines: ['Binary files a/img.png and b/img.png differ'],
      binary: true,
    },
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

test('VcsDelegateBase throws with the exact error message for base stubs', () => {
  const delegate = new ExampleVcsDelegates({ prefix: 'x', calls: [] });

  // Each base stub throws with a message that includes the method name.
  // Test a representative subset; all stubs share the same formatter.
  const expectedMessage = "VCS delegate method 'cloneRepo' must be overridden before registration";
  let thrown;
  try {
    delegate.cloneRepo({ url: 'x', dest: 'y' }, {});
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof Error, 'should throw an Error');
  assert.strictEqual(thrown.message, expectedMessage);

  // Verify a second stub throws with its own method name in the message.
  const expectedMessage2 = "VCS delegate method 'stashPush' must be overridden before registration";
  let thrown2;
  try {
    delegate.stashPush({ session_id: 's' }, {});
  } catch (e) {
    thrown2 = e;
  }
  assert.ok(thrown2 instanceof Error);
  assert.strictEqual(thrown2.message, expectedMessage2);
});

test('VcsDelegateBase accepts an empty deps object without errors', () => {
  assert.doesNotThrow(() => new ExampleVcsDelegates({ prefix: '', calls: [] }));
  assert.doesNotThrow(() => new SharedBranchDelegates({}));
  const delegates = new SharedBranchDelegates({}).toDelegates();
  assert.deepEqual(Object.keys(delegates), ['vcs.get_current_branch']);
});

test('VcsDelegateBase base implementation excludes all stubs from delegate map', () => {
  class EmptyDelegates extends VcsDelegateBase {}

  assert.deepEqual(new EmptyDelegates({}).toDelegates(), {});
});

test('all VcsDelegateBase stubs throw method-specific errors', () => {
  class EmptyDelegates extends VcsDelegateBase {}
  const delegate = new EmptyDelegates({});
  const stubNames = Object.getOwnPropertyNames(VcsDelegateBase.prototype)
    .filter((name) => !['constructor', 'toDelegates', 'assignDelegate', 'unimplemented'].includes(name));

  assert.ok(stubNames.length > 30);
  for (const name of stubNames) {
    assert.throws(
      () => delegate[name]({}, {}),
      new RegExp(`VCS delegate method '${name}' must be overridden before registration`),
    );
  }
});

test('VcsDelegateBase maps validateUrl and validatePath to rpc delegates', () => {
  class ValidationDelegates extends VcsDelegateBase {
    validateUrl(params) {
      return { ok: params.url.includes('.git') };
    }

    validatePath(params) {
      return { ok: params.path.endsWith('.git') };
    }
  }

  const delegates = new ValidationDelegates({}).toDelegates();
  assert.deepEqual(Object.keys(delegates).sort(), ['vcs.validate_path', 'vcs.validate_url']);

  const urlResult = delegates['vcs.validate_url']({ url: 'https://example.com/repo.git' }, {});
  assert.strictEqual(urlResult.ok, true);

  const urlResultFail = delegates['vcs.validate_url']({ url: 'https://example.com/repo' }, {});
  assert.strictEqual(urlResultFail.ok, false);

  const pathResult = delegates['vcs.validate_path']({ path: '/repo/.git' }, {});
  assert.strictEqual(pathResult.ok, true);

  const pathResultFail = delegates['vcs.validate_path']({ path: '/repo' }, {});
  assert.strictEqual(pathResultFail.ok, false);
});
