//! Purpose: Axum HTTP service for trust summaries and Rust-side advisory boundary checks.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/axum/latest/axum/
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//! - https://docs.rs/tokio/latest/tokio/
//! - https://docs.rs/tower-http/latest/tower_http/trace/
//!
//! Tests:
//! - cargo test --workspace

use axum::{
    Json, Router,
    extract::State,
    http::Request,
    routing::{get, post},
};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_policy::{AdvisoryBoundary, AdvisoryTrustSummary};
use humanify_proto::RiskDecision;
use std::time::Duration;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::TraceLayer;
use tracing::Span;

const GOVERNING_DOCS: &[&str] = &[
    "AGENTS.md",
    "Implementation Plan.txt",
    "docs\\reference-baseline.md",
    "docs\\contracts.md",
    "docs\\observability-security.md",
];

const UPSTREAM_DOCS: &[&str] = &[
    "https://docs.rs/axum/latest/axum/",
    "https://docs.rs/axum/latest/axum/struct.Json.html",
    "https://docs.rs/tokio/latest/tokio/",
    "https://docs.rs/tower-http/latest/tower_http/trace/",
];

const DESCRIPTOR: ServiceDescriptor = ServiceDescriptor::new(
    "trust-rs",
    "HUMANIFY_TRUST_RS_BIND_ADDR",
    4104,
    true,
    &[
        "advisory trust summaries",
        "Rust-side safety boundary checks",
        "health and service metadata",
    ],
    GOVERNING_DOCS,
    UPSTREAM_DOCS,
);

#[derive(Clone)]
struct AppState {
    descriptor: ServiceDescriptor,
    boundary: AdvisoryBoundary,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing(DESCRIPTOR.name);

    let state = AppState { descriptor: DESCRIPTOR.clone(), boundary: AdvisoryBoundary::default() };
    let listener = tokio::net::TcpListener::bind(DESCRIPTOR.bind_address()?).await?;

    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/service-info", get(service_info))
        .route("/internal/trust/decision-summary", post(decision_summary))
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

async fn decision_summary(
    State(state): State<AppState>,
    Json(decision): Json<RiskDecision>,
) -> Json<AdvisoryTrustSummary> {
    Json(state.boundary.summarize(&decision))
}

#[cfg(test)]
mod tests {
    use super::{AppState, DESCRIPTOR, app};
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use humanify_policy::AdvisoryBoundary;
    use humanify_proto::{Action, RiskDecision};
    use tower::util::ServiceExt;

    fn state() -> AppState {
        AppState { descriptor: DESCRIPTOR.clone(), boundary: AdvisoryBoundary::default() }
    }

    #[tokio::test]
    async fn trust_endpoint_clamps_actions() {
        let request_body = serde_json::to_vec(&RiskDecision {
            user_id: "user_123".to_string(),
            guild_id: "guild_123".to_string(),
            score: 10,
            confidence: 0.98,
            reason_codes: vec!["mention_burst".to_string()],
            recommended_action: Action::Ban,
            evidence_refs: vec!["evi_123".to_string()],
            expires_at: None,
        })
        .expect("request should serialize");

        let response = app(state())
            .oneshot(
                Request::post("/internal/trust/decision-summary")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["recommendedAction"], "ban");
        assert_eq!(value["clampedAction"], "quarantine");
    }
}
