use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use ossie_studio::api::router;
use ossie_studio::db;
use ossie_studio::model::*;
use ossie_studio::vcs::{self, BranchFrom};
use serde_json::{json, Value};
use sqlx::any::AnyPoolOptions;
use sqlx::AnyPool;
use tower::ServiceExt;

async fn test_pool() -> AnyPool {
    sqlx::any::install_default_drivers();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("sqlite memory pool");
    db::init_schema(&pool).await.expect("schema init");
    pool
}

fn person(name: &str) -> Value {
    json!({ "name": name, "type": "EntityType" })
}

#[tokio::test]
async fn repo_lifecycle_commits_diff_reset_branch_merge() {
    let pool = test_pool().await;
    let repo = vcs::create_repo(&pool, "demo", Some("demo repo")).await.unwrap();

    let branches = vcs::list_branches(&pool, &repo.id).await.unwrap();
    assert_eq!(branches.len(), 1);
    assert!(branches[0].is_default);
    assert_eq!(branches[0].name, "main");

    let initial = vcs::list_commits(&pool, &repo.id).await.unwrap();
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].message, "Initial commit");

    vcs::upsert_artifact(&pool, &repo.id, KIND_CONCEPT, "Person", person("Person"))
        .await
        .unwrap();
    let c1 = vcs::create_commit(&pool, &repo.id, "add Person", "alice")
        .await
        .unwrap();

    vcs::upsert_artifact(
        &pool,
        &repo.id,
        KIND_CONCEPT,
        "Person",
        json!({ "name": "Person", "type": "EntityType", "description": "A natural person" }),
    )
    .await
    .unwrap();
    let c2 = vcs::create_commit(&pool, &repo.id, "identify Person by nr", "alice")
        .await
        .unwrap();

    assert_ne!(c1.id, c2.id);
    assert_eq!(c2.parent_commit_id.as_deref(), Some(c1.id.as_str()));

    let a = vcs::commit_snapshot(&pool, &c1.id).await.unwrap();
    let b = vcs::commit_snapshot(&pool, &c2.id).await.unwrap();
    let changes = vcs::diff_snapshots(&a, &b);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].status, "modified");
    assert!(changes[0].unified.contains("description"));

    vcs::reset_to_commit(&pool, &repo.id, &c1.id).await.unwrap();
    let work = vcs::get_working_tree(&pool, &repo.id).await.unwrap();
    assert_eq!(
        work.get(&artifact_key(KIND_CONCEPT, "Person"))
            .unwrap()
            .get("identify_by"),
        None
    );

    // Branch from current head (c1), add Employee, commit.
    let feat = vcs::create_branch(&pool, &repo.id, "feature", &BranchFrom::Default)
        .await
        .unwrap();
    vcs::checkout_branch(&pool, &repo.id, &feat.id).await.unwrap();
    vcs::upsert_artifact(
        &pool,
        &repo.id,
        KIND_CONCEPT,
        "Employee",
        json!({ "name": "Employee", "type": "EntityType", "extends": ["Person"] }),
    )
    .await
    .unwrap();
    vcs::create_commit(&pool, &repo.id, "add Employee", "bob").await.unwrap();

    // Merge feature back into main.
    let main = vcs::list_branches(&pool, &repo.id)
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.is_default)
        .unwrap();
    vcs::checkout_branch(&pool, &repo.id, &main.id).await.unwrap();
    let outcome = vcs::merge_branch(&pool, &repo.id, "feature", "", "alice")
        .await
        .unwrap();
    assert!(outcome.merged, "merge should succeed: {:?}", outcome.conflicts);
    let work = vcs::get_working_tree(&pool, &repo.id).await.unwrap();
    assert!(work.contains_key(&artifact_key(KIND_CONCEPT, "Employee")));
    let head = vcs::working_branch(&pool, &repo.id).await.unwrap();
    let head_commit = vcs::get_commit(&pool, &repo.id, &head.head_commit_id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(head_commit.parent2_commit_id.is_some(), "merge commit has two parents");
}

#[tokio::test]
async fn invalid_artifact_is_rejected() {
    let pool = test_pool().await;
    let repo = vcs::create_repo(&pool, "strict", None).await.unwrap();
    let res = vcs::upsert_artifact(
        &pool,
        &repo.id,
        KIND_CONCEPT,
        "Bad",
        json!({ "name": "Bad", "type": "Nope" }),
    )
    .await;
    assert!(res.is_err());
    match res {
        Err(vcs::ModelError::Validation { issues }) => {
            assert!(validation_has(issues, "Nope"));
        }
        _ => panic!("expected validation error"),
    }
}

fn validation_has(issues: Vec<Issue>, needle: &str) -> bool {
    issues.iter().any(|i| i.message.contains(needle))
}

#[tokio::test]
async fn api_smoke_create_repo_artifact_commit_diff() {
    let pool = test_pool().await;
    let app = router(pool);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/repos")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"api-demo"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let repo: Value = serde_json::from_slice(&body).unwrap();
    let repo_id = repo["id"].as_str().unwrap().to_string();

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/repos/{repo_id}/artifacts"))
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"kind":"concept","key":"Person","body":{"name":"Person","type":"EntityType"}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/repos/{repo_id}/commits"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"message":"person model","author":"tester"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/repos/{repo_id}/diff?from=head&to=working"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/repos/{repo_id}/semantic/preview?schema=analytics"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let preview: Value = serde_json::from_slice(&body).unwrap();
    assert!(preview["sql"].as_str().unwrap().contains("CREATE TABLE"));
}

#[tokio::test]
async fn import_export_round_trip_via_api() {
    let pool = test_pool().await;
    let repo = vcs::create_repo(&pool, "roundtrip", None).await.unwrap();
    let app = router(pool);

    let yaml = r#"
version: "0.2.0.dev0"
name: demo
ontology:
  - concept: Person
    type: EntityType
    identify_by: [nr]
    relationships:
      - name: nr
        roles:
          - concept: SSN
        multiplicity: OneToOne
        verbalizes: ["{Person} is identified by {SSN}"]
  - concept: SSN
    type: ValueType
    extends: [String]
semantic_model:
  - name: demo
    datasets:
      - name: persons
        source: hr.persons
        primary_key: [id]
        fields:
          - name: id
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: id
    relationships: []
    metrics: []
"#;
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/repos/{}/import", repo.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "format": "yaml", "content": yaml }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let imported: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(imported["imported"], 4);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/repos/{}/export?format=json", repo.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let doc: Value = serde_json::from_slice(&body).unwrap();
    assert!(doc["ontology"].as_array().unwrap().len() >= 2);
    assert!(doc["semantic_model"][0]["datasets"].as_array().unwrap().len() == 1);
}
