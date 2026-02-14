pub const GENERATED_COMPONENT_GUEST_IMPL: &str = r#"
    fn init() -> Result<(), api::PluginError> {
        let mut lock = state().lock().map_err(|_| api::PluginError {
            code: "plugin.state_poisoned".to_string(),
            message: "plugin state lock poisoned".to_string(),
        })?;
        ensure_init_inner(&mut lock)
    }

    fn deinit() -> Result<(), api::PluginError> {
        let mut lock = state().lock().map_err(|_| api::PluginError {
            code: "plugin.state_poisoned".to_string(),
            message: "plugin state lock poisoned".to_string(),
        })?;
        plugin::deinit(&mut lock.ctx).map_err(to_plugin_error)?;
        lock.inited = false;
        Ok(())
    }

    fn get_caps() -> Result<api::Capabilities, api::PluginError> { call_typed("caps", serde_json::Value::Null) }
    fn open(path: String, config: Vec<u8>) -> Result<(), api::PluginError> { call_unit("open", serde_json::json!({ "path": path, "config": config })) }
    fn clone_repo(url: String, dest: String) -> Result<(), api::PluginError> { call_unit("clone", serde_json::json!({ "url": url, "dest": dest })) }
    fn get_workdir() -> Result<String, api::PluginError> { call_typed("workdir", serde_json::Value::Null) }
    fn get_current_branch() -> Result<Option<String>, api::PluginError> { call_typed("current_branch", serde_json::Value::Null) }
    fn list_branches() -> Result<Vec<api::BranchItem>, api::PluginError> { call_branches() }
    fn list_local_branches() -> Result<Vec<String>, api::PluginError> { call_typed("local_branches", serde_json::Value::Null) }
    fn create_branch(name: String, checkout: bool) -> Result<(), api::PluginError> { call_unit("create_branch", serde_json::json!({ "name": name, "checkout": checkout })) }
    fn checkout_branch(name: String) -> Result<(), api::PluginError> { call_unit("checkout_branch", serde_json::json!({ "name": name })) }
    fn ensure_remote(name: String, url: String) -> Result<(), api::PluginError> { call_unit("ensure_remote", serde_json::json!({ "name": name, "url": url })) }
    fn list_remotes() -> Result<Vec<api::RemoteEntry>, api::PluginError> { call_typed("list_remotes", serde_json::Value::Null) }
    fn remove_remote(name: String) -> Result<(), api::PluginError> { call_unit("remove_remote", serde_json::json!({ "name": name })) }
    fn fetch(remote: String, refspec: String) -> Result<(), api::PluginError> { call_unit("fetch", serde_json::json!({ "remote": remote, "refspec": refspec })) }
    fn fetch_with_options(remote: String, refspec: String, opts: api::FetchOptions) -> Result<(), api::PluginError> { call_unit("fetch_with_options", serde_json::json!({ "remote": remote, "refspec": refspec, "opts": opts })) }
    fn push(remote: String, refspec: String) -> Result<(), api::PluginError> { call_unit("push", serde_json::json!({ "remote": remote, "refspec": refspec })) }
    fn pull_ff_only(remote: String, branch: String) -> Result<(), api::PluginError> { call_unit("pull_ff_only", serde_json::json!({ "remote": remote, "branch": branch })) }
    fn commit(message: String, name: String, email: String, paths: Vec<String>) -> Result<String, api::PluginError> { call_typed("commit", serde_json::json!({ "message": message, "name": name, "email": email, "paths": paths })) }
    fn commit_index(message: String, name: String, email: String) -> Result<String, api::PluginError> { call_typed("commit_index", serde_json::json!({ "message": message, "name": name, "email": email })) }
    fn get_status_summary() -> Result<api::StatusSummary, api::PluginError> { call_typed("status_summary", serde_json::Value::Null) }
    fn get_status_payload() -> Result<api::StatusPayload, api::PluginError> { call_typed("status_payload", serde_json::Value::Null) }
    fn list_commits(query: api::LogQuery) -> Result<Vec<api::CommitItem>, api::PluginError> { call_typed("log_commits", serde_json::json!({ "query": query })) }
    fn diff_file(path: String) -> Result<Vec<String>, api::PluginError> { call_typed("diff_file", serde_json::json!({ "path": path })) }
    fn diff_commit(rev: String) -> Result<Vec<String>, api::PluginError> { call_typed("diff_commit", serde_json::json!({ "rev": rev })) }
    fn get_conflict_details(path: String) -> Result<api::ConflictDetails, api::PluginError> { call_typed("conflict_details", serde_json::json!({ "path": path })) }
    fn checkout_conflict_side(path: String, side: api::ConflictSide) -> Result<(), api::PluginError> { call_unit("checkout_conflict_side", serde_json::json!({ "path": path, "side": side })) }
    fn write_merge_result(path: String, content: Vec<u8>) -> Result<(), api::PluginError> { call_unit("write_merge_result", serde_json::json!({ "path": path, "content": content })) }
    fn stage_patch(patch: String) -> Result<(), api::PluginError> { call_unit("stage_patch", serde_json::json!({ "patch": patch })) }
    fn discard_paths(paths: Vec<String>) -> Result<(), api::PluginError> { call_unit("discard_paths", serde_json::json!({ "paths": paths })) }
    fn apply_reverse_patch(patch: String) -> Result<(), api::PluginError> { call_unit("apply_reverse_patch", serde_json::json!({ "patch": patch })) }
    fn delete_branch(name: String, force: bool) -> Result<(), api::PluginError> { call_unit("delete_branch", serde_json::json!({ "name": name, "force": force })) }
    fn rename_branch(old: String, new: String) -> Result<(), api::PluginError> { call_unit("rename_branch", serde_json::json!({ "old": old, "new": new })) }
    fn merge_into_current(name: String, message: Option<String>) -> Result<(), api::PluginError> { call_unit("merge_into_current", serde_json::json!({ "name": name, "message": message })) }
    fn merge_abort() -> Result<(), api::PluginError> { call_unit("merge_abort", serde_json::Value::Null) }
    fn merge_continue() -> Result<(), api::PluginError> { call_unit("merge_continue", serde_json::Value::Null) }
    fn is_merge_in_progress() -> Result<bool, api::PluginError> { call_typed("merge_in_progress", serde_json::Value::Null) }
    fn set_branch_upstream(branch: String, upstream: String) -> Result<(), api::PluginError> { call_unit("set_branch_upstream", serde_json::json!({ "branch": branch, "upstream": upstream })) }
    fn get_branch_upstream(branch: String) -> Result<Option<String>, api::PluginError> { call_typed("branch_upstream", serde_json::json!({ "branch": branch })) }
    fn hard_reset_head() -> Result<(), api::PluginError> { call_unit("hard_reset_head", serde_json::Value::Null) }
    fn reset_soft_to(rev: String) -> Result<(), api::PluginError> { call_unit("reset_soft_to", serde_json::json!({ "rev": rev })) }
    fn get_identity() -> Result<Option<api::Identity>, api::PluginError> { call_typed("get_identity", serde_json::Value::Null) }
    fn set_identity_local(name: String, email: String) -> Result<(), api::PluginError> { call_unit("set_identity_local", serde_json::json!({ "name": name, "email": email })) }
    fn list_stashes() -> Result<Vec<api::StashItem>, api::PluginError> { call_typed("stash_list", serde_json::Value::Null) }
    fn stash_push(message: Option<String>, include_untracked: bool) -> Result<String, api::PluginError> { call_typed("stash_push", serde_json::json!({ "message": message, "include_untracked": include_untracked })) }
    fn stash_apply(selector: String) -> Result<(), api::PluginError> { call_unit("stash_apply", serde_json::json!({ "selector": selector })) }
    fn stash_pop(selector: String) -> Result<(), api::PluginError> { call_unit("stash_pop", serde_json::json!({ "selector": selector })) }
    fn stash_drop(selector: String) -> Result<(), api::PluginError> { call_unit("stash_drop", serde_json::json!({ "selector": selector })) }
    fn stash_show(selector: String) -> Result<String, api::PluginError> { call_typed("stash_show", serde_json::json!({ "selector": selector })) }
    fn cherry_pick(commit: String) -> Result<(), api::PluginError> { call_unit("cherry_pick", serde_json::json!({ "commit": commit })) }
    fn revert_commit(commit: String, no_edit: bool) -> Result<(), api::PluginError> { call_unit("revert_commit", serde_json::json!({ "commit": commit, "no_edit": no_edit })) }
"#;
