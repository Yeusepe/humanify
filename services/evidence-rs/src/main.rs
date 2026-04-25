//! Purpose: Axum HTTP service for evidence-processing metadata and hashing/normalization capabilities.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\data-platform.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/axum/latest/axum/
//! - https://docs.rs/tokio/latest/tokio/
//! - https://docs.rs/tower-http/latest/tower_http/trace/
//! - https://docs.rs/image/latest/image/
//! - https://docs.rs/fast_image_resize/latest/fast_image_resize/
//!
//! Tests:
//! - cargo test --workspace

use axum::{Json, Router, extract::State, routing::get};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_evidence::EvidenceCapabilities;
use tower_http::trace::TraceLayer;

const GOVERNING_DOCS: &[&str] = &[
    "AGENTS.md",
    "Implementation Plan.txt",
    "docs\\reference-baseline.md",
    "docs\\data-platform.md",
    "docs\\observability-security.md",
];

const UPSTREAM_DOCS: &[&str] = &[
    "https://docs.rs/axum/latest/axum/",
    "https://docs.rs/tokio/latest/tokio/",
    "https://docs.rs/tower-http/latest/tower_http/trace/",
    "https://docs.rs/image/latest/image/",
    "https://docs.rs/fast_image_resize/latest/fast_image_resize/",
];

const DESCRIPTOR: ServiceDescriptor = ServiceDescriptor::new(
    "evidence-rs",
    "HUMANIFY_EVIDENCE_RS_BIND_ADDR",
    4103,
    true,
    &[
        "evidence hashing and normalization helpers",
        "image-processing capability metadata",
        "health and service metadata",
    ],
    GOVERNING_DOCS,
    UPSTREAM_DOCS,
);

#[derive(Clone)]
struct AppState {
    descriptor: ServiceDescriptor,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing(DESCRIPTOR.name);

    let state = AppState { descriptor: DESCRIPTOR.clone() };
    let listener = tokio::net::TcpListener::bind(DESCRIPTOR.bind_address()?).await?;

    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/service-info", get(service_info))
        .route("/internal/evidence/capabilities", get(capabilities))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health(State(state): State<AppState>) -> Json<humanify_core::HealthReport> {
    Json(state.descriptor.health_report())
}

async fn service_info(State(state): State<AppState>) -> Json<humanify_core::ServiceInfo> {
    Json(state.descriptor.service_info())
}

async fn capabilities() -> Json<EvidenceCapabilities> {
    Json(humanify_evidence::capabilities())
}

#[cfg(test)]
mod tests {
    use super::{AppState, DESCRIPTOR, app};
    use axum::{body::to_bytes, http::Request};
    use tower::util::ServiceExt;

    fn state() -> AppState {
        AppState { descriptor: DESCRIPTOR.clone() }
    }

    #[tokio::test]
    async fn evidence_capabilities_endpoint_reports_algorithms() {
        let response = app(state())
            .oneshot(
                Request::get("/internal/evidence/capabilities")
                    .body(axum::body::Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["resizeAlgorithm"], "convolution_catmull_rom");
    }
}
