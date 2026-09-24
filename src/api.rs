use crate::ddl::generate_semantic_ddl;
use crate::export::{self, OSSIE_VERSION};
use crate::model::*;
use crate::platform;
use crate::release;
use crate::validation;
use crate::vcs::{self, BranchFrom, ModelError};
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::AnyPool;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: AnyPool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    Bad(String),
    #[error("{0}")]
    NotFound(String),
    #[error("validation failed")]
    Validation { issues: Vec<Issue> },
    #[error("{0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            ApiError::Bad(msg) => (StatusCode::BAD_REQUEST, json!({ "error": msg })),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, json!({ "error": msg })),
            ApiError::Validation { issues } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "error": "validation failed", "issues": issues }),
            ),
            ApiError::Internal(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": msg }))
            }
        };
        (status, Json(body)).into_response()
    }
}

impl From<ModelError> for ApiError {
    fn from(err: ModelError) -> Self {
        match err {
            ModelError::Bad(msg) => ApiError::Bad(msg),
            ModelError::Validation { issues } => ApiError::Validation { issues },
            ModelError::NotFound(msg) => ApiError::NotFound(msg),
            ModelError::Db(e) => ApiError::Internal(format!("database error: {e}")),
            ModelError::Json(e) => ApiError::Internal(format!("json error: {e}")),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(format!("{err:#}"))
    }
}

type ApiResult<T> = Result<T, ApiError>;

// ---------------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectReq {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tenant_id: Option<String>,
}

#[derive(Deserialize)]
struct TenantQuery {
    #[serde(default)]
    tenant: Option<String>,
}

impl TenantQuery {
    fn resolve(&self) -> String {
        self.tenant
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(crate::platform::DEFAULT_TENANT)
            .to_string()
    }
}

#[derive(Deserialize)]
struct CreateTenantReq {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize)]
struct SettingsReq {
    values: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseReq {
    environment: String,
    #[serde(default)]
    commit_id: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default = "default_author")]
    author: String,
}

#[derive(Deserialize)]
struct ReleasedQuery {
    #[serde(default)]
    environment: Option<String>,
    #[serde(default)]
    format: Option<String>,
}

#[derive(Deserialize)]
struct CreateBranchReq {
    name: String,
    #[serde(default)]
    from: Option<String>,
}

#[derive(Deserialize)]
struct CommitReq {
    message: String,
    #[serde(default = "default_author")]
    author: String,
}

#[derive(Deserialize)]
struct DiffQuery {
    #[serde(default = "default_diff_from")]
    from: String,
    #[serde(default = "default_diff_to")]
    to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetReq {
    commit_id: String,
}

#[derive(Deserialize)]
struct MergeReq {
    from: String,
    message: String,
    #[serde(default = "default_author")]
    author: String,
}

#[derive(Deserialize)]
struct UpsertArtifactReq {
    kind: String,
    key: String,
    body: Value,
}

#[derive(Deserialize)]
struct ImportReq {
    format: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployReq {
    connection_url: String,
    #[serde(default)]
    schema: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployToSourceReq {
    data_source_id: String,
    #[serde(default)]
    schema: Option<String>,
}

#[derive(Deserialize)]
struct ListArtifactsQuery {
    kind: Option<String>,
}

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default)]
    format: Option<String>,
}

#[derive(Deserialize)]
struct PreviewQuery {
    #[serde(default)]
    schema: Option<String>,
}

fn default_author() -> String {
    "anonymous".into()
}
fn default_diff_from() -> String {
    "head".into()
}
fn default_diff_to() -> String {
    "working".into()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactView {
    kind: String,
    key: String,
    body: Value,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkingView {
    project: ProjectRow,
    branch: BranchRow,
    base_commit_id: Option<String>,
    artifacts: Vec<ArtifactView>,
    issues: Vec<Issue>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffView {
    from: String,
    to: String,
    changes: Vec<vcs::Change>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidateView {
    valid: bool,
    issues: Vec<Issue>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportView {
    imported: usize,
    issues: Vec<Issue>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployView {
    applied: bool,
    statements: usize,
    sql: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(pool: AnyPool) -> Router {
    let state = AppState { pool };
    let api = Router::new()
        .route("/api/health", get(health))
        .route(
            "/api/projects",
            get(list_projects).post(create_project),
        )
        .route(
            "/api/projects/{project_id}",
            get(get_project).delete(delete_project),
        )
        .route(
            "/api/projects/{project_id}/branches",
            get(list_branches).post(create_branch),
        )
        .route(
            "/api/projects/{project_id}/branches/{branch_id}",
            delete(delete_branch),
        )
        .route(
            "/api/projects/{project_id}/branches/{branch_id}/checkout",
            post(checkout_branch),
        )
        .route("/api/projects/{project_id}/working", get(get_working))
        .route(
            "/api/projects/{project_id}/artifacts",
            get(list_artifacts).post(upsert_artifact),
        )
        .route(
            "/api/projects/{project_id}/artifacts/{kind}/{key}",
            get(get_artifact)
                .put(update_artifact)
                .delete(delete_artifact),
        )
        .route(
            "/api/projects/{project_id}/commits",
            get(list_commits).post(create_commit),
        )
        .route("/api/projects/{project_id}/commits/{commit_id}", get(get_commit))
        .route("/api/projects/{project_id}/diff", get(diff))
        .route("/api/projects/{project_id}/reset", post(reset))
        .route("/api/projects/{project_id}/merge", post(merge))
        .route("/api/projects/{project_id}/validate", get(validate))
        .route("/api/projects/{project_id}/export", get(export))
        .route("/api/projects/{project_id}/import", post(import))
        .route(
            "/api/projects/{project_id}/semantic/preview",
            get(semantic_preview),
        )
        .route(
            "/api/projects/{project_id}/semantic/deploy",
            post(semantic_deploy),
        )
        .route(
            "/api/projects/{project_id}/semantic/deploy-to-source",
            post(semantic_deploy_to_source),
        )
        // ---- platform: tenants / data sources / settings ----
        .route("/api/tenants", get(list_tenants).post(create_tenant))
        .route("/api/tenants/{tenant_id}", delete(delete_tenant))
        .route(
            "/api/data-sources",
            get(list_data_sources).post(create_data_source),
        )
        .route(
            "/api/data-sources/{data_source_id}",
            put(update_data_source).delete(delete_data_source),
        )
        .route(
            "/api/data-sources/{data_source_id}/test",
            post(test_data_source),
        )
        .route("/api/settings", get(get_settings).put(put_settings))
        // ---- version release (dev/prod boundary, design-ouline §1.5) ----
        .route(
            "/api/projects/{project_id}/releases",
            get(list_releases).post(create_release),
        )
        .route(
            "/api/projects/{project_id}/releases/{release_id}",
            delete(delete_release),
        )
        .route("/api/projects/{project_id}/released", get(released_document))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let dist = PathBuf::from("frontend/dist");
    if dist.join("index.html").exists() {
        api.fallback_service(
            ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html"))),
        )
    } else {
        api
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "spec": OSSIE_VERSION,
        "storage": "sqlite or postgres"
    }))
}

async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectReq>,
) -> ApiResult<(StatusCode, Json<ProjectRow>)> {
    let tenant = req
        .tenant_id
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or(platform::DEFAULT_TENANT);
    let project = vcs::create_project_scoped(
        &state.pool,
        tenant,
        &req.name,
        req.description.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(project)))
}

async fn list_projects(
    State(state): State<AppState>,
    Query(q): Query<TenantQuery>,
) -> ApiResult<Json<Vec<ProjectRow>>> {
    Ok(Json(
        vcs::list_projects_scoped(&state.pool, &q.resolve()).await?,
    ))
}

// ---------------------------------------------------------------------------
// Platform handlers: tenants / data sources / settings
// ---------------------------------------------------------------------------

async fn list_tenants(State(state): State<AppState>) -> ApiResult<Json<Vec<platform::TenantRow>>> {
    Ok(Json(platform::list_tenants(&state.pool).await?))
}

async fn create_tenant(
    State(state): State<AppState>,
    Json(req): Json<CreateTenantReq>,
) -> ApiResult<(StatusCode, Json<platform::TenantRow>)> {
    let tenant =
        platform::create_tenant(&state.pool, &req.name, req.description.as_deref()).await?;
    Ok((StatusCode::CREATED, Json(tenant)))
}

async fn delete_tenant(
    State(state): State<AppState>,
    Path(tenant_id): Path<String>,
) -> ApiResult<Json<Value>> {
    platform::delete_tenant(&state.pool, &tenant_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn list_data_sources(
    State(state): State<AppState>,
    Query(q): Query<TenantQuery>,
) -> ApiResult<Json<Vec<platform::DataSourceRow>>> {
    Ok(Json(
        platform::list_data_sources(&state.pool, &q.resolve()).await?,
    ))
}

async fn create_data_source(
    State(state): State<AppState>,
    Query(q): Query<TenantQuery>,
    Json(input): Json<platform::DataSourceInput>,
) -> ApiResult<(StatusCode, Json<platform::DataSourceRow>)> {
    let row = platform::create_data_source(&state.pool, &q.resolve(), &input).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn update_data_source(
    State(state): State<AppState>,
    Path(data_source_id): Path<String>,
    Json(input): Json<platform::DataSourceInput>,
) -> ApiResult<Json<platform::DataSourceRow>> {
    Ok(Json(
        platform::update_data_source(&state.pool, &data_source_id, &input).await?,
    ))
}

async fn delete_data_source(
    State(state): State<AppState>,
    Path(data_source_id): Path<String>,
) -> ApiResult<Json<Value>> {
    platform::delete_data_source(&state.pool, &data_source_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn test_data_source(
    State(state): State<AppState>,
    Path(data_source_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let row = platform::get_data_source(&state.pool, &data_source_id).await?;
    match platform::test_connection_url(&row.connection_url()).await {
        Ok(()) => Ok(Json(json!({ "ok": true, "message": "连接成功" }))),
        Err(err) => Ok(Json(json!({ "ok": false, "message": err }))),
    }
}

async fn get_settings(
    State(state): State<AppState>,
    Query(q): Query<TenantQuery>,
) -> ApiResult<Json<Value>> {
    let tenant = q.resolve();
    let values = platform::get_settings(&state.pool, &tenant).await?;
    Ok(Json(json!({ "tenantId": tenant, "values": values })))
}

async fn put_settings(
    State(state): State<AppState>,
    Query(q): Query<TenantQuery>,
    Json(req): Json<SettingsReq>,
) -> ApiResult<Json<Value>> {
    let tenant = q.resolve();
    let values = platform::put_settings(&state.pool, &tenant, &req.values).await?;
    Ok(Json(json!({ "tenantId": tenant, "values": values })))
}

// ---------------------------------------------------------------------------
// Releases: the read side of the model (consumers never touch the working tree)
// ---------------------------------------------------------------------------

async fn list_releases(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<Vec<release::ReleaseRow>>> {
    Ok(Json(release::list_releases(&state.pool, &project_id).await?))
}

async fn create_release(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<ReleaseReq>,
) -> ApiResult<(StatusCode, Json<release::ReleaseRow>)> {
    let commit_id = match req.commit_id.as_deref().filter(|c| !c.trim().is_empty()) {
        Some(explicit) => {
            if vcs::get_commit(&state.pool, &project_id, explicit).await?.is_none() {
                return Err(ApiError::Bad(format!("commit `{explicit}` not found")));
            }
            explicit.to_string()
        }
        None => {
            let branch = vcs::working_branch(&state.pool, &project_id).await?;
            branch.head_commit_id.ok_or_else(|| {
                ApiError::Bad("current branch has no commit to release".into())
            })?
        }
    };

    // Gate: the released snapshot must be structurally valid (layer-1 errors).
    let snapshot = vcs::commit_snapshot(&state.pool, &commit_id).await?;
    let issues = validation::validate_snapshot(&snapshot);
    if validation::has_errors(&issues) {
        return Err(ApiError::Validation { issues });
    }

    let row = release::publish(
        &state.pool,
        &project_id,
        &req.environment,
        &commit_id,
        req.message.as_deref(),
        &req.author,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_release(
    State(state): State<AppState>,
    Path((_project_id, release_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    release::delete_release(&state.pool, &release_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

/// Returns the OSSIE document currently published to an environment — the only
/// model consumers should read.
async fn released_document(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<ReleasedQuery>,
) -> ApiResult<Response> {
    let environment = q
        .environment
        .as_deref()
        .filter(|e| !e.trim().is_empty())
        .unwrap_or(release::DEFAULT_ENVIRONMENT);
    let Some(row) = release::latest_release(&state.pool, &project_id, environment).await? else {
        return Err(ApiError::NotFound(format!(
            "no release published to `{environment}`"
        )));
    };
    let project = vcs::get_project(&state.pool, &project_id).await?;
    let snapshot = vcs::commit_snapshot(&state.pool, &row.commit_id).await?;
    let doc = export::snapshot_to_doc(&snapshot, &project.name, project.description.as_deref());

    let format = q.format.as_deref().unwrap_or("yaml");
    let (content_type, body) = if format == "json" {
        ("application/json", export::to_json(&doc)?)
    } else {
        ("application/yaml", export::to_yaml(&doc)?)
    };
    let mut response = body.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        content_type.parse().map_err(|_| {
            ApiError::Internal("failed to build content type".into())
        })?,
    );
    response.headers_mut().insert(
        "x-ossie-release",
        row.id.parse().map_err(|_| {
            ApiError::Internal("failed to build release header".into())
        })?,
    );
    response.headers_mut().insert(
        "x-ossie-commit",
        row.commit_id.parse().map_err(|_| {
            ApiError::Internal("failed to build commit header".into())
        })?,
    );
    Ok(response)
}

async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<ProjectRow>> {
    Ok(Json(vcs::get_project(&state.pool, &project_id).await?))
}

async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<Value>> {
    vcs::delete_project(&state.pool, &project_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn list_branches(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<Vec<BranchRow>>> {
    Ok(Json(vcs::list_branches(&state.pool, &project_id).await?))
}

async fn parse_branch_from(
    pool: &AnyPool,
    project_id: &str,
    raw: Option<&str>,
) -> ApiResult<BranchFrom> {
    let Some(raw) = raw else {
        return Ok(BranchFrom::Default);
    };
    if let Some(id) = raw.strip_prefix("commit:") {
        if vcs::get_commit(pool, project_id, id).await?.is_some() {
            return Ok(BranchFrom::Commit(id.to_string()));
        }
        return Err(ApiError::Bad(format!("commit `{id}` not found")));
    }
    if let Some(name) = raw.strip_prefix("branch:") {
        if vcs::find_branch(pool, project_id, name).await.is_ok() {
            return Ok(BranchFrom::Branch(name.to_string()));
        }
        return Err(ApiError::Bad(format!("branch `{name}` not found")));
    }
    // Bare string: prefer an existing branch, then a commit id.
    if vcs::find_branch(pool, project_id, raw).await.is_ok() {
        return Ok(BranchFrom::Branch(raw.to_string()));
    }
    if vcs::get_commit(pool, project_id, raw).await?.is_some() {
        return Ok(BranchFrom::Commit(raw.to_string()));
    }
    Err(ApiError::Bad(format!(
        "unknown `from` ref `{raw}` (branch name, commit id, or `commit:<id>`)"
    )))
}

async fn create_branch(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<CreateBranchReq>,
) -> ApiResult<(StatusCode, Json<BranchRow>)> {
    let from = parse_branch_from(&state.pool, &project_id, req.from.as_deref()).await?;
    let branch = vcs::create_branch(&state.pool, &project_id, &req.name, &from).await?;
    Ok((StatusCode::CREATED, Json(branch)))
}

async fn delete_branch(
    State(state): State<AppState>,
    Path((project_id, branch_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    vcs::delete_branch(&state.pool, &project_id, &branch_id).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn checkout_branch(
    State(state): State<AppState>,
    Path((project_id, branch_id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let project = vcs::checkout_branch(&state.pool, &project_id, &branch_id).await?;
    let Some(bid) = project.head_branch_id.as_ref() else {
        return Err(ApiError::Bad("checkout produced no head branch".into()));
    };
    let branch = vcs::get_branch(&state.pool, &project_id, bid).await?;
    Ok(Json(json!({ "project": project, "branch": branch })))
}

async fn get_working(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<WorkingView>> {
    let project = vcs::get_project(&state.pool, &project_id).await?;
    let branch = vcs::working_branch(&state.pool, &project_id).await?;
    let snapshot = vcs::get_working_tree(&state.pool, &project_id).await?;
    let base_commit_id = branch.head_commit_id.clone();
    let artifacts = snapshot
        .iter()
        .map(|(key, body)| {
            let (kind, key) = split_artifact_key(key)
                .map(|(k, n)| (k.to_string(), n.to_string()))
                .unwrap_or_else(|| (String::new(), key.clone()));
            ArtifactView {
                kind,
                key,
                body: body.clone(),
            }
        })
        .collect();
    let issues = validation::validate_snapshot(&snapshot);
    Ok(Json(WorkingView {
        project,
        branch,
        base_commit_id,
        artifacts,
        issues,
    }))
}

async fn list_artifacts(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<ListArtifactsQuery>,
) -> ApiResult<Json<Vec<ArtifactView>>> {
    let artifacts = vcs::list_artifacts(&state.pool, &project_id, q.kind.as_deref())
        .await?
        .into_iter()
        .map(|(key, body)| {
            let (kind, key) = split_artifact_key(&key)
                .map(|(k, n)| (k.to_string(), n.to_string()))
                .unwrap_or_else(|| (String::new(), key));
            ArtifactView { kind, key, body }
        })
        .collect();
    Ok(Json(artifacts))
}

async fn upsert_artifact(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<UpsertArtifactReq>,
) -> ApiResult<(StatusCode, Json<ArtifactView>)> {
    let body = vcs::upsert_artifact(&state.pool, &project_id, &req.kind, &req.key, req.body).await?;
    Ok((
        StatusCode::CREATED,
        Json(ArtifactView {
            kind: req.kind,
            key: req.key,
            body,
        }),
    ))
}

async fn get_artifact(
    State(state): State<AppState>,
    Path((project_id, kind, key)): Path<(String, String, String)>,
) -> ApiResult<Json<ArtifactView>> {
    let body = vcs::get_artifact(&state.pool, &project_id, &kind, &key)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("artifact {kind}:{key} not found")))?;
    Ok(Json(ArtifactView { kind, key, body }))
}

async fn update_artifact(
    State(state): State<AppState>,
    Path((project_id, kind, key)): Path<(String, String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<Json<ArtifactView>> {
    let body = vcs::upsert_artifact(&state.pool, &project_id, &kind, &key, body).await?;
    Ok(Json(ArtifactView { kind, key, body }))
}

async fn delete_artifact(
    State(state): State<AppState>,
    Path((project_id, kind, key)): Path<(String, String, String)>,
) -> ApiResult<Json<Value>> {
    let removed = vcs::delete_artifact(&state.pool, &project_id, &kind, &key).await?;
    Ok(Json(json!({ "deleted": removed.is_some() })))
}

async fn create_commit(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<CommitReq>,
) -> ApiResult<(StatusCode, Json<CommitDto>)> {
    let row = vcs::create_commit(&state.pool, &project_id, &req.message, &req.author).await?;
    let dto = commit_dto(&state.pool, &project_id, &row.id).await?;
    Ok((StatusCode::CREATED, Json(dto)))
}

async fn list_commits(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<Vec<CommitDto>>> {
    Ok(Json(vcs::list_commits(&state.pool, &project_id).await?))
}

async fn get_commit(
    State(state): State<AppState>,
    Path((project_id, commit_id)): Path<(String, String)>,
) -> ApiResult<Json<CommitDto>> {
    Ok(Json(commit_dto(&state.pool, &project_id, &commit_id).await?))
}

async fn commit_dto(pool: &AnyPool, project_id: &str, commit_id: &str) -> ApiResult<CommitDto> {
    let row = vcs::get_commit(pool, project_id, commit_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("commit {commit_id} not found")))?;
    let branches = vcs::list_branches(pool, project_id)
        .await?
        .into_iter()
        .filter(|b| b.head_commit_id.as_deref() == Some(commit_id))
        .map(|b| b.name)
        .collect();
    CommitDto::from_row(row, branches).map_err(|e| ApiError::Internal(format!("{e}")))
}

async fn diff(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<DiffQuery>,
) -> ApiResult<Json<DiffView>> {
    let from_spec = vcs::resolve_ref(&state.pool, &project_id, &q.from).await?;
    let to_spec = vcs::resolve_ref(&state.pool, &project_id, &q.to).await?;
    let a = vcs::snapshot_for_ref(&state.pool, &project_id, &from_spec).await?;
    let b = vcs::snapshot_for_ref(&state.pool, &project_id, &to_spec).await?;
    Ok(Json(DiffView {
        from: q.from,
        to: q.to,
        changes: vcs::diff_snapshots(&a, &b),
    }))
}

async fn reset(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<ResetReq>,
) -> ApiResult<Json<CommitDto>> {
    let row = vcs::reset_to_commit(&state.pool, &project_id, &req.commit_id).await?;
    Ok(Json(commit_dto(&state.pool, &project_id, &row.id).await?))
}

async fn merge(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<MergeReq>,
) -> ApiResult<Json<vcs::MergeOutcome>> {
    Ok(Json(
        vcs::merge_branch(&state.pool, &project_id, &req.from, &req.message, &req.author).await?,
    ))
}

async fn validate(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> ApiResult<Json<ValidateView>> {
    let snapshot = vcs::get_working_tree(&state.pool, &project_id).await?;
    let issues = validation::validate_snapshot(&snapshot);
    Ok(Json(ValidateView {
        valid: !validation::has_errors(&issues),
        issues,
    }))
}

async fn export(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<ExportQuery>,
) -> ApiResult<Response> {
    let project = vcs::get_project(&state.pool, &project_id).await?;
    let snapshot = vcs::get_working_tree(&state.pool, &project_id).await?;
    let doc = export::snapshot_to_doc(&snapshot, &project.name, project.description.as_deref());
    let format = q.format.unwrap_or_else(|| "yaml".into());
    let (body, content_type) = match format.as_str() {
        "json" => (export::to_json(&doc)?, "application/json".to_string()),
        _ => (export::to_yaml(&doc)?, "application/x-yaml".to_string()),
    };
    Ok((
        [(header::CONTENT_TYPE, content_type)],
        body,
    )
        .into_response())
}

async fn import(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<ImportReq>,
) -> ApiResult<Json<ImportView>> {
    let doc = export::parse_doc(&req.content, &req.format)
        .map_err(|e| ApiError::Bad(format!("cannot parse document: {e}")))?;
    let snapshot = export::doc_to_snapshot(&doc)
        .map_err(|e| ApiError::Bad(format!("invalid Ossie document: {e}")))?;
    let issues = validation::validate_snapshot(&snapshot);
    let imported = snapshot.len();
    let branch = vcs::working_branch(&state.pool, &project_id).await?;
    vcs::save_working_tree(&state.pool, &project_id, &branch.id, &snapshot).await?;
    Ok(Json(ImportView { imported, issues }))
}

async fn semantic_preview(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(q): Query<PreviewQuery>,
) -> ApiResult<Json<Value>> {
    let snapshot = vcs::get_working_tree(&state.pool, &project_id).await?;
    let ddl = generate_semantic_ddl(&snapshot, q.schema.as_deref().unwrap_or("public"));
    Ok(Json(json!({
        "sql": ddl.sql,
        "statements": ddl.statements,
    })))
}

async fn semantic_deploy(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<DeployReq>,
) -> ApiResult<Json<DeployView>> {
    let schema = req.schema.as_deref().unwrap_or("public").to_string();
    let (ddl, statements) = semantic_deployment(&state.pool, &project_id, &schema).await?;
    let applied = apply_ddl(&req.connection_url, &ddl.statements).await?;
    Ok(Json(DeployView {
        applied,
        statements,
        sql: ddl.sql,
    }))
}

/// Deploys the semantic layer through a registered PostgreSQL data source, so
/// connection coordinates stay on the platform instead of the request body.
async fn semantic_deploy_to_source(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<DeployToSourceReq>,
) -> ApiResult<Json<DeployView>> {
    let source = platform::get_data_source(&state.pool, &req.data_source_id).await?;
    let schema = req
        .schema
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&source.default_schema)
        .to_string();
    let (ddl, statements) = semantic_deployment(&state.pool, &project_id, &schema).await?;
    let applied = apply_ddl(&source.connection_url(), &ddl.statements).await?;
    Ok(Json(DeployView {
        applied,
        statements,
        sql: ddl.sql,
    }))
}

async fn semantic_deployment(
    pool: &AnyPool,
    project_id: &str,
    schema: &str,
) -> ApiResult<(crate::ddl::GeneratedDdl, usize)> {
    let snapshot = vcs::get_working_tree(pool, project_id).await?;
    let issues = validation::validate_snapshot(&snapshot);
    if validation::has_errors(&issues) {
        return Err(ApiError::Validation { issues });
    }
    let ddl = generate_semantic_ddl(&snapshot, schema);
    let statements = ddl.statements.len();
    Ok((ddl, statements))
}

async fn apply_ddl(connection_url: &str, statements: &[String]) -> ApiResult<bool> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect(connection_url)
        .await
        .map_err(|e| ApiError::Bad(format!("cannot connect to PostgreSQL: {e}")))?;
    let mut tx = pool.begin().await.map_err(|e| ApiError::Internal(e.to_string()))?;
    for stmt in statements {
        if stmt.trim_start().starts_with("--") {
            continue;
        }
        sqlx::query(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Bad(format!("DDL failed: {e}\nstatement: {stmt}")))?;
    }
    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    pool.close().await;
    Ok(true)
}
