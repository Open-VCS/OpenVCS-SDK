// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RequestParams, RpcMethodHandler } from './protocol';

/** Describes the feature flags reported by a VCS backend plugin. */
export interface VcsCapabilities {
  /** Indicates whether commit history operations are supported. */
  commits: boolean;
  /** Indicates whether branch operations are supported. */
  branches: boolean;
  /** Indicates whether tag operations are supported. */
  tags: boolean;
  /** Indicates whether index staging operations are supported. */
  staging: boolean;
  /** Indicates whether push and pull operations are supported. */
  push_pull: boolean;
  /** Indicates whether fast-forward helpers are supported. */
  fast_forward: boolean;
}

/** Describes params that carry a repository session id. */
export interface VcsSessionParams extends RequestParams {
  /** Stores the repository session id allocated by `vcs.open`. */
  session_id: string;
}

/** Describes the params used by `vcs.open`. */
export interface VcsOpenParams extends RequestParams {
  /** Stores the repository path to open. */
  path: string;
}

/** Describes the result returned by `vcs.open`. */
export interface VcsSessionResult {
  /** Stores the allocated repository session id. */
  session_id: string;
}

/** Describes the params used by `vcs.clone_repo`. */
export interface VcsCloneRepoParams extends RequestParams {
  /** Stores the source repository URL. */
  url: string;
  /** Stores the destination path. */
  dest: string;
}

/** Describes one local branch kind marker. */
export interface VcsLocalBranchKind {
  /** Stores the branch kind discriminator. */
  type: 'Local';
}

/** Describes one remote branch kind marker. */
export interface VcsRemoteBranchKind {
  /** Stores the branch kind discriminator. */
  type: 'Remote';
  /** Stores the remote name when known. */
  remote: string | null;
}

/** Describes the branch kind union returned to the host. */
export type VcsBranchKind = VcsLocalBranchKind | VcsRemoteBranchKind;

/** Describes one branch entry returned by `vcs.list_branches`. */
export interface VcsBranchEntry {
  /** Stores the short branch name. */
  name: string;
  /** Stores the full ref path. */
  full_ref: string;
  /** Stores the local or remote branch kind. */
  kind: VcsBranchKind;
  /** Indicates whether the branch is currently checked out. */
  current: boolean;
}

/** Describes params for branch creation. */
export interface VcsCreateBranchParams extends VcsSessionParams {
  /** Stores the new branch name. */
  name: string;
  /** Indicates whether the new branch should be checked out immediately. */
  checkout?: boolean;
}

/** Describes params for branch checkout. */
export interface VcsCheckoutBranchParams extends VcsSessionParams {
  /** Stores the branch name to check out. */
  name: string;
}

/** Describes params for ensuring a remote exists. */
export interface VcsEnsureRemoteParams extends VcsSessionParams {
  /** Stores the remote name. */
  name: string;
  /** Stores the remote URL. */
  url: string;
}

/** Describes one remote entry. */
export interface VcsRemoteEntry {
  /** Stores the remote name. */
  name: string;
  /** Stores the remote URL. */
  url: string;
}

/** Describes params for removing a remote. */
export interface VcsRemoveRemoteParams extends VcsSessionParams {
  /** Stores the remote name to remove. */
  name: string;
}

/** Describes optional fetch flags. */
export interface VcsFetchOptions {
  /** Indicates whether stale remote references should be pruned. */
  prune?: boolean;
}

/** Describes params for fetch methods. */
export interface VcsFetchParams extends VcsSessionParams {
  /** Stores the remote to fetch when one is supplied. */
  remote?: string;
  /** Stores the refspec to fetch when one is supplied. */
  refspec?: string;
  /** Stores optional fetch flags. */
  opts?: VcsFetchOptions;
}

/** Describes params for push. */
export interface VcsPushParams extends VcsSessionParams {
  /** Stores the remote to push to when one is supplied. */
  remote?: string;
  /** Stores the refspec to push when one is supplied. */
  refspec?: string;
}

/** Describes params for fast-forward-only pull. */
export interface VcsPullFfOnlyParams extends VcsSessionParams {
  /** Stores the remote to pull from when one is supplied. */
  remote?: string;
  /** Stores the branch to pull when one is supplied. */
  branch?: string;
}

/** Describes params for commit creation. */
export interface VcsCommitParams extends VcsSessionParams {
  /** Stores the commit author name. */
  name: string;
  /** Stores the commit author email. */
  email: string;
  /** Stores the commit message. */
  message: string;
  /** Stores the optional path subset to add before committing. */
  paths?: string[];
}

/** Describes the aggregate repository status counts returned to the host. */
export interface StatusSummary {
  /** Counts untracked files. */
  untracked: number;
  /** Counts modified working tree files. */
  modified: number;
  /** Counts staged files. */
  staged: number;
  /** Counts conflicted files. */
  conflicted: number;
}

/** Describes one file entry in the OpenVCS status payload. */
export interface StatusFileEntry {
  /** Stores the current file path. */
  path: string;
  /** Stores the prior path for rename and copy records. */
  old_path: string | null;
  /** Stores the porcelain status code. */
  status: string;
  /** Indicates whether the file has staged changes. */
  staged: boolean;
  /** Indicates whether a conflict has been resolved. */
  resolved_conflict: boolean;
  /** Stores placeholder hunk information until richer diff support exists. */
  hunks: never[];
}

/** Describes the structured status payload returned to the host. */
export interface StatusPayload {
  /** Stores file-level status entries. */
  files: StatusFileEntry[];
  /** Stores the local branch ahead count relative to its upstream. */
  ahead: number;
  /** Stores the local branch behind count relative to its upstream. */
  behind: number;
}

/** Describes the complete parsed status result. */
export interface StatusParseResult {
  /** Stores the aggregate status summary. */
  summary: StatusSummary;
  /** Stores the detailed status payload. */
  payload: StatusPayload;
}

/** Describes one list-commits query payload. */
export interface VcsListCommitsQuery extends RequestParams {
  /** Stores the number of commits to skip. */
  skip?: number;
  /** Stores the maximum number of commits to return. */
  limit?: number;
  /** Indicates whether topo-order should be used. */
  topo_order?: boolean;
  /** Indicates whether merge commits should be included. */
  include_merges?: boolean;
  /** Stores an optional author substring filter. */
  author_contains?: string;
  /** Stores an optional lower timestamp bound in UTC. */
  since_utc?: string;
  /** Stores an optional upper timestamp bound in UTC. */
  until_utc?: string;
  /** Stores the revision to walk from. */
  rev?: string;
  /** Stores an optional path filter. */
  path?: string;
}

/** Describes params for `vcs.list_commits`. */
export interface VcsListCommitsParams extends VcsSessionParams {
  /** Stores the query object sent by the host. */
  query?: VcsListCommitsQuery;
}

/** Describes one commit entry returned from `git log`. */
export interface CommitEntry {
  /** Stores the full commit id. */
  id: string;
  /** Stores the commit subject. */
  msg: string;
  /** Stores the author display name. */
  author: string;
  /** Stores the formatted metadata string. */
  meta: string;
  /** Stores the first parent commit id when available. */
  parent_oid?: string;
}

/** Describes params for `vcs.diff_file`. */
export interface VcsDiffFileParams extends VcsSessionParams {
  /** Stores the file path to diff. */
  path: string;
}

/** Describes params for `vcs.diff_commit`. */
export interface VcsDiffCommitParams extends VcsSessionParams {
  /** Stores the revision to diff. */
  rev: string;
}

/** Describes params for `vcs.get_conflict_details`. */
export interface VcsGetConflictDetailsParams extends VcsSessionParams {
  /** Stores the conflicted path. */
  path: string;
}

/** Describes one conflict details payload. */
export interface VcsConflictDetails {
  /** Stores the conflicted path. */
  path: string;
  /** Stores the base version content when available. */
  base: string | null;
  /** Stores the current branch content when available. */
  ours: string | null;
  /** Stores the incoming branch content when available. */
  theirs: string | null;
  /** Indicates whether the conflict is binary. */
  binary: boolean;
  /** Indicates whether the conflict references Git LFS content. */
  lfs_pointer: boolean;
}

/** Describes params for checking out one side of a conflict. */
export interface VcsCheckoutConflictSideParams extends VcsSessionParams {
  /** Stores the side name, usually `ours` or `theirs`. */
  side?: string;
  /** Stores the conflicted file path. */
  path: string;
}

/** Describes params for writing a merge result to disk. */
export interface VcsWriteMergeResultParams extends VcsSessionParams {
  /** Stores the output file path. */
  path: string;
  /** Stores the file contents encoded as base64. */
  content_b64: string;
}

/** Describes params for staging a text patch. */
export interface VcsStagePatchParams extends VcsSessionParams {
  /** Stores the textual patch content. */
  patch: string;
}

/** Describes params for staging repository-relative paths into the index. */
export interface VcsStagePathsParams extends VcsSessionParams {
  /** Stores the paths to stage. */
  paths?: string[];
}

/** Describes params for discarding path changes. */
export interface VcsDiscardPathsParams extends VcsSessionParams {
  /** Stores the paths to discard. */
  paths?: string[];
}

/** Describes params for applying a reverse patch. */
export interface VcsApplyReversePatchParams extends VcsSessionParams {
  /** Stores the textual patch content. */
  patch: string;
}

/** Describes params for deleting a branch. */
export interface VcsDeleteBranchParams extends VcsSessionParams {
  /** Stores the branch name to delete. */
  name: string;
  /** Indicates whether the delete should be forced. */
  force?: boolean;
}

/** Describes params for renaming a branch. */
export interface VcsRenameBranchParams extends VcsSessionParams {
  /** Stores the current branch name. */
  old: string;
  /** Stores the next branch name. */
  new: string;
}

/** Describes params for merging another branch into the current branch. */
export interface VcsMergeIntoCurrentParams extends VcsSessionParams {
  /** Stores the branch name to merge. */
  name: string;
  /** Stores an optional merge commit message. */
  message?: string;
}

/** Describes params for setting a branch upstream. */
export interface VcsSetBranchUpstreamParams extends VcsSessionParams {
  /** Stores the local branch name. */
  branch: string;
  /** Stores the upstream ref to track. */
  upstream: string;
}

/** Describes params for getting a branch upstream. */
export interface VcsGetBranchUpstreamParams extends VcsSessionParams {
  /** Stores the local branch name. */
  branch: string;
}

/** Describes params for soft reset. */
export interface VcsResetSoftToParams extends VcsSessionParams {
  /** Stores the revision to reset to. */
  rev: string;
}

/** Describes params for continuing a merge in progress. */
export interface VcsMergeContinueParams extends VcsSessionParams {
  /** Stores an optional commit message override. */
  message?: string;
}

/** Describes params for hard resetting HEAD to a given ref. */
export interface VcsHardResetHeadParams extends VcsSessionParams {
  /** Stores the ref to reset HEAD to; defaults to HEAD. */
  ref?: string;
}

/** Describes one configured author identity. */
export interface VcsIdentity {
  /** Stores the configured author name. */
  name: string;
  /** Stores the configured author email. */
  email: string;
}

/** Describes params for configuring the local repository identity. */
export interface VcsSetIdentityLocalParams extends VcsSessionParams {
  /** Stores the author name. */
  name: string;
  /** Stores the author email. */
  email: string;
}

/** Describes one stash entry returned to the host. */
export interface StashEntry {
  /** Stores the stash selector such as `stash@{0}`. */
  selector: string;
  /** Stores the stash message. */
  msg: string;
  /** Stores extra metadata reserved for future expansion. */
  meta: string;
}

/** Describes params for stash push. */
export interface VcsStashPushParams extends VcsSessionParams {
  /** Indicates whether untracked files should be included. */
  include_untracked?: boolean;
  /** Stores an optional stash message. */
  message?: string;
}

/** Describes params for stash selection operations. */
export interface VcsStashSelectorParams extends VcsSessionParams {
  /** Stores the stash selector, such as `stash@{0}`. */
  selector: string;
}

/** Describes params for cherry-picking a commit. */
export interface VcsCherryPickParams extends VcsSessionParams {
  /** Stores the commit to cherry-pick. */
  commit: string;
}

/** Describes params for reverting a commit. */
export interface VcsRevertCommitParams extends VcsSessionParams {
  /** Stores the commit to revert. */
  commit: string;
  /** Indicates whether the editor should be skipped. */
  no_edit?: boolean;
}

/** Describes the delegate map supported by the SDK runtime for `vcs.*`. */
export interface VcsDelegates<TContext = unknown> {
  /** Handles `vcs.get_caps`. */
  'vcs.get_caps'?: RpcMethodHandler<RequestParams, VcsCapabilities, TContext>;
  /** Handles `vcs.open`. */
  'vcs.open'?: RpcMethodHandler<VcsOpenParams, VcsSessionResult, TContext>;
  /** Handles `vcs.close`. */
  'vcs.close'?: RpcMethodHandler<VcsSessionParams, null, TContext>;
  /** Handles `vcs.clone_repo`. */
  'vcs.clone_repo'?: RpcMethodHandler<VcsCloneRepoParams, null, TContext>;
  /** Handles `vcs.get_workdir`. */
  'vcs.get_workdir'?: RpcMethodHandler<VcsSessionParams, string, TContext>;
  /** Handles `vcs.get_current_branch`. */
  'vcs.get_current_branch'?: RpcMethodHandler<
    VcsSessionParams,
    string | null,
    TContext
  >;
  /** Handles `vcs.list_branches`. */
  'vcs.list_branches'?: RpcMethodHandler<
    VcsSessionParams,
    VcsBranchEntry[],
    TContext
  >;
  /** Handles `vcs.list_local_branches`. */
  'vcs.list_local_branches'?: RpcMethodHandler<
    VcsSessionParams,
    string[],
    TContext
  >;
  /** Handles `vcs.create_branch`. */
  'vcs.create_branch'?: RpcMethodHandler<VcsCreateBranchParams, null, TContext>;
  /** Handles `vcs.checkout_branch`. */
  'vcs.checkout_branch'?: RpcMethodHandler<VcsCheckoutBranchParams, null, TContext>;
  /** Handles `vcs.ensure_remote`. */
  'vcs.ensure_remote'?: RpcMethodHandler<VcsEnsureRemoteParams, null, TContext>;
  /** Handles `vcs.list_remotes`. */
  'vcs.list_remotes'?: RpcMethodHandler<
    VcsSessionParams,
    VcsRemoteEntry[],
    TContext
  >;
  /** Handles `vcs.remove_remote`. */
  'vcs.remove_remote'?: RpcMethodHandler<VcsRemoveRemoteParams, null, TContext>;
  /** Handles `vcs.fetch`. */
  'vcs.fetch'?: RpcMethodHandler<VcsFetchParams, null, TContext>;
  /** Handles `vcs.fetch_with_options`. */
  'vcs.fetch_with_options'?: RpcMethodHandler<VcsFetchParams, null, TContext>;
  /** Handles `vcs.push`. */
  'vcs.push'?: RpcMethodHandler<VcsPushParams, null, TContext>;
  /** Handles `vcs.pull_ff_only`. */
  'vcs.pull_ff_only'?: RpcMethodHandler<VcsPullFfOnlyParams, null, TContext>;
  /** Handles `vcs.commit`. */
  'vcs.commit'?: RpcMethodHandler<VcsCommitParams, string, TContext>;
  /** Handles `vcs.commit_index`. */
  'vcs.commit_index'?: RpcMethodHandler<VcsCommitParams, string, TContext>;
  /** Handles `vcs.get_status_summary`. */
  'vcs.get_status_summary'?: RpcMethodHandler<
    VcsSessionParams,
    StatusSummary,
    TContext
  >;
  /** Handles `vcs.get_status_payload`. */
  'vcs.get_status_payload'?: RpcMethodHandler<
    VcsSessionParams,
    StatusPayload,
    TContext
  >;
  /** Handles `vcs.list_commits`. */
  'vcs.list_commits'?: RpcMethodHandler<
    VcsListCommitsParams,
    CommitEntry[],
    TContext
  >;
  /** Handles `vcs.diff_file`. */
  'vcs.diff_file'?: RpcMethodHandler<VcsDiffFileParams, string[], TContext>;
  /** Handles `vcs.diff_commit`. */
  'vcs.diff_commit'?: RpcMethodHandler<VcsDiffCommitParams, string[], TContext>;
  /** Handles `vcs.get_conflict_details`. */
  'vcs.get_conflict_details'?: RpcMethodHandler<
    VcsGetConflictDetailsParams,
    VcsConflictDetails,
    TContext
  >;
  /** Handles `vcs.checkout_conflict_side`. */
  'vcs.checkout_conflict_side'?: RpcMethodHandler<
    VcsCheckoutConflictSideParams,
    null,
    TContext
  >;
  /** Handles `vcs.write_merge_result`. */
  'vcs.write_merge_result'?: RpcMethodHandler<
    VcsWriteMergeResultParams,
    null,
    TContext
  >;
  /** Handles `vcs.stage_patch`. */
  'vcs.stage_patch'?: RpcMethodHandler<VcsStagePatchParams, null, TContext>;
  /** Handles `vcs.stage_paths`. */
  'vcs.stage_paths'?: RpcMethodHandler<VcsStagePathsParams, null, TContext>;
  /** Handles `vcs.discard_paths`. */
  'vcs.discard_paths'?: RpcMethodHandler<VcsDiscardPathsParams, null, TContext>;
  /** Handles `vcs.apply_reverse_patch`. */
  'vcs.apply_reverse_patch'?: RpcMethodHandler<
    VcsApplyReversePatchParams,
    null,
    TContext
  >;
  /** Handles `vcs.delete_branch`. */
  'vcs.delete_branch'?: RpcMethodHandler<VcsDeleteBranchParams, null, TContext>;
  /** Handles `vcs.rename_branch`. */
  'vcs.rename_branch'?: RpcMethodHandler<VcsRenameBranchParams, null, TContext>;
  /** Handles `vcs.merge_into_current`. */
  'vcs.merge_into_current'?: RpcMethodHandler<
    VcsMergeIntoCurrentParams,
    null,
    TContext
  >;
  /** Handles `vcs.merge_abort`. */
  'vcs.merge_abort'?: RpcMethodHandler<VcsSessionParams, null, TContext>;
  /** Handles `vcs.merge_continue`. */
  'vcs.merge_continue'?: RpcMethodHandler<VcsMergeContinueParams, null, TContext>;
  /** Handles `vcs.is_merge_in_progress`. */
  'vcs.is_merge_in_progress'?: RpcMethodHandler<
    VcsSessionParams,
    boolean,
    TContext
  >;
  /** Handles `vcs.set_branch_upstream`. */
  'vcs.set_branch_upstream'?: RpcMethodHandler<
    VcsSetBranchUpstreamParams,
    null,
    TContext
  >;
  /** Handles `vcs.get_branch_upstream`. */
  'vcs.get_branch_upstream'?: RpcMethodHandler<
    VcsGetBranchUpstreamParams,
    string | null,
    TContext
  >;
  /** Handles `vcs.hard_reset_head`. */
  'vcs.hard_reset_head'?: RpcMethodHandler<VcsHardResetHeadParams, null, TContext>;
  /** Handles `vcs.reset_soft_to`. */
  'vcs.reset_soft_to'?: RpcMethodHandler<VcsResetSoftToParams, null, TContext>;
  /** Handles `vcs.get_identity`. */
  'vcs.get_identity'?: RpcMethodHandler<
    VcsSessionParams,
    VcsIdentity | null,
    TContext
  >;
  /** Handles `vcs.set_identity_local`. */
  'vcs.set_identity_local'?: RpcMethodHandler<
    VcsSetIdentityLocalParams,
    null,
    TContext
  >;
  /** Handles `vcs.list_stashes`. */
  'vcs.list_stashes'?: RpcMethodHandler<VcsSessionParams, StashEntry[], TContext>;
  /** Handles `vcs.stash_push`. */
  'vcs.stash_push'?: RpcMethodHandler<VcsStashPushParams, string, TContext>;
  /** Handles `vcs.stash_apply`. */
  'vcs.stash_apply'?: RpcMethodHandler<VcsStashSelectorParams, null, TContext>;
  /** Handles `vcs.stash_pop`. */
  'vcs.stash_pop'?: RpcMethodHandler<VcsStashSelectorParams, null, TContext>;
  /** Handles `vcs.stash_drop`. */
  'vcs.stash_drop'?: RpcMethodHandler<VcsStashSelectorParams, null, TContext>;
  /** Handles `vcs.stash_show`. */
  'vcs.stash_show'?: RpcMethodHandler<VcsStashSelectorParams, string, TContext>;
  /** Handles `vcs.cherry_pick`. */
  'vcs.cherry_pick'?: RpcMethodHandler<VcsCherryPickParams, null, TContext>;
  /** Handles `vcs.revert_commit`. */
  'vcs.revert_commit'?: RpcMethodHandler<VcsRevertCommitParams, null, TContext>;
}
