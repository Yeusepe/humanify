//! Purpose: advisory inference, embedding, similarity, and rerank helpers for the Rust boundary.
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
//! - https://docs.rs/fastembed/5.13.3/fastembed/
//! - https://docs.rs/fastembed/5.13.3/fastembed/struct.TextEmbedding.html
//! - https://docs.rs/fastembed/5.13.3/fastembed/enum.EmbeddingModel.html
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//!
//! Tests:
//! - cargo test -p humanify-proto -p humanify-inference -p inference-rs

use std::sync::{Arc, Mutex};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use humanify_core::CONTRACT_VERSION;
use humanify_policy::AdvisoryBoundary;
use humanify_proto::{
    CapabilityStatus, EmbedRequest, EmbedResponse, EmbeddingRecord, EventKind,
    ImageClassificationRequest, ImageClassificationResponse, InferenceRequest, InferenceResponse,
    LearnedSignal, LearnedSignalCandidate, RerankRequest, RerankResponse, RerankResult,
    SimilarityMatch, SimilarityRequest, SimilarityResponse, TextEmbeddingPurpose,
};
use humanify_risk::{
    RuleFinding, confidence_from_raw, default_recommended_action, raw_points, raw_to_score,
};

/// Version string for the hybrid heuristic + advisory embedding scorer.
pub const SCORER_MODEL_VERSION: &str = "risk-hybrid-0.2.0";
/// Placeholder image-backend version until a real image model is wired.
pub const IMAGE_MODEL_VERSION: &str = "image-backend-unconfigured-0.1.0";

const DEFAULT_TOP_K: usize = 5;
const SCORE_MATCH_THRESHOLD: f64 = 0.72;
const SIMILARITY_MATCH_THRESHOLD: f64 = 0.35;

/// Dense embeddings plus the backend metadata that produced them.
#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddingBatch {
    /// Backend/model identifier.
    pub model_version: String,
    /// Embedding dimensionality.
    pub dimensions: usize,
    /// Dense embedding vectors.
    pub embeddings: Vec<Vec<f32>>,
}

/// Production embedding boundary used by the advisory inference service.
pub trait TextEmbeddingBackend: Send + Sync {
    /// Returns the backend identifier.
    fn backend_name(&self) -> &'static str;
    /// Embeds the provided inputs for the given purpose.
    fn embed_texts(
        &self,
        inputs: &[String],
        purpose: TextEmbeddingPurpose,
    ) -> Result<EmbeddingBatch, String>;
}

struct FastembedState {
    engine: TextEmbedding,
    model_version: String,
    dimensions: usize,
}

/// `fastembed-rs` text backend for the first advisory production path.
pub struct FastembedTextBackend {
    model: EmbeddingModel,
    state: Mutex<Option<FastembedState>>,
}

impl std::fmt::Debug for FastembedTextBackend {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FastembedTextBackend")
            .field("model", &self.model)
            .field("initialized", &self.state.lock().map(|guard| guard.is_some()).unwrap_or(false))
            .finish()
    }
}

impl Default for FastembedTextBackend {
    fn default() -> Self {
        Self { model: EmbeddingModel::BGESmallENV15, state: Mutex::new(None) }
    }
}

impl FastembedTextBackend {
    fn embed_with_state(
        &self,
        inputs: &[String],
        purpose: TextEmbeddingPurpose,
    ) -> Result<EmbeddingBatch, String> {
        let mut guard =
            self.state.lock().map_err(|_| "fastembed_state_lock_poisoned".to_string())?;

        if guard.is_none() {
            let mut options = InitOptions::default();
            options.model_name = self.model.clone();
            options.show_download_progress = false;

            let engine = TextEmbedding::try_new(options)
                .map_err(|error| format!("fastembed_initialization_failed:{error}"))?;
            let model_info = TextEmbedding::get_model_info(&self.model)
                .map_err(|error| format!("fastembed_model_info_failed:{error}"))?;

            *guard = Some(FastembedState {
                engine,
                model_version: format!("fastembed/{}", model_info.model_code),
                dimensions: model_info.dim,
            });
        }

        let state = guard.as_mut().ok_or_else(|| "fastembed_state_unavailable".to_string())?;
        let prepared_inputs: Vec<String> =
            inputs.iter().map(|input| with_embedding_prefix(input, purpose)).collect();
        let embeddings = state
            .engine
            .embed(prepared_inputs, None)
            .map_err(|error| format!("fastembed_embed_failed:{error}"))?;

        Ok(EmbeddingBatch {
            model_version: state.model_version.clone(),
            dimensions: embeddings.first().map(Vec::len).unwrap_or(state.dimensions),
            embeddings,
        })
    }
}

impl TextEmbeddingBackend for FastembedTextBackend {
    fn backend_name(&self) -> &'static str {
        "fastembed"
    }

    fn embed_texts(
        &self,
        inputs: &[String],
        purpose: TextEmbeddingPurpose,
    ) -> Result<EmbeddingBatch, String> {
        self.embed_with_state(inputs, purpose)
    }
}

/// Advisory inference service implementation aligned to the shared contracts.
#[derive(Clone)]
pub struct InferenceService {
    advisory_boundary: AdvisoryBoundary,
    text_backend: Arc<dyn TextEmbeddingBackend>,
}

impl std::fmt::Debug for InferenceService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("InferenceService")
            .field("advisory_boundary", &self.advisory_boundary)
            .field("text_backend", &self.text_backend.backend_name())
            .finish()
    }
}

impl Default for InferenceService {
    fn default() -> Self {
        Self::with_text_backend(Arc::new(FastembedTextBackend::default()))
    }
}

impl InferenceService {
    /// Creates a service that uses the supplied text backend.
    pub fn with_text_backend(text_backend: Arc<dyn TextEmbeddingBackend>) -> Self {
        Self { advisory_boundary: AdvisoryBoundary::default(), text_backend }
    }

    /// Scores a request and returns an advisory response aligned to `docs\contracts.md`.
    pub fn score_request(&self, request: &InferenceRequest) -> InferenceResponse {
        let findings = collect_findings(request);
        let mut raw = raw_points(&findings);
        let mut reason_codes: Vec<String> =
            findings.iter().map(|finding| finding.reason_code.to_string()).collect();
        let mut warnings = collect_warnings(request);
        let mut learned_signals = Vec::new();
        let mut backend_model_version = None;

        if request.policy_input.enabled_signal_families.iter().any(|family| family == "learned") {
            match self.match_learned_signals(
                request.features.message_text.as_deref(),
                &request.learned_signal_candidates,
                SCORE_MATCH_THRESHOLD,
                DEFAULT_TOP_K,
            ) {
                Ok(result) => {
                    backend_model_version = Some(result.model_version.clone());
                    raw +=
                        result.matches.iter().map(|item| item.adjusted_weight as f32).sum::<f32>();
                    for matched_signal in &result.matches {
                        reason_codes.push(matched_signal.reason_code.clone());
                    }

                    learned_signals = result
                        .matches
                        .into_iter()
                        .map(|matched_signal| LearnedSignal {
                            id: matched_signal.id,
                            kind: matched_signal.kind,
                            value_hash: matched_signal.value_hash,
                            weight: matched_signal.adjusted_weight,
                            confidence: matched_signal.adjusted_confidence,
                            source_case_ids: matched_signal.source_case_ids,
                            false_positive_count: 0,
                            true_positive_count: 1,
                            last_seen_at: request.event.occurred_at.clone(),
                            expires_at: None,
                        })
                        .collect();
                }
                Err(warning) => warnings.push(warning),
            }
        }

        if reason_codes.is_empty() {
            reason_codes.push("outcome_no_elevated_signal".to_string());
        }

        let score = raw_to_score(raw);
        let recommended_action = default_recommended_action(score);
        let clamped_action = self.advisory_boundary.clamp(recommended_action);
        let model_version = backend_model_version
            .map(|backend| format!("{SCORER_MODEL_VERSION}+{backend}"))
            .unwrap_or_else(|| SCORER_MODEL_VERSION.to_string());

        InferenceResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            model_version,
            decision: humanify_proto::RiskDecision {
                user_id: request.subject_user_id.clone(),
                guild_id: request.guild_id.clone(),
                score,
                confidence: confidence_from_raw(raw),
                reason_codes,
                recommended_action: clamped_action,
                evidence_refs: request.evidence_refs.clone(),
                expires_at: None,
            },
            learned_signals,
            warnings,
        }
    }

    /// Generates direct text embeddings for the `/embed` boundary.
    pub fn embed_request(&self, request: &EmbedRequest) -> Result<EmbedResponse, String> {
        let inputs: Vec<String> = request.inputs.iter().map(|input| input.text.clone()).collect();
        let batch = self.text_backend.embed_texts(&inputs, request.purpose)?;

        Ok(EmbedResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            capability_status: CapabilityStatus::Ready,
            model_version: batch.model_version,
            dimensions: batch.dimensions,
            embeddings: request
                .inputs
                .iter()
                .zip(batch.embeddings)
                .map(|(input, vector)| EmbeddingRecord {
                    id: input.id.clone(),
                    value_hash: hash_text(&input.text),
                    vector,
                })
                .collect(),
            warnings: Vec::new(),
        })
    }

    /// Computes cosine similarity against Bun-provided learned candidates.
    pub fn similarity_request(
        &self,
        request: &SimilarityRequest,
    ) -> Result<SimilarityResponse, String> {
        let result = self.match_learned_signals(
            Some(request.query.text.as_str()),
            &request.candidates,
            request.min_score.unwrap_or(SIMILARITY_MATCH_THRESHOLD),
            request.top_k.unwrap_or(DEFAULT_TOP_K),
        )?;

        Ok(SimilarityResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            capability_status: CapabilityStatus::Ready,
            model_version: result.model_version,
            dimensions: result.dimensions,
            query_hash: hash_text(&request.query.text),
            matches: result.matches,
            warnings: Vec::new(),
        })
    }

    /// Reranks Bun-provided candidate texts using embedding cosine similarity.
    pub fn rerank_request(&self, request: &RerankRequest) -> Result<RerankResponse, String> {
        let result = self.match_learned_signals(
            Some(request.query.text.as_str()),
            &request.documents,
            0.0,
            request.top_k.unwrap_or(DEFAULT_TOP_K),
        )?;

        Ok(RerankResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            capability_status: CapabilityStatus::Ready,
            model_version: result.model_version,
            dimensions: result.dimensions,
            results: result
                .matches
                .into_iter()
                .map(|matched_signal| RerankResult {
                    id: matched_signal.id,
                    reason_code: matched_signal.reason_code,
                    source_case_ids: matched_signal.source_case_ids,
                    value_hash: matched_signal.value_hash,
                    score: matched_signal.score,
                })
                .collect(),
            warnings: Vec::new(),
        })
    }

    /// Reports the current image-classification capability without implying authority.
    pub fn classify_image_request(
        &self,
        request: &ImageClassificationRequest,
    ) -> ImageClassificationResponse {
        ImageClassificationResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            capability_status: CapabilityStatus::Unavailable,
            model_version: IMAGE_MODEL_VERSION.to_string(),
            evidence_refs: request.evidence_refs.clone(),
            warnings: vec![
                "image_classification_backend_unconfigured".to_string(),
                "image_classification_remains_advisory_only".to_string(),
            ],
        }
    }

    fn match_learned_signals(
        &self,
        query_text: Option<&str>,
        candidates: &[LearnedSignalCandidate],
        min_score: f64,
        top_k: usize,
    ) -> Result<SimilarityComputation, String> {
        let query_text = query_text
            .filter(|text| !text.trim().is_empty())
            .ok_or_else(|| "learned_signal_text_unavailable".to_string())?;

        if candidates.is_empty() {
            return Err("learned_signal_candidates_unavailable".to_string());
        }

        let query_batch = self
            .text_backend
            .embed_texts(&[query_text.to_string()], TextEmbeddingPurpose::Query)?;
        let candidate_texts: Vec<String> =
            candidates.iter().map(|candidate| candidate.text.clone()).collect();
        let candidate_batch =
            self.text_backend.embed_texts(&candidate_texts, TextEmbeddingPurpose::Passage)?;
        let query_vector = query_batch
            .embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "embedding_query_vector_missing".to_string())?;

        let mut matches = candidates
            .iter()
            .zip(candidate_batch.embeddings.iter())
            .filter_map(|(candidate, candidate_vector)| {
                let score = cosine_similarity(&query_vector, candidate_vector);
                if score < min_score {
                    return None;
                }

                let suppression = suppression_factor(candidate);
                let adjusted_weight = candidate.weight * score * suppression;
                let adjusted_confidence =
                    (candidate.confidence * (0.55 + (score * 0.45)) * suppression)
                        .clamp(0.05, 0.99);

                Some(SimilarityMatch {
                    id: candidate.id.clone(),
                    kind: candidate.kind,
                    reason_code: candidate.reason_code.clone(),
                    source_case_ids: candidate.source_case_ids.clone(),
                    value_hash: candidate
                        .value_hash
                        .clone()
                        .unwrap_or_else(|| hash_text(&candidate.text)),
                    score,
                    adjusted_weight,
                    adjusted_confidence,
                })
            })
            .collect::<Vec<_>>();

        matches.sort_by(|left, right| right.score.total_cmp(&left.score));
        matches.truncate(top_k);

        Ok(SimilarityComputation {
            model_version: query_batch.model_version,
            dimensions: query_batch.dimensions,
            matches,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
struct SimilarityComputation {
    model_version: String,
    dimensions: usize,
    matches: Vec<SimilarityMatch>,
}

fn collect_findings(request: &InferenceRequest) -> Vec<RuleFinding> {
    let enabled = |family: &str| {
        request.policy_input.enabled_signal_families.iter().any(|candidate| candidate == family)
    };

    let mut findings = Vec::new();
    let features = &request.features;

    if enabled("account") && features.account_age_hours < 24 {
        findings.push(RuleFinding::new("account_age_lt_24h", 2.5));
    } else if enabled("account") && features.account_age_hours < 24 * 7 {
        findings.push(RuleFinding::new("account_age_lt_7d", 1.5));
    }

    if enabled("profile") && !features.has_avatar {
        findings.push(RuleFinding::new("profile_missing_avatar", 0.4));
    }

    if enabled("profile") && !features.has_banner {
        findings.push(RuleFinding::new("profile_missing_banner", 0.2));
    }

    if enabled("message")
        && request.event.kind == EventKind::Message
        && !features.normalized_domains.is_empty()
    {
        findings.push(RuleFinding::new("first_message_link", 2.0));
    }

    if enabled("domain") && !features.normalized_domains.is_empty() {
        findings.push(RuleFinding::new("malicious_domain_pattern", 1.5));
    }

    if enabled("behavior") && features.mention_count_last_minute >= 5 {
        findings.push(RuleFinding::new("mention_burst", 2.0));
    }

    if enabled("message") && features.duplicate_message_count >= 3 {
        findings.push(RuleFinding::new("duplicate_message_pattern", 1.5));
    }

    findings
}

fn collect_warnings(request: &InferenceRequest) -> Vec<String> {
    let mut warnings = Vec::new();

    if request.event.kind == EventKind::Message && request.features.message_text_hash.is_none() {
        warnings.push("message_text_hash_unavailable".to_string());
    }

    if request.policy_input.enabled_signal_families.iter().any(|family| family == "learned") {
        if request.learned_signal_candidates.is_empty() {
            warnings.push("learned_signal_candidates_unavailable".to_string());
        }

        if request.features.message_text.is_none() {
            warnings.push("learned_signal_text_unavailable".to_string());
        }
    }

    warnings
}

fn with_embedding_prefix(input: &str, purpose: TextEmbeddingPurpose) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("query:") || trimmed.starts_with("passage:") {
        return trimmed.to_string();
    }

    match purpose {
        TextEmbeddingPurpose::Query => format!("query: {trimmed}"),
        TextEmbeddingPurpose::Passage => format!("passage: {trimmed}"),
    }
}

fn suppression_factor(candidate: &LearnedSignalCandidate) -> f64 {
    let total = candidate.true_positive_count + candidate.false_positive_count + 1;
    ((candidate.true_positive_count + 1) as f64 / total as f64).clamp(0.15, 1.0)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f64 {
    let left_norm = left.iter().map(|value| value * value).sum::<f32>().sqrt();
    let right_norm = right.iter().map(|value| value * value).sum::<f32>().sqrt();

    if left_norm == 0.0 || right_norm == 0.0 {
        return 0.0;
    }

    let dot = left.iter().zip(right.iter()).map(|(l, r)| l * r).sum::<f32>();
    (dot / (left_norm * right_norm)) as f64
}

fn hash_text(text: &str) -> String {
    format!("blake3:{}", blake3::hash(text.trim().as_bytes()).to_hex())
}

#[cfg(test)]
mod tests {
    use super::{EmbeddingBatch, InferenceService, TextEmbeddingBackend};
    use humanify_proto::{
        CapabilityStatus, ContainmentAction, EmbedRequest, EventKind, FeatureSnapshot,
        ImageClassificationRequest, InferenceEvent, InferenceRequest, LearnedSignalCandidate,
        LearnedSignalType, RerankRequest, ScoringPolicyInput, ServerSensitivity, SimilarityRequest,
        TextEmbeddingPurpose, TextInput,
    };
    use std::sync::Arc;

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
                embeddings: inputs.iter().map(|input| vectorize(input)).collect(),
            })
        }
    }

    fn vectorize(input: &str) -> Vec<f32> {
        let lowercase = input.to_ascii_lowercase();
        let keyword_score =
            ["gift", "claim", "wallet", "verify", "discord", "nitro", "free", "airdrop"]
                .iter()
                .filter(|keyword| lowercase.contains(**keyword))
                .count() as f32;

        vec![
            lowercase.len() as f32,
            lowercase.matches("http").count() as f32 * 3.0
                + lowercase.matches("discord.gg").count() as f32,
            keyword_score * 2.0,
            lowercase.matches('!').count() as f32 + lowercase.matches('@').count() as f32,
        ]
    }

    fn service() -> InferenceService {
        InferenceService::with_text_backend(Arc::new(DeterministicTextBackend))
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

    fn suspicious_request() -> InferenceRequest {
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
                message_text: Some(
                    "claim your free nitro gift at http://disc0rd-gifts.example".to_string(),
                ),
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
            learned_signal_candidates: vec![
                learned_candidate("sig_match", "claim your free nitro gift now"),
                learned_candidate("sig_other", "hello and welcome to the server"),
            ],
        }
    }

    #[test]
    fn scoring_clamps_service_output_to_advisory_boundary_and_surfaces_learned_matches() {
        let response = service().score_request(&suspicious_request());

        assert_eq!(response.decision.recommended_action, humanify_proto::Action::Quarantine);
        assert!(response.decision.score >= 7);
        assert!(
            response
                .decision
                .reason_codes
                .contains(&"similar_to_confirmed_scam_template".to_string())
        );
        assert!(!response.learned_signals.is_empty());
        assert!(response.learned_signals.iter().any(|signal| signal.id == "sig_match"));
        assert!(response.model_version.contains("deterministic-test/v1"));
    }

    #[test]
    fn embed_similarity_and_rerank_return_sorted_results() {
        let service = service();

        let embed = service
            .embed_request(&EmbedRequest {
                contract_version: "0.1.0".to_string(),
                request_id: "embed_123".to_string(),
                purpose: TextEmbeddingPurpose::Query,
                inputs: vec![TextInput {
                    id: Some("query".to_string()),
                    text: "claim your nitro".to_string(),
                }],
            })
            .expect("embedding should succeed");

        assert_eq!(embed.capability_status, CapabilityStatus::Ready);
        assert_eq!(embed.embeddings.len(), 1);

        let similarity = service
            .similarity_request(&SimilarityRequest {
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
            .expect("similarity should succeed");

        assert_eq!(similarity.matches[0].id, "sig_1");
        assert!(similarity.matches[0].score > similarity.matches[1].score);

        let rerank = service
            .rerank_request(&RerankRequest {
                contract_version: "0.1.0".to_string(),
                request_id: "rerank_123".to_string(),
                query: TextInput { id: None, text: "claim your nitro".to_string() },
                documents: vec![
                    learned_candidate("doc_1", "claim your nitro today"),
                    learned_candidate("doc_2", "weekly moderator meeting notes"),
                ],
                top_k: Some(1),
            })
            .expect("rerank should succeed");

        assert_eq!(rerank.results.len(), 1);
        assert_eq!(rerank.results[0].id, "doc_1");
    }

    #[test]
    fn image_classification_is_explicitly_unavailable() {
        let response = service().classify_image_request(&ImageClassificationRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "img_123".to_string(),
            evidence_refs: vec!["evi_123".to_string()],
        });

        assert_eq!(response.capability_status, CapabilityStatus::Unavailable);
        assert!(
            response.warnings.contains(&"image_classification_backend_unconfigured".to_string())
        );
    }
}
