use crate::model::*;
use crate::validation;
use serde::Serialize;
use serde_json::Value;
use sqlx::AnyPool;
use std::collections::{BTreeSet, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("{0}")]
    Bad(String),
    #[error("validation failed")]
    Validation { issues: Vec<Issue> },
    #[error("{0}")]
    NotFound(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type ModelResult<T> = Result<T, ModelError>;

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn db(err: sqlx::Error) -> ModelError {
    ModelError::Db(err)
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

pub async fn create_repo(
    pool: &AnyPool,
    name: &str,
    description: Option<&str>,
) -> ModelResult<RepoRow> {
    create_repo_scoped(pool, crate::platform::DEFAULT_TENANT, name, description).await
}

/// Creates a repository inside a tenant. Repository names are unique per
/// tenant, so two tenants can both own a `retail` model.
pub async fn create_repo_scoped(
    pool: &AnyPool,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
) -> ModelResult<RepoRow> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ModelError::Bad("repository name must not be empty".into()));
    }
    let duplicate: Option<(String,)> =
        sqlx::query_as("SELECT id FROM repos WHERE tenant_id = ? AND name = ?")
            .bind(tenant_id)
            .bind(name)
            .fetch_optional(pool)
            .await
            .map_err(db)?;
    if duplicate.is_some() {
        return Err(ModelError::Bad(format!(
            "repository `{name}` already exists in this tenant"
        )));
    }
    let repo_id = new_id();
    let branch_id = new_id();
    let commit_id = new_id();
    let now = now_millis();
    let empty_tree = serde_json::to_string(&empty_snapshot())?;

    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query(
        "INSERT INTO repos (id, tenant_id, name, description, head_branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(&repo_id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;

    sqlx::query(
        "INSERT INTO branches (id, repo_id, name, head_commit_id, is_default, created_at, updated_at) VALUES (?, ?, 'main', NULL, 1, ?, ?)",
    )
    .bind(&branch_id)
    .bind(&repo_id)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;

    sqlx::query(
        "INSERT INTO commits (id, repo_id, branch_id, message, author, parent_commit_id, parent2_commit_id, tree_json, created_at) VALUES (?, ?, ?, 'Initial commit', 'system', NULL, NULL, ?, ?)",
    )
    .bind(&commit_id)
    .bind(&repo_id)
    .bind(&branch_id)
    .bind(&empty_tree)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;

    sqlx::query("UPDATE branches SET head_commit_id = ?, updated_at = ? WHERE id = ?")
        .bind(&commit_id)
        .bind(now)
        .bind(&branch_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("UPDATE repos SET head_branch_id = ?, updated_at = ? WHERE id = ?")
        .bind(&branch_id)
        .bind(now)
        .bind(&repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO working_trees (repo_id, branch_id, base_commit_id, tree_json, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&repo_id)
    .bind(&branch_id)
    .bind(&commit_id)
    .bind(&empty_tree)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;

    get_repo(pool, &repo_id).await
}

pub async fn get_repo(pool: &AnyPool, repo_id: &str) -> ModelResult<RepoRow> {
    sqlx::query_as::<_, RepoRow>("SELECT * FROM repos WHERE id = ?")
        .bind(repo_id)
        .fetch_optional(pool)
        .await
        .map_err(db)?
        .ok_or_else(|| ModelError::NotFound(format!("repository {repo_id} not found")))
}

pub async fn list_repos(pool: &AnyPool) -> ModelResult<Vec<RepoRow>> {
    Ok(sqlx::query_as::<_, RepoRow>("SELECT * FROM repos ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
        .map_err(db)?)
}

pub async fn list_repos_scoped(pool: &AnyPool, tenant_id: &str) -> ModelResult<Vec<RepoRow>> {
    Ok(sqlx::query_as::<_, RepoRow>(
        "SELECT * FROM repos WHERE tenant_id = ? ORDER BY updated_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(db)?)
}

pub async fn delete_repo(pool: &AnyPool, repo_id: &str) -> ModelResult<()> {
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("DELETE FROM working_trees WHERE repo_id = ?")
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM commits WHERE repo_id = ?")
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM branches WHERE repo_id = ?")
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let res = sqlx::query("DELETE FROM repos WHERE id = ?")
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    if res.rows_affected() == 0 {
        return Err(ModelError::NotFound(format!("repository {repo_id} not found")));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum BranchFrom {
    Default,
    Branch(String),
    Commit(String),
}

pub async fn list_branches(pool: &AnyPool, repo_id: &str) -> ModelResult<Vec<BranchRow>> {
    Ok(sqlx::query_as::<_, BranchRow>("SELECT * FROM branches WHERE repo_id = ? ORDER BY is_default DESC, name")
        .bind(repo_id)
        .fetch_all(pool)
        .await
        .map_err(db)?)
}

pub async fn get_branch(
    pool: &AnyPool,
    repo_id: &str,
    branch_id: &str,
) -> ModelResult<BranchRow> {
    sqlx::query_as::<_, BranchRow>("SELECT * FROM branches WHERE id = ? AND repo_id = ?")
        .bind(branch_id)
        .bind(repo_id)
        .fetch_optional(pool)
        .await
        .map_err(db)?
        .ok_or_else(|| ModelError::NotFound(format!("branch {branch_id} not found")))
}

pub async fn find_branch(pool: &AnyPool, repo_id: &str, ident: &str) -> ModelResult<BranchRow> {
    if let Some(row) = sqlx::query_as::<_, BranchRow>(
        "SELECT * FROM branches WHERE id = ? AND repo_id = ?",
    )
    .bind(ident)
    .bind(repo_id)
    .fetch_optional(pool)
    .await
    .map_err(db)?
    {
        return Ok(row);
    }
    sqlx::query_as::<_, BranchRow>("SELECT * FROM branches WHERE repo_id = ? AND name = ?")
        .bind(repo_id)
        .bind(ident)
        .fetch_optional(pool)
        .await
        .map_err(db)?
        .ok_or_else(|| ModelError::NotFound(format!("branch `{ident}` not found")))
}

fn valid_branch_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub async fn create_branch(
    pool: &AnyPool,
    repo_id: &str,
    name: &str,
    from: &BranchFrom,
) -> ModelResult<BranchRow> {
    if !valid_branch_name(name) {
        return Err(ModelError::Bad(
            "invalid branch name (use letters, digits, `-`, `_`, `.`)".into(),
        ));
    }
    let now = now_millis();
    let head_commit: Option<String> = match from {
        BranchFrom::Default => {
            let repo = get_repo(pool, repo_id).await?;
            match repo.head_branch_id {
                Some(bid) => get_branch(pool, repo_id, &bid).await?.head_commit_id,
                None => None,
            }
        }
        BranchFrom::Branch(b) => find_branch(pool, repo_id, b).await?.head_commit_id,
        BranchFrom::Commit(c) => {
            let commit = get_commit(pool, repo_id, c).await?;
            commit.map(|c| c.id)
        }
    };
    let snapshot = match &head_commit {
        Some(cid) => commit_snapshot(pool, cid).await?,
        None => empty_snapshot(),
    };
    let tree = serde_json::to_string(&snapshot)?;
    let branch_id = new_id();
    sqlx::query(
        "INSERT INTO branches (id, repo_id, name, head_commit_id, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&branch_id)
    .bind(repo_id)
    .bind(name.trim())
    .bind(&head_commit)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(dbe) if dbe.is_unique_violation() => {
            ModelError::Bad(format!("branch `{name}` already exists"))
        }
        other => ModelError::Db(other),
    })?;
    sqlx::query(
        "INSERT INTO working_trees (repo_id, branch_id, base_commit_id, tree_json, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(repo_id)
    .bind(&branch_id)
    .bind(&head_commit)
    .bind(&tree)
    .bind(now)
    .execute(pool)
    .await
    .map_err(db)?;
    get_branch(pool, repo_id, &branch_id).await
}

pub async fn checkout_branch(pool: &AnyPool, repo_id: &str, branch_id: &str) -> ModelResult<RepoRow> {
    let branch = get_branch(pool, repo_id, branch_id).await?;
    ensure_working_tree(pool, repo_id, &branch).await?;
    sqlx::query("UPDATE repos SET head_branch_id = ?, updated_at = ? WHERE id = ?")
        .bind(&branch.id)
        .bind(now_millis())
        .bind(repo_id)
        .execute(pool)
        .await
        .map_err(db)?;
    get_repo(pool, repo_id).await
}

pub async fn delete_branch(pool: &AnyPool, repo_id: &str, branch_id: &str) -> ModelResult<()> {
    let branch = get_branch(pool, repo_id, branch_id).await?;
    if branch.is_default {
        return Err(ModelError::Bad(
            "cannot delete the default branch".into(),
        ));
    }
    let repo = get_repo(pool, repo_id).await?;
    if repo.head_branch_id.as_deref() == Some(branch.id.as_str()) {
        return Err(ModelError::Bad(
            "cannot delete the currently checked out branch".into(),
        ));
    }
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("DELETE FROM working_trees WHERE repo_id = ? AND branch_id = ?")
        .bind(repo_id)
        .bind(&branch.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM branches WHERE id = ?")
        .bind(&branch.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Working tree
// ---------------------------------------------------------------------------

pub async fn working_branch(pool: &AnyPool, repo_id: &str) -> ModelResult<BranchRow> {
    let repo = get_repo(pool, repo_id).await?;
    let Some(bid) = repo.head_branch_id else {
        return Err(ModelError::Bad("repository has no checked out branch".into()));
    };
    get_branch(pool, repo_id, &bid).await
}

async fn get_working_row(pool: &AnyPool, repo_id: &str, branch_id: &str) -> ModelResult<Option<(String, Option<String>)>> {
    Ok(sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT tree_json, base_commit_id FROM working_trees WHERE repo_id = ? AND branch_id = ?",
    )
    .bind(repo_id)
    .bind(branch_id)
    .fetch_optional(pool)
    .await
    .map_err(db)?)
}

pub async fn ensure_working_tree(
    pool: &AnyPool,
    repo_id: &str,
    branch: &BranchRow,
) -> ModelResult<Snapshot> {
    if let Some((tree_json, _)) = get_working_row(pool, repo_id, &branch.id).await? {
        return Ok(serde_json::from_str(&tree_json)?);
    }
    let snapshot = match &branch.head_commit_id {
        Some(cid) => commit_snapshot(pool, cid).await?,
        None => empty_snapshot(),
    };
    save_working_tree(pool, repo_id, &branch.id, &snapshot).await?;
    Ok(snapshot)
}

pub async fn get_working_tree(pool: &AnyPool, repo_id: &str) -> ModelResult<Snapshot> {
    let branch = working_branch(pool, repo_id).await?;
    ensure_working_tree(pool, repo_id, &branch).await
}

pub async fn save_working_tree(
    pool: &AnyPool,
    repo_id: &str,
    branch_id: &str,
    snapshot: &Snapshot,
) -> ModelResult<()> {
    let now = now_millis();
    let tree = serde_json::to_string(snapshot)?;
    let base = get_working_row(pool, repo_id, branch_id)
        .await?
        .and_then(|(_, b)| b);
    let res = sqlx::query(
        "UPDATE working_trees SET tree_json = ?, base_commit_id = ?, updated_at = ? WHERE repo_id = ? AND branch_id = ?",
    )
    .bind(&tree)
    .bind(&base)
    .bind(now)
    .bind(repo_id)
    .bind(branch_id)
    .execute(pool)
    .await
    .map_err(db)?;
    if res.rows_affected() == 0 {
        sqlx::query(
            "INSERT INTO working_trees (repo_id, branch_id, base_commit_id, tree_json, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(repo_id)
        .bind(branch_id)
        .bind(&base)
        .bind(&tree)
        .bind(now)
        .execute(pool)
        .await
        .map_err(db)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

pub async fn list_artifacts(
    pool: &AnyPool,
    repo_id: &str,
    kind: Option<&str>,
) -> ModelResult<Vec<(String, Value)>> {
    let snapshot = get_working_tree(pool, repo_id).await?;
    Ok(snapshot
        .into_iter()
        .filter(|(key, _)| match kind {
            Some(k) => key.starts_with(&format!("{k}:")),
            None => true,
        })
        .collect())
}

pub async fn get_artifact(
    pool: &AnyPool,
    repo_id: &str,
    kind: &str,
    key: &str,
) -> ModelResult<Option<Value>> {
    let snapshot = get_working_tree(pool, repo_id).await?;
    Ok(snapshot.get(&artifact_key(kind, key)).cloned())
}

pub async fn upsert_artifact(
    pool: &AnyPool,
    repo_id: &str,
    kind: &str,
    key: &str,
    body: Value,
) -> ModelResult<Value> {
    if !ALL_KINDS.contains(&kind) {
        return Err(ModelError::Bad(format!(
            "unknown artifact kind `{kind}`; expected one of {:?}",
            ALL_KINDS
        )));
    }
    if key.trim().is_empty() {
        return Err(ModelError::Bad("artifact key must not be empty".into()));
    }
    let mut snapshot = get_working_tree(pool, repo_id).await?;
    snapshot.insert(artifact_key(kind, key), body.clone());
    let issues = validation::validate_snapshot(&snapshot);
    if validation::has_errors(&issues) {
        return Err(ModelError::Validation { issues });
    }
    let branch = working_branch(pool, repo_id).await?;
    save_working_tree(pool, repo_id, &branch.id, &snapshot).await?;
    Ok(body)
}

pub async fn delete_artifact(
    pool: &AnyPool,
    repo_id: &str,
    kind: &str,
    key: &str,
) -> ModelResult<Option<Value>> {
    let mut snapshot = get_working_tree(pool, repo_id).await?;
    let removed = snapshot.remove(&artifact_key(kind, key));
    let branch = working_branch(pool, repo_id).await?;
    save_working_tree(pool, repo_id, &branch.id, &snapshot).await?;
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

pub async fn create_commit(
    pool: &AnyPool,
    repo_id: &str,
    message: &str,
    author: &str,
) -> ModelResult<CommitRow> {
    let message = message.trim();
    if message.is_empty() {
        return Err(ModelError::Bad("commit message must not be empty".into()));
    }
    let branch = working_branch(pool, repo_id).await?;
    let snapshot = get_working_tree(pool, repo_id).await?;
    let issues = validation::validate_snapshot(&snapshot);
    if validation::has_errors(&issues) {
        return Err(ModelError::Validation { issues });
    }
    let now = now_millis();
    let commit_id = new_id();
    let tree = serde_json::to_string(&snapshot)?;
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query(
        "INSERT INTO commits (id, repo_id, branch_id, message, author, parent_commit_id, parent2_commit_id, tree_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(&commit_id)
    .bind(repo_id)
    .bind(&branch.id)
    .bind(message)
    .bind(author)
    .bind(&branch.head_commit_id)
    .bind(&tree)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("UPDATE branches SET head_commit_id = ?, updated_at = ? WHERE id = ?")
        .bind(&commit_id)
        .bind(now)
        .bind(&branch.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "UPDATE working_trees SET base_commit_id = ?, updated_at = ? WHERE repo_id = ? AND branch_id = ?",
    )
    .bind(&commit_id)
    .bind(now)
    .bind(repo_id)
    .bind(&branch.id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("UPDATE repos SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    get_commit(pool, repo_id, &commit_id)
        .await?
        .ok_or_else(|| ModelError::Bad("commit vanished after insert".into()))
}

pub async fn list_commits(pool: &AnyPool, repo_id: &str) -> ModelResult<Vec<CommitDto>> {
    let rows = sqlx::query_as::<_, CommitRow>(
        "SELECT * FROM commits WHERE repo_id = ? ORDER BY created_at DESC",
    )
    .bind(repo_id)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    let branches = list_branches(pool, repo_id).await?;
    let mut by_head: std::collections::HashMap<String, Vec<String>> = Default::default();
    for b in branches {
        if let Some(h) = b.head_commit_id {
            by_head.entry(h).or_default().push(b.name);
        }
    }
    rows.into_iter()
        .map(|row| {
            CommitDto::from_row(
                row.clone(),
                by_head.get(&row.id).cloned().unwrap_or_default(),
            )
            .map_err(|e| ModelError::Bad(format!("corrupt commit row: {e}")))
        })
        .collect()
}

pub async fn get_commit(
    pool: &AnyPool,
    repo_id: &str,
    commit_id: &str,
) -> ModelResult<Option<CommitRow>> {
    Ok(sqlx::query_as::<_, CommitRow>(
        "SELECT * FROM commits WHERE id = ? AND repo_id = ?",
    )
    .bind(commit_id)
    .bind(repo_id)
    .fetch_optional(pool)
    .await
    .map_err(db)?)
}

async fn get_commit_global(pool: &AnyPool, commit_id: &str) -> ModelResult<Option<CommitRow>> {
    Ok(sqlx::query_as::<_, CommitRow>("SELECT * FROM commits WHERE id = ?")
        .bind(commit_id)
        .fetch_optional(pool)
        .await
        .map_err(db)?)
}

pub async fn commit_snapshot(pool: &AnyPool, commit_id: &str) -> ModelResult<Snapshot> {
    let commit = get_commit_global(pool, commit_id)
        .await?
        .ok_or_else(|| ModelError::NotFound(format!("commit {commit_id} not found")))?;
    Ok(serde_json::from_str(&commit.tree_json)?)
}

pub async fn reset_to_commit(
    pool: &AnyPool,
    repo_id: &str,
    commit_id: &str,
) -> ModelResult<CommitRow> {
    let commit = get_commit(pool, repo_id, commit_id)
        .await?
        .ok_or_else(|| ModelError::NotFound(format!("commit {commit_id} not found")))?;
    let branch = working_branch(pool, repo_id).await?;
    let snapshot = commit_snapshot(pool, &commit.id).await?;
    let now = now_millis();
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("UPDATE branches SET head_commit_id = ?, updated_at = ? WHERE id = ?")
        .bind(&commit.id)
        .bind(now)
        .bind(&branch.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let tree = serde_json::to_string(&snapshot)?;
    sqlx::query(
        "UPDATE working_trees SET tree_json = ?, base_commit_id = ?, updated_at = ? WHERE repo_id = ? AND branch_id = ?",
    )
    .bind(&tree)
    .bind(&commit.id)
    .bind(now)
    .bind(repo_id)
    .bind(&branch.id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("UPDATE repos SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(commit)
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefSpec {
    Working,
    Head,
    Branch(String),
    Commit(String),
}

pub async fn resolve_ref(pool: &AnyPool, repo_id: &str, spec: &str) -> ModelResult<RefSpec> {
    match spec {
        "working" | "WORKING" => Ok(RefSpec::Working),
        "head" | "HEAD" => Ok(RefSpec::Head),
        other => {
            if let Some(rest) = other
                .strip_prefix("HEAD~")
                .or_else(|| other.strip_prefix("head~"))
            {
                if let Ok(n) = rest.parse::<usize>() {
                    let branch = working_branch(pool, repo_id).await?;
                    let mut id = branch
                        .head_commit_id
                        .ok_or_else(|| ModelError::Bad("HEAD has no commits".into()))?;
                    for _ in 0..n {
                        let Some(c) = get_commit_global(pool, &id).await? else {
                            break;
                        };
                        let Some(p) = c.parent_commit_id else {
                            break;
                        };
                        id = p;
                    }
                    return Ok(RefSpec::Commit(id));
                }
            }
            if find_branch(pool, repo_id, other).await.is_ok() {
                return Ok(RefSpec::Branch(other.to_string()));
            }
            if get_commit(pool, repo_id, other).await?.is_some() {
                return Ok(RefSpec::Commit(other.to_string()));
            }
            Err(ModelError::Bad(format!(
                "unknown ref `{other}` (expected working, head, a branch name, or a commit id)"
            )))
        }
    }
}

pub async fn snapshot_for_ref(
    pool: &AnyPool,
    repo_id: &str,
    spec: &RefSpec,
) -> ModelResult<Snapshot> {
    match spec {
        RefSpec::Working => get_working_tree(pool, repo_id).await,
        RefSpec::Head => {
            let branch = working_branch(pool, repo_id).await?;
            match branch.head_commit_id {
                Some(cid) => commit_snapshot(pool, &cid).await,
                None => Ok(empty_snapshot()),
            }
        }
        RefSpec::Branch(name) => {
            let branch = find_branch(pool, repo_id, name).await?;
            match branch.head_commit_id {
                Some(cid) => commit_snapshot(pool, &cid).await,
                None => Ok(empty_snapshot()),
            }
        }
        RefSpec::Commit(cid) => commit_snapshot(pool, cid).await,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub key: String,
    pub status: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub unified: String,
}

pub fn diff_snapshots(a: &Snapshot, b: &Snapshot) -> Vec<Change> {
    let keys: BTreeSet<String> = a.keys().chain(b.keys()).cloned().collect();
    let mut changes = Vec::new();
    for key in keys {
        let before = a.get(&key).cloned();
        let after = b.get(&key).cloned();
        let status = if before.is_none() {
            "added"
        } else if after.is_none() {
            "removed"
        } else if before != after {
            "modified"
        } else {
            continue;
        };
        let unified = unified_diff(&key, before.as_ref(), after.as_ref());
        changes.push(Change {
            key,
            status: status.into(),
            before,
            after,
            unified,
        });
    }
    changes
}

fn unified_diff(key: &str, before: Option<&Value>, after: Option<&Value>) -> String {
    let a = before
        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
        .unwrap_or_default();
    let b = after
        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
        .unwrap_or_default();
    let diff = similar::TextDiff::from_lines(&a, &b);
    let mut out = format!("--- {key}\n+++ {key}\n");
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            similar::ChangeTag::Delete => "-",
            similar::ChangeTag::Insert => "+",
            _ => " ",
        };
        out.push_str(sign);
        out.push_str(change.value());
        if !change.value().ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Merge (three-way, artifact level)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    pub merged: bool,
    pub commit_id: Option<String>,
    pub message: Option<String>,
    pub conflicts: Vec<String>,
}

pub async fn merge_branch(
    pool: &AnyPool,
    repo_id: &str,
    from_ident: &str,
    message: &str,
    author: &str,
) -> ModelResult<MergeOutcome> {
    let current = working_branch(pool, repo_id).await?;
    let incoming = find_branch(pool, repo_id, from_ident).await?;
    if incoming.id == current.id {
        return Err(ModelError::Bad("cannot merge a branch into itself".into()));
    }
    let Some(ours) = current.head_commit_id.clone() else {
        return Err(ModelError::Bad("current branch has no commits".into()));
    };
    let Some(theirs) = incoming.head_commit_id.clone() else {
        return Err(ModelError::Bad("source branch has no commits".into()));
    };

    let work = get_working_tree(pool, repo_id).await?;
    let head_snap = commit_snapshot(pool, &ours).await?;
    if work != head_snap {
        return Err(ModelError::Bad(
            "working tree has uncommitted changes; commit or reset before merging".into(),
        ));
    }

    let base_id = merge_base(pool, &ours, &theirs).await?;
    let base_snap = commit_snapshot(pool, &base_id).await?;
    let ours_snap = commit_snapshot(pool, &ours).await?;
    let theirs_snap = commit_snapshot(pool, &theirs).await?;
    let (merged, conflicts) = three_way_merge(&base_snap, &ours_snap, &theirs_snap);
    if !conflicts.is_empty() {
        return Ok(MergeOutcome {
            merged: false,
            commit_id: None,
            message: None,
            conflicts,
        });
    }

    let message = if message.trim().is_empty() {
        format!("Merge branch `{}` into `{}`", incoming.name, current.name)
    } else {
        message.trim().to_string()
    };
    let now = now_millis();
    let commit_id = new_id();
    let tree = serde_json::to_string(&merged)?;
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query(
        "INSERT INTO commits (id, repo_id, branch_id, message, author, parent_commit_id, parent2_commit_id, tree_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&commit_id)
    .bind(repo_id)
    .bind(&current.id)
    .bind(&message)
    .bind(author)
    .bind(&ours)
    .bind(&theirs)
    .bind(&tree)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("UPDATE branches SET head_commit_id = ?, updated_at = ? WHERE id = ?")
        .bind(&commit_id)
        .bind(now)
        .bind(&current.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "UPDATE working_trees SET tree_json = ?, base_commit_id = ?, updated_at = ? WHERE repo_id = ? AND branch_id = ?",
    )
    .bind(&tree)
    .bind(&commit_id)
    .bind(now)
    .bind(repo_id)
    .bind(&current.id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("UPDATE repos SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(repo_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(MergeOutcome {
        merged: true,
        commit_id: Some(commit_id),
        message: Some(message),
        conflicts: vec![],
    })
}

async fn merge_base(pool: &AnyPool, ours: &str, theirs: &str) -> ModelResult<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue = vec![ours.to_string()];
    while let Some(id) = queue.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(commit) = get_commit_global(pool, &id).await? {
            for p in [commit.parent_commit_id, commit.parent2_commit_id]
                .into_iter()
                .flatten()
            {
                queue.push(p);
            }
        }
    }
    let mut queue = vec![theirs.to_string()];
    while let Some(id) = queue.pop() {
        if seen.contains(&id) {
            return Ok(id);
        }
        if let Some(commit) = get_commit_global(pool, &id).await? {
            for p in [commit.parent_commit_id, commit.parent2_commit_id]
                .into_iter()
                .flatten()
            {
                queue.push(p);
            }
        }
    }
    Err(ModelError::Bad("no common ancestor found".into()))
}

fn three_way_merge(base: &Snapshot, ours: &Snapshot, theirs: &Snapshot) -> (Snapshot, Vec<String>) {
    let keys: BTreeSet<String> = base
        .keys()
        .chain(ours.keys())
        .chain(theirs.keys())
        .cloned()
        .collect();
    let mut merged = Snapshot::new();
    let mut conflicts = Vec::new();
    for key in keys {
        let b = base.get(&key);
        let o = ours.get(&key);
        let t = theirs.get(&key);
        let ours_changed = b != o;
        let theirs_changed = b != t;
        match (ours_changed, theirs_changed) {
            (false, false) => {
                if let Some(v) = o {
                    merged.insert(key, v.clone());
                }
            }
            (true, false) => {
                merged.insert(key, o.unwrap().clone());
            }
            (false, true) => {
                merged.insert(key, t.unwrap().clone());
            }
            (true, true) => {
                if o == t {
                    merged.insert(key, o.unwrap().clone());
                } else {
                    conflicts.push(key);
                }
            }
        }
    }
    (merged, conflicts)
}
