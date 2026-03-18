// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type * as VcsTypes from '../types';

import type { PluginRuntimeContext } from './contracts';
import {
  type VcsDelegateAssignments,
  type VcsDelegateBindings,
  type VcsDelegateMethodName,
  type VcsDelegatePrototype,
  type VcsDelegateRpcMethodName,
  VCS_DELEGATE_METHOD_MAPPINGS,
} from './vcs-delegate-metadata';

/** Describes one synchronous or asynchronous VCS delegate return value. */
type VcsHandlerResult<TResult> = TResult | Promise<TResult>;

/** Builds exact `vcs.*` delegates from ordinary class methods. */
export abstract class VcsDelegateBase<
  TDeps,
  TContext = PluginRuntimeContext,
> {
  /** Stores the runtime services exposed to the delegate implementation. */
  protected readonly deps: TDeps;

  /** Creates one delegate base with the provided runtime dependencies. */
  constructor(deps: TDeps) {
    this.deps = deps;
  }

  /** Builds an SDK `vcs.*` delegate map from the subclass overrides. */
  toDelegates() {
    const delegates: VcsDelegateAssignments<TContext> = {};
    const delegatePrototype = Object.getPrototypeOf(this) as VcsDelegatePrototype<TContext> | null;
    const basePrototype = VcsDelegateBase.prototype as VcsDelegatePrototype<TContext>;

    for (const delegateMethod of Object.keys(
      VCS_DELEGATE_METHOD_MAPPINGS,
    ) as VcsDelegateMethodName[]) {
      const handler = delegatePrototype?.[delegateMethod];
      if (typeof handler !== 'function' || handler === basePrototype[delegateMethod]) {
        continue;
      }

      this.assignDelegate(delegates, delegateMethod, handler);
    }

    return delegates;
  }

  /** Assigns one typed class method to its exact `vcs.*` delegate name. */
  private assignDelegate<TMethodName extends VcsDelegateMethodName>(
    delegates: VcsDelegateAssignments<TContext>,
    delegateMethod: TMethodName,
    handler: VcsDelegateBindings<TContext>[TMethodName],
  ): void {
    const rpcMethod = VCS_DELEGATE_METHOD_MAPPINGS[
      delegateMethod
    ] as VcsDelegateRpcMethodName<TMethodName>;
    // `bind` loses the method-specific key correlation here; the cast is
    // safe because `assignDelegate` is only called with handlers that were
    // verified against `VcsDelegateBindings<TContext>` in the loop above.
    const boundHandler = handler.bind(this) as VcsDelegateAssignments<TContext>[typeof rpcMethod];

    delegates[rpcMethod] = boundHandler;
  }

  /**
   * Throws when a subclass does not implement one required delegate method.
   *
   * The `never` return type is intentional: base stubs should never contribute
   * a usable value, and subclasses should override the method with the exact
   * signature inherited from `VcsDelegateBase`.
   */
  protected unimplemented(methodName: VcsDelegateMethodName): never {
    throw new Error(
      `VCS delegate method '${methodName}' must be overridden before registration`,
    );
  }

  /** Handles `vcs.get_caps`. */
  getCaps(
    _params: VcsTypes.RequestParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsCapabilities> {
    return this.unimplemented('getCaps');
  }

  /** Handles `vcs.open`. */
  open(
    _params: VcsTypes.VcsOpenParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsSessionResult> {
    return this.unimplemented('open');
  }

  /** Handles `vcs.close`. */
  close(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('close');
  }

  /** Handles `vcs.clone_repo`. */
  cloneRepo(
    _params: VcsTypes.VcsCloneRepoParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('cloneRepo');
  }

  /** Handles `vcs.get_workdir`. */
  getWorkdir(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<string> {
    return this.unimplemented('getWorkdir');
  }

  /** Handles `vcs.get_current_branch`. */
  getCurrentBranch(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<string | null> {
    return this.unimplemented('getCurrentBranch');
  }

  /** Handles `vcs.list_branches`. */
  listBranches(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsBranchEntry[]> {
    return this.unimplemented('listBranches');
  }

  /** Handles `vcs.list_local_branches`. */
  listLocalBranches(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<string[]> {
    return this.unimplemented('listLocalBranches');
  }

  /** Handles `vcs.create_branch`. */
  createBranch(
    _params: VcsTypes.VcsCreateBranchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('createBranch');
  }

  /** Handles `vcs.checkout_branch`. */
  checkoutBranch(
    _params: VcsTypes.VcsCheckoutBranchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('checkoutBranch');
  }

  /** Handles `vcs.ensure_remote`. */
  ensureRemote(
    _params: VcsTypes.VcsEnsureRemoteParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('ensureRemote');
  }

  /** Handles `vcs.list_remotes`. */
  listRemotes(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsRemoteEntry[]> {
    return this.unimplemented('listRemotes');
  }

  /** Handles `vcs.remove_remote`. */
  removeRemote(
    _params: VcsTypes.VcsRemoveRemoteParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('removeRemote');
  }

  /** Handles `vcs.fetch`. */
  fetch(
    _params: VcsTypes.VcsFetchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('fetch');
  }

  /** Handles `vcs.fetch_with_options`. */
  fetchWithOptions(
    _params: VcsTypes.VcsFetchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('fetchWithOptions');
  }

  /** Handles `vcs.push`. */
  push(
    _params: VcsTypes.VcsPushParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('push');
  }

  /** Handles `vcs.pull_ff_only`. */
  pullFfOnly(
    _params: VcsTypes.VcsPullFfOnlyParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('pullFfOnly');
  }

  /** Handles `vcs.commit`. */
  commit(
    _params: VcsTypes.VcsCommitParams,
    _context: TContext,
  ): VcsHandlerResult<string> {
    return this.unimplemented('commit');
  }

  /** Handles `vcs.commit_index`. */
  commitIndex(
    _params: VcsTypes.VcsCommitParams,
    _context: TContext,
  ): VcsHandlerResult<string> {
    return this.unimplemented('commitIndex');
  }

  /** Handles `vcs.get_status_summary`. */
  getStatusSummary(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.StatusSummary> {
    return this.unimplemented('getStatusSummary');
  }

  /** Handles `vcs.get_status_payload`. */
  getStatusPayload(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.StatusPayload> {
    return this.unimplemented('getStatusPayload');
  }

  /** Handles `vcs.list_commits`. */
  listCommits(
    _params: VcsTypes.VcsListCommitsParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.CommitEntry[]> {
    return this.unimplemented('listCommits');
  }

  /** Handles `vcs.diff_file`. */
  diffFile(
    _params: VcsTypes.VcsDiffFileParams,
    _context: TContext,
  ): VcsHandlerResult<string[]> {
    return this.unimplemented('diffFile');
  }

  /** Handles `vcs.diff_commit`. */
  diffCommit(
    _params: VcsTypes.VcsDiffCommitParams,
    _context: TContext,
  ): VcsHandlerResult<string[]> {
    return this.unimplemented('diffCommit');
  }

  /** Handles `vcs.get_conflict_details`. */
  getConflictDetails(
    _params: VcsTypes.VcsGetConflictDetailsParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsConflictDetails> {
    return this.unimplemented('getConflictDetails');
  }

  /** Handles `vcs.checkout_conflict_side`. */
  checkoutConflictSide(
    _params: VcsTypes.VcsCheckoutConflictSideParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('checkoutConflictSide');
  }

  /** Handles `vcs.write_merge_result`. */
  writeMergeResult(
    _params: VcsTypes.VcsWriteMergeResultParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('writeMergeResult');
  }

  /** Handles `vcs.stage_patch`. */
  stagePatch(
    _params: VcsTypes.VcsStagePatchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('stagePatch');
  }

  /** Handles `vcs.discard_paths`. */
  discardPaths(
    _params: VcsTypes.VcsDiscardPathsParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('discardPaths');
  }

  /** Handles `vcs.apply_reverse_patch`. */
  applyReversePatch(
    _params: VcsTypes.VcsApplyReversePatchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('applyReversePatch');
  }

  /** Handles `vcs.delete_branch`. */
  deleteBranch(
    _params: VcsTypes.VcsDeleteBranchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('deleteBranch');
  }

  /** Handles `vcs.rename_branch`. */
  renameBranch(
    _params: VcsTypes.VcsRenameBranchParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('renameBranch');
  }

  /** Handles `vcs.merge_into_current`. */
  mergeIntoCurrent(
    _params: VcsTypes.VcsMergeIntoCurrentParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('mergeIntoCurrent');
  }

  /** Handles `vcs.merge_abort`. */
  mergeAbort(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('mergeAbort');
  }

  /** Handles `vcs.merge_continue`. */
  mergeContinue(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('mergeContinue');
  }

  /** Handles `vcs.is_merge_in_progress`. */
  isMergeInProgress(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<boolean> {
    return this.unimplemented('isMergeInProgress');
  }

  /** Handles `vcs.set_branch_upstream`. */
  setBranchUpstream(
    _params: VcsTypes.VcsSetBranchUpstreamParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('setBranchUpstream');
  }

  /** Handles `vcs.get_branch_upstream`. */
  getBranchUpstream(
    _params: VcsTypes.VcsGetBranchUpstreamParams,
    _context: TContext,
  ): VcsHandlerResult<string | null> {
    return this.unimplemented('getBranchUpstream');
  }

  /** Handles `vcs.hard_reset_head`. */
  hardResetHead(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('hardResetHead');
  }

  /** Handles `vcs.reset_soft_to`. */
  resetSoftTo(
    _params: VcsTypes.VcsResetSoftToParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('resetSoftTo');
  }

  /** Handles `vcs.get_identity`. */
  getIdentity(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.VcsIdentity | null> {
    return this.unimplemented('getIdentity');
  }

  /** Handles `vcs.set_identity_local`. */
  setIdentityLocal(
    _params: VcsTypes.VcsSetIdentityLocalParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('setIdentityLocal');
  }

  /** Handles `vcs.list_stashes`. */
  listStashes(
    _params: VcsTypes.VcsSessionParams,
    _context: TContext,
  ): VcsHandlerResult<VcsTypes.StashEntry[]> {
    return this.unimplemented('listStashes');
  }

  /** Handles `vcs.stash_push`. */
  stashPush(
    _params: VcsTypes.VcsStashPushParams,
    _context: TContext,
  ): VcsHandlerResult<string> {
    return this.unimplemented('stashPush');
  }

  /** Handles `vcs.stash_apply`. */
  stashApply(
    _params: VcsTypes.VcsStashSelectorParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('stashApply');
  }

  /** Handles `vcs.stash_pop`. */
  stashPop(
    _params: VcsTypes.VcsStashSelectorParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('stashPop');
  }

  /** Handles `vcs.stash_drop`. */
  stashDrop(
    _params: VcsTypes.VcsStashSelectorParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('stashDrop');
  }

  /** Handles `vcs.stash_show`. */
  stashShow(
    _params: VcsTypes.VcsStashSelectorParams,
    _context: TContext,
  ): VcsHandlerResult<string> {
    return this.unimplemented('stashShow');
  }

  /** Handles `vcs.cherry_pick`. */
  cherryPick(
    _params: VcsTypes.VcsCherryPickParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('cherryPick');
  }

  /** Handles `vcs.revert_commit`. */
  revertCommit(
    _params: VcsTypes.VcsRevertCommitParams,
    _context: TContext,
  ): VcsHandlerResult<null> {
    return this.unimplemented('revertCommit');
  }
}
