//! Purpose: minimal moderator-outcome learning ingestion for the Rust scaffold.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\data-platform.md
//!
//! Upstream docs:
//! - https://docs.rs/fastembed/latest/fastembed/
//! - https://burn.dev/books/burn/
//! - https://docs.rs/serde_json/latest/serde_json/
//!
//! Tests:
//! - cargo test --workspace

use humanify_core::CONTRACT_VERSION;
use humanify_proto::{CaseOutcome, CaseOutcomeType, LearnedSignal, LearnedSignalType};
use serde::{Deserialize, Serialize};

/// Real-but-minimal learning summary returned by the scaffolded learning service.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearningIngestSummary {
    /// Shared contract version.
    pub contract_version: String,
    /// Accepted case identifier.
    pub case_id: String,
    /// Whether the learning service accepted the outcome.
    pub accepted: bool,
    /// Candidate learned signals produced by this outcome.
    pub candidate_signals: Vec<LearnedSignal>,
    /// Operational notes for downstream persistence/indexing.
    pub notes: Vec<String>,
}

/// Minimal learning service that derives candidate signals from moderator outcomes.
#[derive(Debug, Default, Clone)]
pub struct LearningService;

impl LearningService {
    /// Ingests a case outcome and produces candidate learned signals.
    pub fn ingest_case_outcome(&self, outcome: &CaseOutcome) -> LearningIngestSummary {
        let candidate_signal = candidate_signal_from_outcome(outcome);
        let mut notes = vec![
            "Postgres remains the canonical owner for outcomes and learned-signal persistence."
                .to_string(),
            "Embedding generation and calibration stay behind future fastembed/Burn backends."
                .to_string(),
        ];

        if candidate_signal.is_none() {
            notes.push("Outcome accepted without producing a new learned signal.".to_string());
        }

        LearningIngestSummary {
            contract_version: CONTRACT_VERSION.to_string(),
            case_id: outcome.case_id.clone(),
            accepted: true,
            candidate_signals: candidate_signal.into_iter().collect(),
            notes,
        }
    }
}

fn candidate_signal_from_outcome(outcome: &CaseOutcome) -> Option<LearnedSignal> {
    let (kind, weight, true_positive_count, false_positive_count) = match outcome.outcome {
        CaseOutcomeType::ConfirmedScam => (LearnedSignalType::TextSimilarity, 2.5, 1, 0),
        CaseOutcomeType::ConfirmedBot => (LearnedSignalType::BehaviorPattern, 2.0, 1, 0),
        CaseOutcomeType::ConfirmedHackedAccount => (LearnedSignalType::ServerTrust, 1.5, 1, 0),
        CaseOutcomeType::FalsePositive => return None,
        CaseOutcomeType::Dismissed => return None,
        CaseOutcomeType::Overturned => return None,
    };

    Some(LearnedSignal {
        id: format!("ls_candidate_{}", outcome.case_id),
        kind,
        value_hash: format!("case_outcome:{}", outcome.subject_user_id_hash),
        weight,
        confidence: outcome.confidence,
        source_case_ids: vec![outcome.case_id.clone()],
        false_positive_count,
        true_positive_count,
        last_seen_at: outcome.decided_at.clone(),
        expires_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::LearningService;
    use humanify_proto::{CaseOutcome, CaseOutcomeType};

    #[test]
    fn confirmed_scam_outcome_produces_candidate_signal() {
        let service = LearningService;
        let outcome = CaseOutcome {
            case_id: "case_123".to_string(),
            guild_id: "guild_123".to_string(),
            subject_user_id_hash: "blake3:user_123".to_string(),
            outcome: CaseOutcomeType::ConfirmedScam,
            confidence: 0.92,
            decided_by: "mod_123".to_string(),
            decided_at: "2026-01-15T18:42:11Z".to_string(),
            reason_codes: vec!["malicious_domain_pattern".to_string()],
            evidence_refs: vec!["evi_123".to_string()],
        };

        let summary = service.ingest_case_outcome(&outcome);

        assert!(summary.accepted);
        assert_eq!(summary.candidate_signals.len(), 1);
        assert_eq!(summary.candidate_signals[0].source_case_ids, vec!["case_123"]);
    }
}
