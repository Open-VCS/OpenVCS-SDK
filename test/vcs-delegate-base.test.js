// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

const assert = require("node:assert/strict");
const test = require("node:test");

const { VcsDelegateBase } = require("../lib/runtime");

class ExampleVcsDelegates extends VcsDelegateBase {
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
  getCurrentBranch(params) {
    return `branch:${params.session_id}`;
  }
}

class DerivedBranchDelegates extends SharedBranchDelegates {
  listBranches() {
    return [];
  }
}

test("VcsDelegateBase maps overridden camelCase methods to rpc delegates", async () => {
  const delegate = new ExampleVcsDelegates({ prefix: "commit", calls: [] });
  const delegates = delegate.toDelegates();

  assert.deepEqual(Object.keys(delegates).sort(), ["vcs.commit", "vcs.get_caps"]);
  assert.equal(typeof delegates["vcs.get_caps"], "function");
  assert.equal(typeof delegates["vcs.commit"], "function");

  assert.deepEqual(await delegates["vcs.get_caps"]({}, {}), {
    commits: true,
    branches: true,
    tags: false,
    staging: true,
    push_pull: false,
    fast_forward: true,
  });

  assert.equal(
    await delegates["vcs.commit"](
      {
        session_id: "session-1",
        name: "OpenVCS",
        email: "team@example.com",
        message: "ship it",
      },
      { host: {}, method: "vcs.commit", requestId: 7 },
    ),
    "commit:ship it",
  );
  assert.deepEqual(delegate.deps.calls, [
    { message: "ship it", method: "vcs.commit" },
  ]);
});

test("VcsDelegateBase keeps inherited overrides when building delegates", async () => {
  const delegates = new DerivedBranchDelegates({}).toDelegates();

  assert.deepEqual(Object.keys(delegates).sort(), [
    "vcs.get_current_branch",
    "vcs.list_branches",
  ]);
  assert.equal(
    await delegates["vcs.get_current_branch"](
      { session_id: "session-2" },
      { host: {}, method: "vcs.get_current_branch", requestId: 8 },
    ),
    "branch:session-2",
  );
  assert.deepEqual(
    await delegates["vcs.list_branches"](
      { session_id: "session-2" },
      { host: {}, method: "vcs.list_branches", requestId: 9 },
    ),
    [],
  );
});
