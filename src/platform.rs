// Platform-level objects that live outside a single model project:
// tenants (isolation boundary), PostgreSQL data sources and tenant settings.
//
// Anything that is environment-specific (host / port / credentials) belongs
// here — never inside an OSSIE document (design-ouline.md §2.6 下沉红线).

use crate::vcs::{now_millis, ModelError, ModelResult};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use std::collections::BTreeMap;
use uuid::Uuid;

pub const DEFAULT_TENANT: &str = "default";

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_tenants(pool: &AnyPool) -> ModelResult<Vec<TenantRow>> {
    Ok(sqlx::query_as::<_, TenantRow>(
        "SELECT * FROM tenants ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name",
    )
    .bind(DEFAULT_TENANT)
    .fetch_all(pool)
    .await?)
}

pub async fn get_tenant(pool: &AnyPool, id: &str) -> ModelResult<TenantRow> {
    sqlx::query_as::<_, TenantRow>("SELECT * FROM tenants WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ModelError::NotFound(format!("tenant {id} not found")))
}

pub async fn create_tenant(
    pool: &AnyPool,
    name: &str,
    description: Option<&str>,
) -> ModelResult<TenantRow> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ModelError::Bad("tenant name must not be empty".into()));
    }
    if name == DEFAULT_TENANT {
        return Err(ModelError::Bad("`default` is reserved".into()));
    }
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM tenants WHERE name = ?")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    if existing.is_some() {
        return Err(ModelError::Bad(format!("tenant `{name}` already exists")));
    }
    let id = new_id();
    let now = now_millis();
    sqlx::query(
        "INSERT INTO tenants (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(description)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_tenant(pool, &id).await
}

pub async fn delete_tenant(pool: &AnyPool, id: &str) -> ModelResult<()> {
    if id == DEFAULT_TENANT {
        return Err(ModelError::Bad("the default tenant cannot be deleted".into()));
    }
    let project_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects WHERE tenant_id = ?")
        .bind(id)
        .fetch_one(pool)
        .await?;
    if project_count.0 > 0 {
        return Err(ModelError::Bad(
            "tenant still owns model projects; delete them first".into(),
        ));
    }
    let affected = sqlx::query("DELETE FROM tenants WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(ModelError::NotFound(format!("tenant {id} not found")));
    }
    sqlx::query("DELETE FROM data_sources WHERE tenant_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM settings WHERE tenant_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Data sources (PostgreSQL only, for now)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    // Secrets never leave the platform: the API redacts it, the edit form
    // treats an empty value as "keep the stored password".
    #[serde(skip_serializing)]
    pub password: Option<String>,
    pub sslmode: String,
    pub default_schema: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceInput {
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: i64,
    pub database: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_sslmode")]
    pub sslmode: String,
    #[serde(default = "default_schema")]
    pub default_schema: String,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_kind() -> String {
    "postgres".into()
}
fn default_port() -> i64 {
    5432
}
fn default_sslmode() -> String {
    "prefer".into()
}
fn default_schema() -> String {
    "public".into()
}

impl DataSourceRow {
    /// Connection string built from the stored coordinates. This value never
    /// leaves the platform: it is not part of any OSSIE document.
    pub fn connection_url(&self) -> String {
        let user = urlencoding(&self.username);
        let password = self.password.as_deref().map(urlencoding).unwrap_or_default();
        let auth = if password.is_empty() {
            user
        } else {
            format!("{user}:{password}")
        };
        format!(
            "postgres://{auth}@{}:{}/{}?sslmode={}",
            self.host, self.port, self.database, self.sslmode
        )
    }
}

fn urlencoding(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub async fn list_data_sources(
    pool: &AnyPool,
    tenant_id: &str,
) -> ModelResult<Vec<DataSourceRow>> {
    Ok(sqlx::query_as::<_, DataSourceRow>(
        "SELECT * FROM data_sources WHERE tenant_id = ? ORDER BY name",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?)
}

pub async fn get_data_source(pool: &AnyPool, id: &str) -> ModelResult<DataSourceRow> {
    sqlx::query_as::<_, DataSourceRow>("SELECT * FROM data_sources WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ModelError::NotFound(format!("data source {id} not found")))
}

pub async fn create_data_source(
    pool: &AnyPool,
    tenant_id: &str,
    input: &DataSourceInput,
) -> ModelResult<DataSourceRow> {
    validate_data_source(input)?;
    ensure_unique_name(pool, tenant_id, &input.name, None).await?;
    let id = new_id();
    let now = now_millis();
    sqlx::query(
        "INSERT INTO data_sources
         (id, tenant_id, name, kind, host, port, database, username, password,
          sslmode, default_schema, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(input.name.trim())
    .bind(&input.kind)
    .bind(input.host.trim())
    .bind(input.port)
    .bind(input.database.trim())
    .bind(input.username.trim())
    .bind(input.password.as_deref())
    .bind(&input.sslmode)
    .bind(input.default_schema.trim())
    .bind(input.description.as_deref())
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    get_data_source(pool, &id).await
}

pub async fn update_data_source(
    pool: &AnyPool,
    id: &str,
    input: &DataSourceInput,
) -> ModelResult<DataSourceRow> {
    validate_data_source(input)?;
    let current = get_data_source(pool, id).await?;
    ensure_unique_name(pool, &current.tenant_id, &input.name, Some(id)).await?;
    // An empty password keeps the stored secret (edit forms never echo it).
    let password = match input.password.as_deref() {
        Some("") => current.password.clone(),
        other => other.map(str::to_string),
    };
    let now = now_millis();
    sqlx::query(
        "UPDATE data_sources SET name = ?, kind = ?, host = ?, port = ?, database = ?,
         username = ?, password = ?, sslmode = ?, default_schema = ?, description = ?,
         updated_at = ? WHERE id = ?",
    )
    .bind(input.name.trim())
    .bind(&input.kind)
    .bind(input.host.trim())
    .bind(input.port)
    .bind(input.database.trim())
    .bind(input.username.trim())
    .bind(password)
    .bind(&input.sslmode)
    .bind(input.default_schema.trim())
    .bind(input.description.as_deref())
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    get_data_source(pool, id).await
}

pub async fn delete_data_source(pool: &AnyPool, id: &str) -> ModelResult<()> {
    let affected = sqlx::query("DELETE FROM data_sources WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(ModelError::NotFound(format!("data source {id} not found")));
    }
    Ok(())
}

fn validate_data_source(input: &DataSourceInput) -> ModelResult<()> {
    let required = [
        ("name", input.name.trim()),
        ("host", input.host.trim()),
        ("database", input.database.trim()),
        ("username", input.username.trim()),
    ];
    for (label, value) in required {
        if value.is_empty() {
            return Err(ModelError::Bad(format!("{label} is required")));
        }
    }
    if !(1..=65535).contains(&input.port) {
        return Err(ModelError::Bad("port must be between 1 and 65535".into()));
    }
    if input.kind != "postgres" {
        return Err(ModelError::Bad(format!(
            "unsupported data source kind `{}` (only `postgres` is supported)",
            input.kind
        )));
    }
    Ok(())
}

async fn ensure_unique_name(
    pool: &AnyPool,
    tenant_id: &str,
    name: &str,
    ignore_id: Option<&str>,
) -> ModelResult<()> {
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM data_sources WHERE tenant_id = ? AND name = ?",
    )
    .bind(tenant_id)
    .bind(name.trim())
    .fetch_optional(pool)
    .await?;
    if let Some((id,)) = existing {
        if Some(id.as_str()) != ignore_id {
            return Err(ModelError::Bad(format!(
                "data source `{name}` already exists in this tenant"
            )));
        }
    }
    Ok(())
}

/// Opens a short-lived connection to prove the stored coordinates work.
pub async fn test_connection_url(url: &str) -> Result<(), String> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(url)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

pub async fn get_settings(pool: &AnyPool, tenant_id: &str) -> ModelResult<BTreeMap<String, String>> {
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM settings WHERE tenant_id = ? ORDER BY key")
            .bind(tenant_id)
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(k, v)| (k, v.unwrap_or_default()))
        .collect())
}

pub async fn put_settings(
    pool: &AnyPool,
    tenant_id: &str,
    values: &BTreeMap<String, String>,
) -> ModelResult<BTreeMap<String, String>> {
    let now = now_millis();
    let mut tx = pool.begin().await?;
    for (key, value) in values {
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        sqlx::query(
            "INSERT INTO settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(tenant_id)
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    get_settings(pool, tenant_id).await
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

    fn input(name: &str) -> DataSourceInput {
        DataSourceInput {
            name: name.into(),
            kind: "postgres".into(),
            host: "db.internal".into(),
            port: 5432,
            database: "warehouse".into(),
            username: "analyst".into(),
            password: Some("s3cr3t".into()),
            sslmode: "prefer".into(),
            default_schema: "public".into(),
            description: None,
        }
    }

    #[tokio::test]
    async fn default_tenant_is_seeded() {
        let pool = test_pool().await;
        let tenants = list_tenants(&pool).await.unwrap();
        assert_eq!(tenants.len(), 1);
        assert_eq!(tenants[0].id, DEFAULT_TENANT);
    }

    #[tokio::test]
    async fn data_source_lifecycle_and_tenant_isolation() {
        let pool = test_pool().await;
        let created = create_data_source(&pool, DEFAULT_TENANT, &input("warehouse"))
            .await
            .unwrap();
        assert_eq!(created.kind, "postgres");
        assert!(created.connection_url().starts_with("postgres://analyst:s3cr3t@"));

        // Duplicate name inside a tenant is rejected.
        assert!(create_data_source(&pool, DEFAULT_TENANT, &input("warehouse"))
            .await
            .is_err());

        // A second tenant is isolated from the first tenant's sources.
        let other = create_tenant(&pool, "acme", None).await.unwrap();
        assert!(list_data_sources(&pool, &other.id).await.unwrap().is_empty());
        assert_eq!(list_data_sources(&pool, DEFAULT_TENANT).await.unwrap().len(), 1);

        // Empty password on update keeps the stored secret.
        let mut edit = input("warehouse");
        edit.password = Some(String::new());
        edit.host = "db2.internal".into();
        let updated = update_data_source(&pool, &created.id, &edit).await.unwrap();
        assert_eq!(updated.host, "db2.internal");
        assert_eq!(updated.password.as_deref(), Some("s3cr3t"));

        delete_data_source(&pool, &created.id).await.unwrap();
        assert!(list_data_sources(&pool, DEFAULT_TENANT).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn settings_round_trip_per_tenant() {
        let pool = test_pool().await;
        let mut values = BTreeMap::new();
        values.insert("defaultAuthor".to_string(), "alice".to_string());
        put_settings(&pool, DEFAULT_TENANT, &values).await.unwrap();
        let read = get_settings(&pool, DEFAULT_TENANT).await.unwrap();
        assert_eq!(read.get("defaultAuthor").map(String::as_str), Some("alice"));
        // Another tenant sees its own (empty) settings.
        let other = create_tenant(&pool, "beta", None).await.unwrap();
        assert!(get_settings(&pool, &other.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn tenant_with_projects_cannot_be_deleted() {
        let pool = test_pool().await;
        let tenant = create_tenant(&pool, "gamma", None).await.unwrap();
        crate::vcs::create_project_scoped(&pool, &tenant.id, "retail", None)
            .await
            .unwrap();
        assert!(delete_tenant(&pool, &tenant.id).await.is_err());
        // The default tenant is always protected.
        assert!(delete_tenant(&pool, DEFAULT_TENANT).await.is_err());
    }
}
