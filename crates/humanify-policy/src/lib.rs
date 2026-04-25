//! Purpose: Rust-side advisory boundary helpers that prevent service outputs from implying enforcement.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/serde_json/latest/serde_json/
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//!
//! Tests:
//! - cargo test --workspace

use humanify_core::CONTRACT_VERSION;
use humanify_proto::{Action, RiskDecision};
use serde::{Deserialize, Serialize};

/// Forbidden contract fields called out by `docs\contracts.md`.
pub const FORBIDDEN_WIRE_FIELDS: &[&str] = &["execute", "allowedAction", "enforceNow", "autoBan"];

/// Rust-side advisory safety boundary.
#[derive(Debug, Clone)]
pub struct AdvisoryBoundary {
    max_advisory_action: Action,
}

impl Default for AdvisoryBoundary {
    fn default() -> Self {
        Self { max_advisory_action: Action::Quarantine }
    }
}

impl AdvisoryBoundary {
    /// Returns the highest action the Rust side may surface directly.
    pub fn max_advisory_action(&self) -> Action {
        self.max_advisory_action
    }

    /// Clamps an action to the Rust-side advisory ceiling.
    pub fn clamp(&self, action: Action) -> Action {
        std::cmp::min(action, self.max_advisory_action)
    }

    /// Summarizes a decision through the Rust-side advisory boundary.
    pub fn summarize(&self, decision: &RiskDecision) -> AdvisoryTrustSummary {
        AdvisoryTrustSummary {
            contract_version: CONTRACT_VERSION.to_string(),
            advisory_only: true,
            recommended_action: decision.recommended_action,
            clamped_action: self.clamp(decision.recommended_action),
            forbidden_wire_fields: FORBIDDEN_WIRE_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect(),
            notes: vec![
                "Bun remains authoritative for policy evaluation and execution.".to_string(),
                "Rust services may score, hash, learn, or summarize but never execute moderation."
                    .to_string(),
            ],
        }
    }
}

/// Trust-summary response used by `services\trust-rs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryTrustSummary {
    /// Shared contract version.
    pub contract_version: String,
    /// Whether the response remains advisory-only.
    pub advisory_only: bool,
    /// Action recommended by the upstream Rust logic.
    pub recommended_action: Action,
    /// Action after applying the Rust-side ceiling.
    pub clamped_action: Action,
    /// Explicitly forbidden transport fields.
    pub forbidden_wire_fields: Vec<String>,
    /// Human-readable safety notes.
    pub notes: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::{AdvisoryBoundary, FORBIDDEN_WIRE_FIELDS};
    use humanify_proto::{Action, RiskDecision};

    #[test]
    fn boundary_clamps_irreversible_actions() {
        let boundary = AdvisoryBoundary::default();
        let decision = RiskDecision {
            user_id: "user_123".to_string(),
            guild_id: "guild_123".to_string(),
            score: 10,
            confidence: 0.98,
            reason_codes: vec!["mention_burst".to_string()],
            recommended_action: Action::Ban,
            evidence_refs: vec!["evi_123".to_string()],
            expires_at: None,
        };

        let summary = boundary.summarize(&decision);

        assert_eq!(summary.recommended_action, Action::Ban);
        assert_eq!(summary.clamped_action, Action::Quarantine);
        assert_eq!(summary.forbidden_wire_fields.len(), FORBIDDEN_WIRE_FIELDS.len());
    }
}
