//! Purpose: advisory inference service logic built on documented contracts and deterministic heuristics.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//! - https://docs.rs/fastembed/latest/fastembed/
//! - https://huggingface.github.io/candle/
//! - https://ort.pyke.io/
//! - https://burn.dev/books/burn/
//!
//! Tests:
//! - cargo test --workspace

use humanify_core::CONTRACT_VERSION;
use humanify_policy::AdvisoryBoundary;
use humanify_proto::{EventKind, InferenceRequest, InferenceResponse, LearnedSignal, RiskDecision};
use humanify_risk::{
    RuleFinding, confidence_from_raw, default_recommended_action, raw_points, raw_to_score,
};

/// Version string for the scaffolded heuristics model.
pub const MODEL_VERSION: &str = "risk-heuristics-0.1.0";

/// Future boundary for text embedding backends.
pub trait TextEmbeddingBackend {
    /// Returns the backend identifier.
    fn backend_name(&self) -> &'static str;
}

/// Future boundary for image evidence backends.
pub trait ImageEvidenceBackend {
    /// Returns the backend identifier.
    fn backend_name(&self) -> &'static str;
}

/// Minimal inference service implementation for the Rust scaffold.
#[derive(Debug, Clone, Default)]
pub struct InferenceService {
    advisory_boundary: AdvisoryBoundary,
}

impl InferenceService {
    /// Scores a request and returns an advisory response aligned to `docs\contracts.md`.
    pub fn score_request(&self, request: &InferenceRequest) -> InferenceResponse {
        let findings = collect_findings(request);
        let raw = raw_points(&findings);
        let score = raw_to_score(raw);
        let recommended_action = default_recommended_action(score);
        let clamped_action = self.advisory_boundary.clamp(recommended_action);
        let reason_codes = if findings.is_empty() {
            vec!["outcome_no_elevated_signal".to_string()]
        } else {
            findings.iter().map(|finding| finding.reason_code.to_string()).collect()
        };

        let warnings = collect_warnings(request);
        let decision = RiskDecision {
            user_id: request.subject_user_id.clone(),
            guild_id: request.guild_id.clone(),
            score,
            confidence: confidence_from_raw(raw),
            reason_codes,
            recommended_action: clamped_action,
            evidence_refs: request.evidence_refs.clone(),
            expires_at: None,
        };

        InferenceResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            request_id: request.request_id.clone(),
            model_version: MODEL_VERSION.to_string(),
            decision,
            learned_signals: Vec::<LearnedSignal>::new(),
            warnings,
        }
    }
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
        warnings.push("learned_signals_unavailable_in_scaffold".to_string());
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::InferenceService;
    use humanify_proto::{
        ContainmentAction, EventKind, FeatureSnapshot, InferenceEvent, InferenceRequest,
        ScoringPolicyInput, ServerSensitivity,
    };

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
        }
    }

    #[test]
    fn scoring_clamps_service_output_to_advisory_boundary() {
        let service = InferenceService::default();
        let response = service.score_request(&suspicious_request());

        assert_eq!(response.decision.recommended_action, humanify_proto::Action::Quarantine);
        assert!(response.decision.score >= 7);
        assert!(response.decision.reason_codes.contains(&"malicious_domain_pattern".to_string()));
        assert!(response.warnings.contains(&"learned_signals_unavailable_in_scaffold".to_string()));
    }

    #[test]
    fn low_signal_requests_still_emit_a_reason_code() {
        let service = InferenceService::default();
        let mut request = suspicious_request();

        request.features.account_age_hours = 365 * 24;
        request.features.has_avatar = true;
        request.features.has_banner = true;
        request.features.message_text_hash = None;
        request.features.normalized_domains.clear();
        request.features.mention_count_last_minute = 0;
        request.features.duplicate_message_count = 0;
        request.policy_input.enabled_signal_families = vec![
            "account".to_string(),
            "profile".to_string(),
            "message".to_string(),
            "behavior".to_string(),
            "domain".to_string(),
        ];

        let response = service.score_request(&request);

        assert_eq!(response.decision.reason_codes, vec!["outcome_no_elevated_signal"]);
        assert_eq!(response.decision.recommended_action, humanify_proto::Action::None);
    }
}
