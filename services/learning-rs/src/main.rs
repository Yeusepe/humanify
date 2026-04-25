//! Purpose: Axum HTTP service for moderator-outcome learning ingestion.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\data-platform.md
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
    routing::{get, post},
};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_learning::{LearningIngestSummary, LearningService};
use humanify_proto::CaseOutcome;
use tower_http::trace::TraceLayer;

const GOVERNING_DOCS: &[&str] = &[
    "AGENTS.md",
    "Implementation Plan.txt",
    "docs\\reference-baseline.md",
    "docs\\contracts.md",
    "docs\\data-platform.md",
];

const UPSTREAM_DOCS: &[&str] = &[
    "https://docs.rs/axum/latest/axum/",
    "https://docs.rs/axum/latest/axum/struct.Json.html",
    "https://docs.rs/tokio/latest/tokio/",
    "https://docs.rs/tower-http/latest/tower_http/trace/",
];

const DESCRIPTOR: ServiceDescriptor = ServiceDescriptor::new(
    "learning-rs",
    "HUMANIFY_LEARNING_RS_BIND_ADDR",
    4102,
    true,
    &[
        "moderator-outcome learning ingestion",
        "candidate learned-signal derivation",
        "health and service metadata",
    ],
    GOVERNING_DOCS,
    UPSTREAM_DOCS,
);

#[derive(Clone)]
struct AppState {
    descriptor: ServiceDescriptor,
    service: LearningService,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing(DESCRIPTOR.name);

    let state = AppState { descriptor: DESCRIPTOR.clone(), service: LearningService };
    let listener = tokio::net::TcpListener::bind(DESCRIPTOR.bind_address()?).await?;

    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/service-info", get(service_info))
        .route("/internal/learning/case-outcomes", post(ingest_case_outcome))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health(State(state): State<AppState>) -> Json<humanify_core::HealthReport> {
    Json(state.descriptor.health_report())
}

async fn service_info(State(state): State<AppState>) -> Json<humanify_core::ServiceInfo> {
    Json(state.descriptor.service_info())
}

async fn ingest_case_outcome(
    State(state): State<AppState>,
    Json(outcome): Json<CaseOutcome>,
) -> Json<LearningIngestSummary> {
    Json(state.service.ingest_case_outcome(&outcome))
}

#[cfg(test)]
mod tests {
    use super::{AppState, DESCRIPTOR, app};
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use humanify_learning::LearningService;
    use humanify_proto::{CaseOutcome, CaseOutcomeType};
    use tower::util::ServiceExt;

    fn state() -> AppState {
        AppState { descriptor: DESCRIPTOR.clone(), service: LearningService }
    }

    #[tokio::test]
    async fn learning_endpoint_accepts_case_outcomes() {
        let request_body = serde_json::to_vec(&CaseOutcome {
            case_id: "case_123".to_string(),
            guild_id: "guild_123".to_string(),
            subject_user_id_hash: "blake3:user_123".to_string(),
            outcome: CaseOutcomeType::ConfirmedScam,
            confidence: 0.92,
            decided_by: "mod_123".to_string(),
            decided_at: "2026-01-15T18:42:11Z".to_string(),
            reason_codes: vec!["malicious_domain_pattern".to_string()],
            evidence_refs: vec!["evi_123".to_string()],
        })
        .expect("request should serialize");

        let response = app(state())
            .oneshot(
                Request::post("/internal/learning/case-outcomes")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["caseId"], "case_123");
        assert_eq!(value["candidateSignals"][0]["type"], "text_similarity");
    }
}
