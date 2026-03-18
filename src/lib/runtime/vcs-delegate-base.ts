// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type * as VcsTypes from '../types';

import type { PluginRuntimeContext } from './contracts';

/** Describes one synchronous or asynchronous VCS delegate return value. */
type VcsHandlerResult<TResult> = TResult | Promise<TResult>;

/** Stores the class-method to JSON-RPC method mappings used by `VcsDelegateBase`. */
const VCS_DELEGATE_METHOD_MAPPINGS = [
  ['getCaps', 'vcs.get_caps'],
  ['open', 'vcs.open'],
  ['close', 'vcs.close'],
  ['cloneRepo', 'vcs.clone_repo'],
  ['getWorkdir', 'vcs.get_workdir'],
  ['getCurrentBranch', 'vcs.get_current_branch'],
  ['listBranches', 'vcs.list_branches'],
  ['listLocalBranches', 'vcs.list_local_branches'],
  ['createBranch', 'vcs.create_branch'],
  ['checkoutBranch', 'vcs.checkout_branch'],
  ['ensureRemote', 'vcs.ensure_remote'],
  ['listRemotes', 'vcs.list_remotes'],
  ['removeRemote', 'vcs.remove_remote'],
  ['fetch', 'vcs.fetch'],
  ['fetchWithOptions', 'vcs.fetch_with_options'],
  ['push', 'vcs.push'],
  ['pullFfOnly', 'vcs.pull_ff_only'],
  ['commit', 'vcs.commit'],
  ['commitIndex', 'vcs.commit_index'],
  ['getStatusSummary', 'vcs.get_status_summary'],
  ['getStatusPayload', 'vcs.get_status_payload'],
  ['listCommits', 'vcs.list_commits'],
  ['diffFile', 'vcs.diff_file'],
  ['diffCommit', 'vcs.diff_commit'],
  ['getConflictDetails', 'vcs.get_conflict_details'],
  ['checkoutConflictSide', 'vcs.checkout_conflict_side'],
  ['writeMergeResult', 'vcs.write_merge_result'],
  ['stagePatch', 'vcs.stage_patch'],
  ['discardPaths', 'vcs.discard_paths'],
  ['applyReversePatch', 'vcs.apply_reverse_patch'],
  ['deleteBranch', 'vcs.delete_branch'],
  ['renameBranch', 'vcs.rename_branch'],
  ['mergeIntoCurrent', 'vcs.merge_into_current'],
  ['mergeAbort', 'vcs.merge_abort'],
  ['mergeContinue', 'vcs.merge_continue'],
  ['isMergeInProgress', 'vcs.is_merge_in_progress'],
  ['setBranchUpstream', 'vcs.set_branch_upstream'],
  ['getBranchUpstream', 'vcs.get_branch_upstream'],
  ['hardResetHead', 'vcs.hard_reset_head'],
  ['resetSoftTo', 'vcs.reset_soft_to'],
  ['getIdentity', 'vcs.get_identity'],
  ['setIdentityLocal', 'vcs.set_identity_local'],
  ['listStashes', 'vcs.list_stashes'],
  ['stashPush', 'vcs.stash_push'],
  ['stashApply', 'vcs.stash_apply'],
  ['stashPop', 'vcs.stash_pop'],
  ['stashDrop', 'vcs.stash_drop'],
  ['stashShow', 'vcs.stash_show'],
  ['cherryPick', 'vcs.cherry_pick'],
  ['revertCommit', 'vcs.revert_commit'],
] as const;

/** Enumerates the class-friendly method names recognized by `VcsDelegateBase`. */
type VcsDelegateMethodName = (typeof VCS_DELEGATE_METHOD_MAPPINGS)[number][0];

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
  toDelegates(): VcsTypes.VcsDelegates<TContext> {
    const delegates: Partial<VcsTypes.VcsDelegates<TContext>> = {};
    const delegatePrototype = Object.getPrototypeOf(this) as Record<
      VcsDelegateMethodName,
      unknown
    > | null;
    const basePrototype = VcsDelegateBase.prototype as Record<
      VcsDelegateMethodName,
      unknown
    >;

    for (const [delegateMethod, rpcMethod] of VCS_DELEGATE_METHOD_MAPPINGS) {
      const handler = delegatePrototype?.[delegateMethod];
      if (typeof handler !== 'function' || handler === basePrototype[delegateMethod]) {
        continue;
      }

      (delegates as Record<string, unknown>)[rpcMethod] = handler.bind(this);
    }

    return delegates as VcsTypes.VcsDelegates<TContext>;
  }

  /** Returns one standard error for base methods that were not overridden. */
  protected unimplemented<TResult>(methodName: VcsDelegateMethodName): TResult {
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
