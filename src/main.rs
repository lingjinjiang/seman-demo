use anyhow::Result;
use ossie_studio::{api, db};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug".into()),
        )
        .init();

    let db_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:ossie.db".to_string());
    let pool = db::connect(&db_url).await?;
    tracing::info!(
        "connected to storage: {} ({})",
        db_url,
        db::backend_name(&db_url)
    );

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let app = api::router(pool);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!("Ossie Studio listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}
