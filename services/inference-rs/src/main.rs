//! Purpose: Axum HTTP service for advisory Bun→Rust inference scoring.
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
    routing::{get, post},
};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_inference::InferenceService;
use humanify_proto::{InferenceRequest, InferenceResponse};
use tower_http::trace::TraceLayer;

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
    "inference-rs",
    "HUMANIFY_INFERENCE_RS_BIND_ADDR",
    4101,
    true,
    &[
        "advisory Bun↔Rust inference scoring",
        "contract-aligned JSON request handling",
        "health and service metadata",
    ],
    GOVERNING_DOCS,
    UPSTREAM_DOCS,
);

#[derive(Clone)]
struct AppState {
    descriptor: ServiceDescriptor,
    service: InferenceService,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing(DESCRIPTOR.name);

    let state = AppState { descriptor: DESCRIPTOR.clone(), service: InferenceService::default() };
    let listener = tokio::net::TcpListener::bind(DESCRIPTOR.bind_address()?).await?;

    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/service-info", get(service_info))
        .route("/v1/inference/score", post(score))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health(State(state): State<AppState>) -> Json<humanify_core::HealthReport> {
    Json(state.descriptor.health_report())
}

async fn service_info(State(state): State<AppState>) -> Json<humanify_core::ServiceInfo> {
    Json(state.descriptor.service_info())
}

async fn score(
    State(state): State<AppState>,
    Json(request): Json<InferenceRequest>,
) -> Json<InferenceResponse> {
    Json(state.service.score_request(&request))
}

#[cfg(test)]
mod tests {
    use super::{AppState, DESCRIPTOR, app};
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use humanify_inference::InferenceService;
    use humanify_proto::{
        ContainmentAction, EventKind, FeatureSnapshot, InferenceEvent, InferenceRequest,
        ScoringPolicyInput, ServerSensitivity,
    };
    use tower::util::ServiceExt;

    fn state() -> AppState {
        AppState { descriptor: DESCRIPTOR.clone(), service: InferenceService::default() }
    }

    #[tokio::test]
    async fn score_endpoint_returns_contract_json() {
        let request_body = serde_json::to_vec(&InferenceRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "req_123".to_string(),
            guild_id: "guild_123".to_string(),
            subject_user_id: "user_123".to_string(),
            event: InferenceEvent {
                kind: EventKind::Message,
                occurred_at: "2026-01-15T18:42:11Z".to_string(),
            },
            features: FeatureSnapshot {
                account_age_hours: 2,
                joined_age_minutes: 1,
                has_avatar: false,
                has_banner: false,
                first_message_delay_seconds: Some(8),
                message_text_hash: Some("blake3:abc".to_string()),
                normalized_domains: vec!["disc0rd-gifts.example".to_string()],
                invite_code_hash: Some("blake3:def".to_string()),
                mention_count_last_minute: 7,
                duplicate_message_count: 3,
            },
            evidence_refs: vec!["evi_123".to_string()],
            policy_input: ScoringPolicyInput {
                server_sensitivity: ServerSensitivity::Balanced,
                preferred_containment_action: ContainmentAction::Quarantine,
                suspicious_role_ids: Vec::new(),
                trusted_role_ids: Vec::new(),
                enabled_signal_families: vec![
                    "account".to_string(),
                    "profile".to_string(),
                    "message".to_string(),
                    "behavior".to_string(),
                    "domain".to_string(),
                ],
                allow_cross_server_signals: true,
            },
        })
        .expect("request should serialize");

        let response = app(state())
            .oneshot(
                Request::post("/v1/inference/score")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), axum::http::StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["requestId"], "req_123");
        assert_eq!(value["decision"]["recommendedAction"], "quarantine");
    }
}
