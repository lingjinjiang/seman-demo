// Version release: an immutable pointer from an environment to a commit.
//
// This is the dev/prod boundary described in design-ouline.md §1.5: consumers
// (natural-language query, agents, BI, open APIs) read *released* snapshots and
// never the working tree or an arbitrary branch. Publishing is append-only —
// rolling back means publishing an older commit as a new record, so the audit
// trail is never rewritten.

use crate::vcs::{now_millis, ModelError, ModelResult};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use uuid::Uuid;

/// Environments a model can be published to.
pub const ENVIRONMENTS: [&str; 3] = ["dev", "test", "prod"];
pub const DEFAULT_ENVIRONMENT: &str = "prod";

pub fn is_known_environment(env: &str) -> bool {
    ENVIRONMENTS.contains(&env)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRow {
    pub id: String,
    pub repo_id: String,
    pub environment: String,
    pub commit_id: String,
    pub message: Option<String>,
    pub author: String,
    /// Per-repository monotonic sequence. `created_at` only has millisecond
    /// resolution, so two publishes in the same millisecond would otherwise be
    /// indistinguishable and "latest" would be undefined.
    pub seq: i64,
    pub created_at: i64,
}

/// All releases of a repository, newest first.
pub async fn list_releases(pool: &AnyPool, repo_id: &str) -> ModelResult<Vec<ReleaseRow>> {
    Ok(sqlx::query_as::<_, ReleaseRow>(
        "SELECT * FROM releases WHERE repo_id = ? ORDER BY seq DESC",
    )
    .bind(repo_id)
    .fetch_all(pool)
    .await?)
}

/// The release currently published to an environment (the consumer-facing view).
pub async fn latest_release(
    pool: &AnyPool,
    repo_id: &str,
    environment: &str,
) -> ModelResult<Option<ReleaseRow>> {
    Ok(sqlx::query_as::<_, ReleaseRow>(
        "SELECT * FROM releases WHERE repo_id = ? AND environment = ?
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(repo_id)
    .bind(environment)
    .fetch_optional(pool)
    .await?)
}

pub async fn get_release(pool: &AnyPool, id: &str) -> ModelResult<ReleaseRow> {
    sqlx::query_as::<_, ReleaseRow>("SELECT * FROM releases WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ModelError::NotFound(format!("release {id} not found")))
}

/// Publishes `commit_id` to `environment`, appending an immutable record.
pub async fn publish(
    pool: &AnyPool,
    repo_id: &str,
    environment: &str,
    commit_id: &str,
    message: Option<&str>,
    author: &str,
) -> ModelResult<ReleaseRow> {
    if !is_known_environment(environment) {
        return Err(ModelError::Bad(format!(
            "unknown environment `{environment}`; expected one of {ENVIRONMENTS:?}"
        )));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_millis();
    sqlx::query(
        "INSERT INTO releases (id, repo_id, environment, commit_id, message, author, seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM releases WHERE repo_id = ?), ?)",
    )
    .bind(&id)
    .bind(repo_id)
    .bind(environment)
    .bind(commit_id)
    .bind(message)
    .bind(author)
    .bind(repo_id)
    .bind(now)
    .execute(pool)
    .await?;
    get_release(pool, &id).await
}

/// Removes a release record. Deleting a record never deletes the commit.
pub async fn delete_release(pool: &AnyPool, id: &str) -> ModelResult<()> {
    let affected = sqlx::query("DELETE FROM releases WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(ModelError::NotFound(format!("release {id} not found")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::any::AnyPoolOptions;

    async fn test_pool() -> AnyPool {
        sqlx::any::install_default_drivers();
        let pool = AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("sqlite memory pool");
        crate::db::init_schema(&pool).await.expect("schema init");
        pool
    }

    #[tokio::test]
    async fn publish_is_append_only_and_latest_wins() {
        let pool = test_pool().await;
        let repo = crate::vcs::create_repo(&pool, "retail", None).await.unwrap();
        let head = repo.head_branch_id.clone().unwrap();
        let branch = crate::vcs::get_branch(&pool, &repo.id, &head).await.unwrap();
        let commit = branch.head_commit_id.clone().unwrap();

        assert!(latest_release(&pool, &repo.id, "prod").await.unwrap().is_none());

        let first = publish(&pool, &repo.id, "prod", &commit, Some("v1"), "alice")
            .await
            .unwrap();
        assert_eq!(first.environment, "prod");

        // Publishing again appends a record; history is preserved.
        publish(&pool, &repo.id, "prod", &commit, Some("v2"), "bob")
            .await
            .unwrap();
        let all = list_releases(&pool, &repo.id).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].message.as_deref(), Some("v2"));
        assert_eq!(
            latest_release(&pool, &repo.id, "prod")
                .await
                .unwrap()
                .unwrap()
                .message
                .as_deref(),
            Some("v2")
        );
        // Environments are independent pointers.
        assert!(latest_release(&pool, &repo.id, "dev").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn unknown_environment_is_rejected() {
        let pool = test_pool().await;
        let repo = crate::vcs::create_repo(&pool, "retail", None).await.unwrap();
        let err = publish(&pool, &repo.id, "staging", "c1", None, "alice").await;
        assert!(err.is_err());
    }
}
