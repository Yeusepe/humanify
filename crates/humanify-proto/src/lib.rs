//! Purpose: Rust `serde` contract types aligned with `docs\contracts.md` and the canonical schema.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\contracts\humanify-contracts.schema.json
//!
//! Upstream docs:
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//! - https://serde.rs/derive.html
//! - https://docs.rs/serde_json/latest/serde_json/
//! - https://www.rfc-editor.org/rfc/rfc8259.txt
//! - https://json-schema.org/draft/2020-12
//!
//! Tests:
//! - cargo test --workspace

use humanify_core::CONTRACT_VERSION;
use serde::{Deserialize, Serialize};

/// Shared risk-action ladder ordered from least to most disruptive.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Observe only.
    None,
    /// Increase review priority.
    Watch,
    /// Require a challenge or attestation.
    Verify,
    /// Restrict access or privileges.
    Quarantine,
    /// Temporary platform restriction.
    Timeout,
    /// Remove from the guild.
    Kick,
    /// Remove and block rejoin.
    Ban,
}

/// Allowed containment steps sent to scoring paths.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ContainmentAction {
    /// Require a challenge or attestation.
    Verify,
    /// Restrict access or privileges.
    Quarantine,
}

/// Outcome labels for moderator-confirmed case results.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CaseOutcomeType {
    /// Confirmed scam behavior.
    ConfirmedScam,
    /// Confirmed bot behavior.
    ConfirmedBot,
    /// Confirmed compromised account.
    ConfirmedHackedAccount,
    /// The case was a false positive.
    FalsePositive,
    /// The case was dismissed.
    Dismissed,
    /// The outcome was overturned.
    Overturned,
}

/// Learned signal families produced from outcomes or similarity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LearnedSignalType {
    /// Textual similarity.
    TextSimilarity,
    /// Domain reputation.
    DomainReputation,
    /// Invite reputation.
    InviteReputation,
    /// Image hash or perceptual match.
    ImageHash,
    /// Generalized behavior pattern.
    BehaviorPattern,
    /// Reporter reliability.
    ReporterReputation,
    /// Trust-network or server-level reputation.
    ServerTrust,
}

/// Server sensitivity selections passed into scoring.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ServerSensitivity {
    /// Minimize sensitivity.
    Low,
    /// Balanced scoring.
    Balanced,
    /// Increase sensitivity.
    High,
}

/// Verification context tracked by Bun policy evaluation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    /// No verification information yet.
    Unknown,
    /// Verification in progress.
    Pending,
    /// Verification passed.
    Passed,
    /// Verification failed.
    Failed,
}

/// Inference ingress event kinds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// A guild join event.
    Join,
    /// A message-related event.
    Message,
    /// A moderator or user report.
    Report,
    /// Verification state changed.
    VerificationUpdate,
    /// Manual review initiated.
    ManualReview,
}

/// Readiness of a specific advisory capability.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    /// Capability is ready for normal advisory use.
    Ready,
    /// Capability works but is degraded.
    Degraded,
    /// Capability is not currently available.
    Unavailable,
}

/// Purpose used when generating text embeddings.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TextEmbeddingPurpose {
    /// Query-like text used to search similar records.
    Query,
    /// Passage-like text stored as a retrievable record.
    Passage,
}

/// The canonical advisory artifact returned by Rust.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RiskDecision {
    /// Opaque Discord user identifier.
    pub user_id: String,
    /// Opaque Discord guild identifier.
    pub guild_id: String,
    /// Inclusive 1–10 risk score.
    pub score: u8,
    /// Inclusive 0–1 confidence.
    pub confidence: f64,
    /// Stable machine-readable explanation codes.
    pub reason_codes: Vec<String>,
    /// Advisory recommendation only.
    pub recommended_action: Action,
    /// Evidence references that support the decision.
    pub evidence_refs: Vec<String>,
    /// Optional expiry for time-bounded signals.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// Moderator-confirmed case outcome used by learning pipelines.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaseOutcome {
    /// Canonical case identifier.
    pub case_id: String,
    /// Opaque Discord guild identifier.
    pub guild_id: String,
    /// Hashed user identifier for cross-case learning.
    pub subject_user_id_hash: String,
    /// Case outcome label.
    pub outcome: CaseOutcomeType,
    /// Moderator confidence.
    pub confidence: f64,
    /// Actor or system that decided the case.
    pub decided_by: String,
    /// RFC3339 timestamp.
    pub decided_at: String,
    /// Stable machine-readable explanation codes.
    pub reason_codes: Vec<String>,
    /// Evidence references that support the outcome.
    pub evidence_refs: Vec<String>,
}

/// Reusable learned signal produced from confirmed outcomes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedSignal {
    /// Learned signal identifier.
    pub id: String,
    /// Signal type.
    #[serde(rename = "type")]
    pub kind: LearnedSignalType,
    /// Signal value hash.
    pub value_hash: String,
    /// Relative signal weight.
    pub weight: f64,
    /// Confidence in this signal.
    pub confidence: f64,
    /// Source cases that produced the signal.
    pub source_case_ids: Vec<String>,
    /// False-positive count.
    pub false_positive_count: u32,
    /// True-positive count.
    pub true_positive_count: u32,
    /// RFC3339 timestamp.
    pub last_seen_at: String,
    /// Optional expiry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// Textual learned-signal candidate supplied by Bun from canonical storage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedSignalCandidate {
    /// Learned signal identifier.
    pub id: String,
    /// Candidate signal type.
    #[serde(rename = "type")]
    pub kind: LearnedSignalType,
    /// Canonical reason code the signal should surface when matched.
    pub reason_code: String,
    /// Canonical source cases backing this signal.
    pub source_case_ids: Vec<String>,
    /// Redacted or normalized text used for advisory matching.
    pub text: String,
    /// Optional precomputed hash for the text/value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_hash: Option<String>,
    /// Canonical signal weight before similarity adjustment.
    pub weight: f64,
    /// Canonical signal confidence before similarity adjustment.
    pub confidence: f64,
    /// False-positive counter used for suppression.
    pub false_positive_count: u32,
    /// True-positive counter used for reinforcement.
    pub true_positive_count: u32,
}

/// Scoring-only policy hints provided by Bun.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoringPolicyInput {
    /// Requested sensitivity preset.
    pub server_sensitivity: ServerSensitivity,
    /// Preferred reversible containment action.
    pub preferred_containment_action: ContainmentAction,
    /// Role IDs treated as suspicious.
    pub suspicious_role_ids: Vec<String>,
    /// Role IDs treated as trusted.
    pub trusted_role_ids: Vec<String>,
    /// Enabled signal families.
    pub enabled_signal_families: Vec<String>,
    /// Whether cross-server signals may contribute.
    pub allow_cross_server_signals: bool,
}

/// Bun-owned policy envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInput {
    /// Advisory risk decision returned by Rust.
    pub risk_decision: RiskDecision,
    /// Server policy thresholds and clamps.
    pub server_policy: ServerPolicy,
    /// Current executor capabilities.
    pub capability_context: CapabilityContext,
    /// Case context for verification and appeals.
    pub case_context: CaseContext,
}

/// Server policy thresholds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerPolicy {
    /// Maximum action that can ever be applied automatically.
    pub max_automatic_action: Action,
    /// Whether auto-ban is enabled.
    pub allow_auto_ban: bool,
    /// Threshold for verification.
    pub verification_required_at_or_above: u8,
    /// Threshold for quarantine.
    pub quarantine_at_or_above: u8,
    /// Optional timeout threshold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_at_or_above: Option<u8>,
    /// Optional kick threshold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kick_at_or_above: Option<u8>,
    /// Optional ban threshold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_at_or_above: Option<u8>,
}

/// Current capability context used by Bun.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContext {
    /// Whether the executor can manage roles.
    pub can_manage_roles: bool,
    /// Whether the executor can apply timeouts.
    pub can_timeout: bool,
    /// Whether the executor can kick members.
    pub can_kick: bool,
    /// Whether the executor can ban members.
    pub can_ban: bool,
}

/// Current case context used by Bun.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaseContext {
    /// Whether there is already an open case.
    pub existing_open_case: bool,
    /// Verification status.
    pub verification_status: VerificationStatus,
    /// Whether an appeal is open.
    pub appeal_open: bool,
}

/// Inference ingress payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InferenceRequest {
    /// Shared contract version.
    pub contract_version: String,
    /// Traceable request identifier.
    pub request_id: String,
    /// Opaque Discord guild identifier.
    pub guild_id: String,
    /// Opaque Discord user identifier.
    pub subject_user_id: String,
    /// Event envelope.
    pub event: InferenceEvent,
    /// Normalized feature snapshot.
    pub features: FeatureSnapshot,
    /// Evidence references.
    pub evidence_refs: Vec<String>,
    /// Scoring-only policy hints.
    pub policy_input: ScoringPolicyInput,
    /// Canonical learned-signal candidates Bun wants Rust to compare against.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub learned_signal_candidates: Vec<LearnedSignalCandidate>,
}

/// Event envelope inside `InferenceRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InferenceEvent {
    /// Event kind.
    pub kind: EventKind,
    /// RFC3339 timestamp.
    pub occurred_at: String,
}

/// Deterministic feature snapshot provided by Bun.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSnapshot {
    /// Account age in hours.
    pub account_age_hours: u64,
    /// Member age in minutes.
    pub joined_age_minutes: u64,
    /// Whether the account has an avatar.
    pub has_avatar: bool,
    /// Whether the account has a banner.
    pub has_banner: bool,
    /// Optional first-message delay.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_message_delay_seconds: Option<u64>,
    /// Optional redacted or normalized message text for advisory embedding work.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_text: Option<String>,
    /// Optional normalized message-text hash.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_text_hash: Option<String>,
    /// Normalized domains extracted from the message.
    pub normalized_domains: Vec<String>,
    /// Optional invite hash.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite_code_hash: Option<String>,
    /// Mentions observed in the last minute.
    pub mention_count_last_minute: u64,
    /// Duplicate-message count.
    pub duplicate_message_count: u64,
}

/// Inference egress payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InferenceResponse {
    /// Shared contract version.
    pub contract_version: String,
    /// Echoed request identifier.
    pub request_id: String,
    /// Model or rule-set version.
    pub model_version: String,
    /// Advisory risk decision.
    pub decision: RiskDecision,
    /// Learned signals surfaced with the response.
    pub learned_signals: Vec<LearnedSignal>,
    /// Degraded-mode warnings.
    pub warnings: Vec<String>,
}

/// Input text for embedding-oriented endpoints.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextInput {
    /// Optional caller-supplied identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Redacted or normalized text content.
    pub text: String,
}

/// Request for direct embedding generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRequest {
    /// Shared contract version.
    pub contract_version: String,
    /// Traceable request identifier.
    pub request_id: String,
    /// Whether inputs should be embedded as queries or passages.
    pub purpose: TextEmbeddingPurpose,
    /// Inputs to embed.
    pub inputs: Vec<TextInput>,
}

/// Serialized embedding output for a single input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRecord {
    /// Optional caller-supplied identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Stable value hash for the embedded text.
    pub value_hash: String,
    /// Dense embedding vector.
    pub vector: Vec<f32>,
}

/// Response for direct embedding generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResponse {
    /// Shared contract version.
    pub contract_version: String,
    /// Echoed request identifier.
    pub request_id: String,
    /// Capability readiness.
    pub capability_status: CapabilityStatus,
    /// Backend/model identifier used for the embeddings.
    pub model_version: String,
    /// Embedding dimensionality.
    pub dimensions: usize,
    /// Output embeddings.
    pub embeddings: Vec<EmbeddingRecord>,
    /// Degraded-mode warnings.
    pub warnings: Vec<String>,
}

/// Request for cosine-similarity matching against learned candidates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityRequest {
    /// Shared contract version.
    pub contract_version: String,
    /// Traceable request identifier.
    pub request_id: String,
    /// Query text to compare.
    pub query: TextInput,
    /// Candidate learned signals to compare against.
    pub candidates: Vec<LearnedSignalCandidate>,
    /// Optional top-k cap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<usize>,
    /// Optional minimum score.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_score: Option<f64>,
}

/// A single similarity match.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityMatch {
    /// Learned signal identifier.
    pub id: String,
    /// Candidate type.
    #[serde(rename = "type")]
    pub kind: LearnedSignalType,
    /// Stable reason code surfaced by this match.
    pub reason_code: String,
    /// Canonical source cases backing the signal.
    pub source_case_ids: Vec<String>,
    /// Stable hash for the matched record.
    pub value_hash: String,
    /// Cosine similarity score.
    pub score: f64,
    /// Weight after similarity and suppression adjustment.
    pub adjusted_weight: f64,
    /// Confidence after similarity adjustment.
    pub adjusted_confidence: f64,
}

/// Similarity endpoint response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityResponse {
    /// Shared contract version.
    pub contract_version: String,
    /// Echoed request identifier.
    pub request_id: String,
    /// Capability readiness.
    pub capability_status: CapabilityStatus,
    /// Backend/model identifier used for the comparison.
    pub model_version: String,
    /// Embedding dimensionality.
    pub dimensions: usize,
    /// Stable query hash.
    pub query_hash: String,
    /// Sorted matches in descending score order.
    pub matches: Vec<SimilarityMatch>,
    /// Degraded-mode warnings.
    pub warnings: Vec<String>,
}

/// Rerank request built on the same learned-signal candidate shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RerankRequest {
    /// Shared contract version.
    pub contract_version: String,
    /// Traceable request identifier.
    pub request_id: String,
    /// Query text to compare.
    pub query: TextInput,
    /// Candidate texts to rerank.
    pub documents: Vec<LearnedSignalCandidate>,
    /// Optional top-k cap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<usize>,
}

/// Reranked document result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RerankResult {
    /// Learned signal/document identifier.
    pub id: String,
    /// Stable reason code associated with the document.
    pub reason_code: String,
    /// Canonical source cases backing the document.
    pub source_case_ids: Vec<String>,
    /// Stable hash for the reranked text.
    pub value_hash: String,
    /// Descending relevance score.
    pub score: f64,
}

/// Rerank endpoint response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RerankResponse {
    /// Shared contract version.
    pub contract_version: String,
    /// Echoed request identifier.
    pub request_id: String,
    /// Capability readiness.
    pub capability_status: CapabilityStatus,
    /// Backend/model identifier used for the rerank.
    pub model_version: String,
    /// Embedding dimensionality.
    pub dimensions: usize,
    /// Sorted rerank results in descending score order.
    pub results: Vec<RerankResult>,
    /// Degraded-mode warnings.
    pub warnings: Vec<String>,
}

/// Request for image-classification capability checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageClassificationRequest {
    /// Shared contract version.
    pub contract_version: String,
    /// Traceable request identifier.
    pub request_id: String,
    /// Canonical evidence references to classify.
    pub evidence_refs: Vec<String>,
}

/// Response for image classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageClassificationResponse {
    /// Shared contract version.
    pub contract_version: String,
    /// Echoed request identifier.
    pub request_id: String,
    /// Capability readiness.
    pub capability_status: CapabilityStatus,
    /// Backend/model identifier, even when unavailable.
    pub model_version: String,
    /// Echoed evidence references.
    pub evidence_refs: Vec<String>,
    /// Degraded-mode warnings.
    pub warnings: Vec<String>,
}

impl Action {
    /// Returns the action severity rank used for clamping.
    pub const fn rank(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Watch => 1,
            Self::Verify => 2,
            Self::Quarantine => 3,
            Self::Timeout => 4,
            Self::Kick => 5,
            Self::Ban => 6,
        }
    }
}

impl Default for ScoringPolicyInput {
    fn default() -> Self {
        Self {
            server_sensitivity: ServerSensitivity::Balanced,
            preferred_containment_action: ContainmentAction::Quarantine,
            suspicious_role_ids: Vec::new(),
            trusted_role_ids: Vec::new(),
            enabled_signal_families: vec![
                "account".to_string(),
                "message".to_string(),
                "behavior".to_string(),
                "domain".to_string(),
            ],
            allow_cross_server_signals: false,
        }
    }
}

impl InferenceRequest {
    /// Builds a minimal request using the current contract version.
    pub fn new(
        request_id: impl Into<String>,
        guild_id: impl Into<String>,
        subject_user_id: impl Into<String>,
        event: InferenceEvent,
        features: FeatureSnapshot,
    ) -> Self {
        Self {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request_id.into(),
            guild_id: guild_id.into(),
            subject_user_id: subject_user_id.into(),
            event,
            features,
            evidence_refs: Vec::new(),
            policy_input: ScoringPolicyInput::default(),
            learned_signal_candidates: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Action, CapabilityStatus, EmbedRequest, EventKind, FeatureSnapshot,
        ImageClassificationResponse, InferenceEvent, InferenceRequest, ScoringPolicyInput,
        TextEmbeddingPurpose, TextInput,
    };

    #[test]
    fn inference_request_serializes_with_documented_field_names() {
        let request = InferenceRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "req_123".to_string(),
            guild_id: "guild_123".to_string(),
            subject_user_id: "user_123".to_string(),
            event: InferenceEvent {
                kind: EventKind::Message,
                occurred_at: "2026-01-15T18:42:11Z".to_string(),
            },
            features: FeatureSnapshot {
                account_age_hours: 12,
                joined_age_minutes: 4,
                has_avatar: false,
                has_banner: false,
                first_message_delay_seconds: Some(10),
                message_text: Some("claim your discord gift".to_string()),
                message_text_hash: Some("blake3:123".to_string()),
                normalized_domains: vec!["example.test".to_string()],
                invite_code_hash: None,
                mention_count_last_minute: 2,
                duplicate_message_count: 1,
            },
            evidence_refs: vec!["evi_123".to_string()],
            policy_input: ScoringPolicyInput::default(),
            learned_signal_candidates: Vec::new(),
        };

        let value = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(value["requestId"], "req_123");
        assert_eq!(value["subjectUserId"], "user_123");
        assert_eq!(value["event"]["kind"], "message");
        assert_eq!(value["features"]["messageText"], "claim your discord gift");
    }

    #[test]
    fn action_order_reflects_contract_ladder() {
        assert!(Action::Watch > Action::None);
        assert!(Action::Ban > Action::Quarantine);
        assert_eq!(Action::Verify.rank(), 2);
    }

    #[test]
    fn embed_request_serializes_with_documented_shapes() {
        let request = EmbedRequest {
            contract_version: "0.1.0".to_string(),
            request_id: "embed_123".to_string(),
            purpose: TextEmbeddingPurpose::Query,
            inputs: vec![TextInput {
                id: Some("candidate_1".to_string()),
                text: "query: suspicious giveaway".to_string(),
            }],
        };

        let value = serde_json::to_value(request).expect("embed request should serialize");

        assert_eq!(value["purpose"], "query");
        assert_eq!(value["inputs"][0]["id"], "candidate_1");
    }

    #[test]
    fn image_classification_response_surfaces_capability_status() {
        let response = ImageClassificationResponse {
            contract_version: "0.1.0".to_string(),
            request_id: "img_123".to_string(),
            capability_status: CapabilityStatus::Unavailable,
            model_version: "image-backend-unconfigured".to_string(),
            evidence_refs: vec!["evi_123".to_string()],
            warnings: vec!["image_classification_backend_unconfigured".to_string()],
        };

        let value = serde_json::to_value(response).expect("response should serialize");

        assert_eq!(value["capabilityStatus"], "unavailable");
        assert_eq!(value["warnings"][0], "image_classification_backend_unconfigured");
    }
}
