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

use axum::{Json, Router, extract::State, http::Request, routing::get};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_evidence::EvidenceCapabilities;
use std::time::Duration;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::TraceLayer;
use tracing::Span;

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
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request<_>| {
                    let request_id = request
                        .headers()
                        .get("x-request-id")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("absent");
                    let traceparent = request
                        .headers()
                        .get("traceparent")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("absent");

                    tracing::info_span!(
                        "http.request",
                        service = DESCRIPTOR.name,
                        method = %request.method(),
                        path = %request.uri().path(),
                        request_id = %request_id,
                        traceparent = %traceparent
                    )
                })
                .on_request(())
                .on_response(|response: &axum::http::Response<_>, latency: Duration, span: &Span| {
                    tracing::info!(
                        parent: span,
                        latency_ms = latency.as_secs_f64() * 1000.0,
                        status = response.status().as_u16(),
                        "request completed"
                    );
                })
                .on_failure(|failure: ServerErrorsFailureClass, latency: Duration, span: &Span| {
                    tracing::error!(
                        parent: span,
                        classification = %failure,
                        latency_ms = latency.as_secs_f64() * 1000.0,
                        "request failed"
                    );
                }),
        )
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
