//! Purpose: Axum HTTP service for advisory Bun→Rust inference, embedding, and similarity work.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\data-platform.md
//! - docs\learning.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/axum/latest/axum/
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//! - https://docs.rs/tokio/latest/tokio/
//! - https://docs.rs/tower-http/latest/tower_http/trace/
//!
//! Tests:
//! - cargo test -p humanify-proto -p humanify-inference -p inference-rs

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use humanify_core::{ServiceDescriptor, init_tracing};
use humanify_inference::InferenceService;
use humanify_proto::{
    EmbedRequest, EmbedResponse, ImageClassificationRequest, ImageClassificationResponse,
    InferenceRequest, InferenceResponse, RerankRequest, RerankResponse, SimilarityRequest,
    SimilarityResponse,
};
use tower_http::trace::TraceLayer;

const GOVERNING_DOCS: &[&str] = &[
    "AGENTS.md",
    "Implementation Plan.txt",
    "docs\\reference-baseline.md",
    "docs\\contracts.md",
    "docs\\data-platform.md",
    "docs\\learning.md",
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
        "advisory Bun↔Rust risk scoring",
        "fastembed-backed text embeddings and similarity",
        "explicit image-classification capability status",
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
        .route("/v1/inference/classify/text", post(classify_text))
        .route("/v1/inference/classify/image", post(classify_image))
        .route("/v1/inference/embed", post(embed))
        .route("/v1/inference/similarity", post(similarity))
        .route("/v1/inference/rerank", post(rerank))
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

async fn classify_text(
    State(state): State<AppState>,
    Json(request): Json<InferenceRequest>,
) -> Json<InferenceResponse> {
    Json(state.service.score_request(&request))
}

async fn classify_image(
    State(state): State<AppState>,
    Json(request): Json<ImageClassificationRequest>,
) -> Json<ImageClassificationResponse> {
    Json(state.service.classify_image_request(&request))
}

async fn embed(
    State(state): State<AppState>,
    Json(request): Json<EmbedRequest>,
) -> Result<Json<EmbedResponse>, StatusCode> {
    state.service.embed_request(&request).map(Json).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

async fn similarity(
    State(state): State<AppState>,
    Json(request): Json<SimilarityRequest>,
) -> Result<Json<SimilarityResponse>, StatusCode> {
    state
        .service
        .similarity_request(&request)
        .map(Json)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

async fn rerank(
    State(state): State<AppState>,
    Json(request): Json<RerankRequest>,
) -> Result<Json<RerankResponse>, StatusCode> {
    state.service.rerank_request(&request).map(Json).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

#[cfg(test)]
mod tests {
    use super::{AppState, DESCRIPTOR, app};
    use axum::http::StatusCode;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use humanify_inference::{EmbeddingBatch, InferenceService, TextEmbeddingBackend};
    use humanify_proto::{
        CapabilityStatus, ContainmentAction, EmbedRequest, EventKind, FeatureSnapshot,
        ImageClassificationRequest, InferenceEvent, InferenceRequest, LearnedSignalCandidate,
        LearnedSignalType, RerankRequest, ScoringPolicyInput, ServerSensitivity, SimilarityRequest,
        TextEmbeddingPurpose, TextInput,
    };
    use std::sync::Arc;
    use tower::util::ServiceExt;

    #[derive(Debug)]
    struct DeterministicTextBackend;

    impl TextEmbeddingBackend for DeterministicTextBackend {
        fn backend_name(&self) -> &'static str {
            "deterministic-test"
        }

        fn embed_texts(
            &self,
            inputs: &[String],
            _purpose: TextEmbeddingPurpose,
        ) -> Result<EmbeddingBatch, String> {
            Ok(EmbeddingBatch {
                model_version: "deterministic-test/v1".to_string(),
                dimensions: 4,
                embeddings: inputs
                    .iter()
                    .map(|input| {
                        let lowercase = input.to_ascii_lowercase();
                        vec![
                            lowercase.len() as f32,
                            lowercase.matches("http").count() as f32 * 3.0,
                            lowercase.matches("nitro").count() as f32 * 4.0,
                            lowercase.matches("gift").count() as f32 * 4.0,
                        ]
                    })
                    .collect(),
            })
        }
    }

    fn state() -> AppState {
        AppState {
            descriptor: DESCRIPTOR.clone(),
            service: InferenceService::with_text_backend(Arc::new(DeterministicTextBackend)),
        }
    }

    fn learned_candidate(id: &str, text: &str) -> LearnedSignalCandidate {
        LearnedSignalCandidate {
            id: id.to_string(),
            kind: LearnedSignalType::TextSimilarity,
            reason_code: "similar_to_confirmed_scam_template".to_string(),
            source_case_ids: vec!["case_123".to_string()],
            text: text.to_string(),
            value_hash: None,
            weight: 2.5,
            confidence: 0.92,
            false_positive_count: 0,
            true_positive_count: 4,
        }
    }

    fn text_request() -> InferenceRequest {
        InferenceRequest {
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
                message_text: Some("claim your free nitro gift".to_string()),
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
                    "learned".to_string(),
                ],
                allow_cross_server_signals: true,
            },
            learned_signal_candidates: vec![learned_candidate(
                "sig_match",
                "claim your free nitro gift now",
            )],
        }
    }

    #[tokio::test]
    async fn classify_text_endpoint_returns_contract_json() {
        let request_body =
            serde_json::to_vec(&text_request()).expect("text request should serialize");

        let response = app(state())
            .oneshot(
                Request::post("/v1/inference/classify/text")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["requestId"], "req_123");
        assert_eq!(value["decision"]["recommendedAction"], "quarantine");
        assert_eq!(value["learnedSignals"][0]["id"], "sig_match");
    }

    #[tokio::test]
    async fn embed_similarity_and_rerank_endpoints_work() {
        let embed_request = serde_json::to_vec(&EmbedRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "embed_123".to_string(),
            purpose: TextEmbeddingPurpose::Query,
            inputs: vec![TextInput {
                id: Some("query".to_string()),
                text: "claim your nitro".to_string(),
            }],
        })
        .expect("embed request should serialize");

        let embed_response = app(state())
            .oneshot(
                Request::post("/v1/inference/embed")
                    .header("content-type", "application/json")
                    .body(Body::from(embed_request))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(embed_response.status(), StatusCode::OK);

        let similarity_request = serde_json::to_vec(&SimilarityRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "sim_123".to_string(),
            query: TextInput { id: None, text: "claim your nitro".to_string() },
            candidates: vec![
                learned_candidate("sig_1", "claim your nitro today"),
                learned_candidate("sig_2", "weekly moderator meeting notes"),
            ],
            top_k: Some(2),
            min_score: Some(0.0),
        })
        .expect("similarity request should serialize");

        let similarity_response = app(state())
            .oneshot(
                Request::post("/v1/inference/similarity")
                    .header("content-type", "application/json")
                    .body(Body::from(similarity_request))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let similarity_body =
            to_bytes(similarity_response.into_body(), usize::MAX).await.expect("body should read");
        let similarity_value: serde_json::Value =
            serde_json::from_slice(&similarity_body).expect("response should be valid json");

        assert_eq!(similarity_value["matches"][0]["id"], "sig_1");

        let rerank_request = serde_json::to_vec(&RerankRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "rerank_123".to_string(),
            query: TextInput { id: None, text: "claim your nitro".to_string() },
            documents: vec![
                learned_candidate("doc_1", "claim your nitro today"),
                learned_candidate("doc_2", "weekly moderator meeting notes"),
            ],
            top_k: Some(1),
        })
        .expect("rerank request should serialize");

        let rerank_response = app(state())
            .oneshot(
                Request::post("/v1/inference/rerank")
                    .header("content-type", "application/json")
                    .body(Body::from(rerank_request))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let rerank_body =
            to_bytes(rerank_response.into_body(), usize::MAX).await.expect("body should read");
        let rerank_value: serde_json::Value =
            serde_json::from_slice(&rerank_body).expect("response should be valid json");

        assert_eq!(rerank_value["results"][0]["id"], "doc_1");
    }

    #[tokio::test]
    async fn image_classification_endpoint_is_explicitly_unavailable() {
        let request_body = serde_json::to_vec(&ImageClassificationRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "img_123".to_string(),
            evidence_refs: vec!["evi_123".to_string()],
        })
        .expect("request should serialize");

        let response = app(state())
            .oneshot(
                Request::post("/v1/inference/classify/image")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
        let value: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(value["capabilityStatus"], "unavailable");
        assert_eq!(
            value["warnings"][0],
            serde_json::Value::String("image_classification_backend_unconfigured".to_string())
        );
        assert_eq!(CapabilityStatus::Unavailable, CapabilityStatus::Unavailable);
    }
}
