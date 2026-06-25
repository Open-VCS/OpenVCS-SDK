// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RequestParams, VcsCapabilities, VcsValidationResult } from '../src/lib/types';

import {
  VcsDelegateBase,
  type PluginRuntimeContext,
} from '../src/lib/runtime';

type CommitCall = {
  message: string;
  method: string;
};

class TypedExampleVcsDelegates extends VcsDelegateBase<{
  prefix: string;
  calls: CommitCall[];
}> {
  override getCaps(
    _params: RequestParams,
    _context: PluginRuntimeContext,
  ): VcsCapabilities {
    return {
      commits: true,
      branches: true,
      tags: false,
      staging: true,
      push_pull: false,
      fast_forward: true,
    };
  }
}

new TypedExampleVcsDelegates({ prefix: 'commit', calls: [] }).toDelegates();

class InvalidVcsDelegates extends VcsDelegateBase<{}> {
  // @ts-expect-error `getCaps` must return `VcsCapabilities`.
  override getCaps(): string {
    return 'invalid';
  }
}

new InvalidVcsDelegates({});

class InvalidValidateOverride extends VcsDelegateBase<{}> {
  // @ts-expect-error `validateUrl` must return `VcsValidationResult`.
  override validateUrl(): string {
    return 'invalid';
  }
}

new InvalidValidateOverride({});
