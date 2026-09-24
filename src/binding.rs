// Project × environment bindings: the one place where data-access configuration
// differs *per project*.
//
// ⚠️ Experimental design — see `docs/design/access-control.md` §8. The
// granularity split (connection / credential / namespace) is expected to keep
// moving: credentials are still part of the connection, and per-logical-name
// bindings are not implemented yet. Do not treat this as a frozen contract.
//
// Rationale recap: a database is a department asset shared by many projects, so
// the *connection* lives at tenant level and is registered once; what genuinely
// differs per project is the credential and the namespace, so those live on the
// binding. The resolution chain stays:
//   dataset.source (logical name) -> binding(project, env) -> connection -> physical

use crate::vcs::{now_millis, ModelError, ModelResult};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use uuid::Uuid;

pub const ENVIRONMENTS: [&str; 3] = ["dev", "test", "prod"];

pub fn is_known_environment(environment: &str) -> bool {
    ENVIRONMENTS.contains(&environment)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BindingRow {
    pub id: String,
    pub project_id: String,
    pub environment: String,
    /// The tenant-level connection (`data_sources.id`).
    pub connection_id: String,
    /// Reserved: a reusable credential entity. `None` inherits the connection's
    /// credential. Not settable yet.
    pub credential_id: Option<String>,
    /// Default schema / catalog prefix for this project in this environment.
    pub namespace: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingInput {
    pub connection_id: String,
    #[serde(default)]
    pub credential_id: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
}

pub async fn list_bindings(pool: &AnyPool, project_id: &str) -> ModelResult<Vec<BindingRow>> {
    Ok(sqlx::query_as::<_, BindingRow>(
        "SELECT * FROM project_bindings WHERE project_id = ? ORDER BY environment",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?)
}

pub async fn get_binding(
    pool: &AnyPool,
    project_id: &str,
    environment: &str,
) -> ModelResult<Option<BindingRow>> {
    Ok(sqlx::query_as::<_, BindingRow>(
        "SELECT * FROM project_bindings WHERE project_id = ? AND environment = ?",
    )
    .bind(project_id)
    .bind(environment)
    .fetch_optional(pool)
    .await?)
}

/// Creates or replaces the binding for one environment.
pub async fn put_binding(
    pool: &AnyPool,
    project_id: &str,
    environment: &str,
    input: &BindingInput,
) -> ModelResult<BindingRow> {
    if !is_known_environment(environment) {
        return Err(ModelError::Bad(format!(
            "unknown environment `{environment}`; expected one of {ENVIRONMENTS:?}"
        )));
    }
    let connection_id = input.connection_id.trim();
    if connection_id.is_empty() {
        return Err(ModelError::Bad("connectionId is required".into()));
    }

    // The connection must exist and belong to the same tenant as the project —
    // otherwise a project could point at another tenant's database.
    let project = crate::vcs::get_project(pool, project_id).await?;
    let connection = crate::platform::get_data_source(pool, connection_id).await?;
    if connection.tenant_id != project.tenant_id {
        return Err(ModelError::Bad(
            "connection belongs to a different tenant than the project".into(),
        ));
    }

    let namespace = input
        .namespace
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&connection.default_schema)
        .to_string();

    let now = now_millis();
    match get_binding(pool, project_id, environment).await? {
        Some(existing) => {
            sqlx::query(
                "UPDATE project_bindings SET connection_id = ?, credential_id = ?, namespace = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(connection_id)
            .bind(input.credential_id.as_deref())
            .bind(&namespace)
            .bind(now)
            .bind(&existing.id)
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query(
                "INSERT INTO project_bindings
                 (id, project_id, environment, connection_id, credential_id, namespace, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(project_id)
            .bind(environment)
            .bind(connection_id)
            .bind(input.credential_id.as_deref())
            .bind(&namespace)
            .bind(now)
            .bind(now)
            .execute(pool)
            .await?;
        }
    }
    get_binding(pool, project_id, environment)
        .await?
        .ok_or_else(|| ModelError::NotFound("binding disappeared after write".into()))
}

pub async fn delete_binding(
    pool: &AnyPool,
    project_id: &str,
    environment: &str,
) -> ModelResult<()> {
    let affected = sqlx::query(
        "DELETE FROM project_bindings WHERE project_id = ? AND environment = ?",
    )
    .bind(project_id)
    .bind(environment)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(ModelError::NotFound(format!(
            "no binding for environment `{environment}`"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::DataSourceInput;
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

    fn connection(name: &str) -> DataSourceInput {
        DataSourceInput {
            name: name.into(),
            kind: "postgres".into(),
            host: "warehouse.internal".into(),
            port: 5432,
            database: "analytics".into(),
            username: "reader".into(),
            password: Some("pw".into()),
            sslmode: "prefer".into(),
            default_schema: "public".into(),
            description: None,
        }
    }

    #[tokio::test]
    async fn one_connection_serves_many_projects() {
        let pool = test_pool().await;
        let conn = crate::platform::create_data_source(
            &pool,
            crate::platform::DEFAULT_TENANT,
            &connection("warehouse"),
        )
        .await
        .unwrap();

        let a = crate::vcs::create_project(&pool, "sales", None).await.unwrap();
        let b = crate::vcs::create_project(&pool, "marketing", None)
            .await
            .unwrap();

        // Same connection, different namespaces — the shared-database shape.
        put_binding(
            &pool,
            &a.id,
            "prod",
            &BindingInput {
                connection_id: conn.id.clone(),
                credential_id: None,
                namespace: Some("sales".into()),
            },
        )
        .await
        .unwrap();
        put_binding(
            &pool,
            &b.id,
            "prod",
            &BindingInput {
                connection_id: conn.id.clone(),
                credential_id: None,
                namespace: Some("marketing".into()),
            },
        )
        .await
        .unwrap();

        let ba = get_binding(&pool, &a.id, "prod").await.unwrap().unwrap();
        let bb = get_binding(&pool, &b.id, "prod").await.unwrap().unwrap();
        assert_eq!(ba.connection_id, bb.connection_id);
        assert_eq!(ba.namespace, "sales");
        assert_eq!(bb.namespace, "marketing");
    }

    #[tokio::test]
    async fn binding_defaults_namespace_and_replaces() {
        let pool = test_pool().await;
        let conn = crate::platform::create_data_source(
            &pool,
            crate::platform::DEFAULT_TENANT,
            &connection("warehouse"),
        )
        .await
        .unwrap();
        let p = crate::vcs::create_project(&pool, "sales", None).await.unwrap();

        // Namespace omitted -> falls back to the connection's default schema.
        let first = put_binding(
            &pool,
            &p.id,
            "dev",
            &BindingInput {
                connection_id: conn.id.clone(),
                credential_id: None,
                namespace: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.namespace, "public");

        // Same environment -> replaced, not duplicated.
        let second = put_binding(
            &pool,
            &p.id,
            "dev",
            &BindingInput {
                connection_id: conn.id.clone(),
                credential_id: None,
                namespace: Some("sales_dev".into()),
            },
        )
        .await
        .unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(list_bindings(&pool, &p.id).await.unwrap().len(), 1);

        delete_binding(&pool, &p.id, "dev").await.unwrap();
        assert!(list_bindings(&pool, &p.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn binding_rejects_foreign_tenant_connection() {
        let pool = test_pool().await;
        let other = crate::platform::create_tenant(&pool, "acme", None).await.unwrap();
        let foreign = crate::platform::create_data_source(
            &pool,
            &other.id,
            &connection("acme-warehouse"),
        )
        .await
        .unwrap();
        let p = crate::vcs::create_project(&pool, "sales", None).await.unwrap();

        let err = put_binding(
            &pool,
            &p.id,
            "prod",
            &BindingInput {
                connection_id: foreign.id,
                credential_id: None,
                namespace: None,
            },
        )
        .await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn unknown_environment_is_rejected() {
        let pool = test_pool().await;
        let p = crate::vcs::create_project(&pool, "sales", None).await.unwrap();
        let err = put_binding(
            &pool,
            &p.id,
            "staging",
            &BindingInput {
                connection_id: "whatever".into(),
                credential_id: None,
                namespace: None,
            },
        )
        .await;
        assert!(err.is_err());
    }
}
