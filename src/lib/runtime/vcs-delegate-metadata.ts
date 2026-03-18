// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type * as VcsTypes from '../types';

import type { PluginRuntimeContext } from './contracts';

/** Stores the typed class-method signatures supported by `VcsDelegateBase`. */
export type VcsDelegateBindings<TContext> = {
  getCaps: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.get_caps']>;
  open: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.open']>;
  close: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.close']>;
  cloneRepo: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.clone_repo']>;
  getWorkdir: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.get_workdir']>;
  getCurrentBranch: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.get_current_branch']
  >;
  listBranches: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.list_branches']>;
  listLocalBranches: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.list_local_branches']
  >;
  createBranch: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.create_branch']>;
  checkoutBranch: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.checkout_branch']
  >;
  ensureRemote: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.ensure_remote']>;
  listRemotes: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.list_remotes']>;
  removeRemote: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.remove_remote']>;
  fetch: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.fetch']>;
  fetchWithOptions: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.fetch_with_options']
  >;
  push: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.push']>;
  pullFfOnly: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.pull_ff_only']>;
  commit: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.commit']>;
  commitIndex: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.commit_index']>;
  getStatusSummary: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.get_status_summary']
  >;
  getStatusPayload: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.get_status_payload']
  >;
  listCommits: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.list_commits']>;
  diffFile: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.diff_file']>;
  diffCommit: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.diff_commit']>;
  getConflictDetails: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.get_conflict_details']
  >;
  checkoutConflictSide: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.checkout_conflict_side']
  >;
  writeMergeResult: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.write_merge_result']
  >;
  stagePatch: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stage_patch']>;
  discardPaths: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.discard_paths']>;
  applyReversePatch: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.apply_reverse_patch']
  >;
  deleteBranch: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.delete_branch']>;
  renameBranch: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.rename_branch']>;
  mergeIntoCurrent: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.merge_into_current']
  >;
  mergeAbort: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.merge_abort']>;
  mergeContinue: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.merge_continue']>;
  isMergeInProgress: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.is_merge_in_progress']
  >;
  setBranchUpstream: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.set_branch_upstream']
  >;
  getBranchUpstream: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.get_branch_upstream']
  >;
  hardResetHead: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.hard_reset_head']>;
  resetSoftTo: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.reset_soft_to']>;
  getIdentity: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.get_identity']>;
  setIdentityLocal: NonNullable<
    VcsTypes.VcsDelegates<TContext>['vcs.set_identity_local']
  >;
  listStashes: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.list_stashes']>;
  stashPush: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stash_push']>;
  stashApply: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stash_apply']>;
  stashPop: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stash_pop']>;
  stashDrop: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stash_drop']>;
  stashShow: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.stash_show']>;
  cherryPick: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.cherry_pick']>;
  revertCommit: NonNullable<VcsTypes.VcsDelegates<TContext>['vcs.revert_commit']>;
};

/** Enumerates the class-friendly method names recognized by `VcsDelegateBase`. */
export type VcsDelegateMethodName = keyof VcsDelegateBindings<PluginRuntimeContext>;

/** Maps one delegate class method to the SDK runtime RPC key it implements. */
export const VCS_DELEGATE_METHOD_MAPPINGS = {
  getCaps: 'vcs.get_caps',
  open: 'vcs.open',
  close: 'vcs.close',
  cloneRepo: 'vcs.clone_repo',
  getWorkdir: 'vcs.get_workdir',
  getCurrentBranch: 'vcs.get_current_branch',
  listBranches: 'vcs.list_branches',
  listLocalBranches: 'vcs.list_local_branches',
  createBranch: 'vcs.create_branch',
  checkoutBranch: 'vcs.checkout_branch',
  ensureRemote: 'vcs.ensure_remote',
  listRemotes: 'vcs.list_remotes',
  removeRemote: 'vcs.remove_remote',
  fetch: 'vcs.fetch',
  fetchWithOptions: 'vcs.fetch_with_options',
  push: 'vcs.push',
  pullFfOnly: 'vcs.pull_ff_only',
  commit: 'vcs.commit',
  commitIndex: 'vcs.commit_index',
  getStatusSummary: 'vcs.get_status_summary',
  getStatusPayload: 'vcs.get_status_payload',
  listCommits: 'vcs.list_commits',
  diffFile: 'vcs.diff_file',
  diffCommit: 'vcs.diff_commit',
  getConflictDetails: 'vcs.get_conflict_details',
  checkoutConflictSide: 'vcs.checkout_conflict_side',
  writeMergeResult: 'vcs.write_merge_result',
  stagePatch: 'vcs.stage_patch',
  discardPaths: 'vcs.discard_paths',
  applyReversePatch: 'vcs.apply_reverse_patch',
  deleteBranch: 'vcs.delete_branch',
  renameBranch: 'vcs.rename_branch',
  mergeIntoCurrent: 'vcs.merge_into_current',
  mergeAbort: 'vcs.merge_abort',
  mergeContinue: 'vcs.merge_continue',
  isMergeInProgress: 'vcs.is_merge_in_progress',
  setBranchUpstream: 'vcs.set_branch_upstream',
  getBranchUpstream: 'vcs.get_branch_upstream',
  hardResetHead: 'vcs.hard_reset_head',
  resetSoftTo: 'vcs.reset_soft_to',
  getIdentity: 'vcs.get_identity',
  setIdentityLocal: 'vcs.set_identity_local',
  listStashes: 'vcs.list_stashes',
  stashPush: 'vcs.stash_push',
  stashApply: 'vcs.stash_apply',
  stashPop: 'vcs.stash_pop',
  stashDrop: 'vcs.stash_drop',
  stashShow: 'vcs.stash_show',
  cherryPick: 'vcs.cherry_pick',
  revertCommit: 'vcs.revert_commit',
} as const satisfies Record<
  VcsDelegateMethodName,
  keyof VcsTypes.VcsDelegates<PluginRuntimeContext>
>;

/** Resolves the RPC method implemented by one class-friendly delegate method. */
export type VcsDelegateRpcMethodName<TMethodName extends VcsDelegateMethodName> =
  (typeof VCS_DELEGATE_METHOD_MAPPINGS)[TMethodName];

/** Describes the callable prototype surface required by `toDelegates()`. */
export type VcsDelegatePrototype<TContext> = {
  [TMethodName in keyof VcsDelegateBindings<TContext>]: VcsDelegateBindings<TContext>[TMethodName];
};

/** Stores the exact `vcs.*` delegate object shape produced from class methods. */
export type VcsDelegateAssignments<TContext> = {
  [TMethodName in VcsDelegateMethodName as VcsDelegateRpcMethodName<TMethodName>]?:
    VcsDelegateBindings<TContext>[TMethodName];
};
