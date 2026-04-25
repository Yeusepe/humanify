//! Purpose: deterministic risk-scoring helpers shared by inference and trust-aware services.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\contracts.md
//!
//! Upstream docs:
//! - https://docs.rs/serde_json/latest/serde_json/
//! - https://docs.rs/axum/latest/axum/struct.Json.html
//!
//! Tests:
//! - cargo test --workspace

use humanify_proto::Action;

/// A single deterministic scoring finding.
#[derive(Debug, Clone, PartialEq)]
pub struct RuleFinding {
    /// Stable reason code emitted by the rule.
    pub reason_code: &'static str,
    /// Raw additive points contributed by the rule.
    pub points: f32,
}

impl RuleFinding {
    /// Creates a new scoring finding.
    pub const fn new(reason_code: &'static str, points: f32) -> Self {
        Self { reason_code, points }
    }
}

/// Sums raw points from a set of findings.
pub fn raw_points(findings: &[RuleFinding]) -> f32 {
    findings.iter().map(|finding| finding.points).sum()
}

/// Maps raw points to the documented 1–10 score range.
pub fn raw_to_score(raw: f32) -> u8 {
    let score = 1.0 + 9.0 * (1.0 / (1.0 + (-0.75 * (raw - 4.0)).exp()));
    score.round().clamp(1.0, 10.0) as u8
}

/// Converts raw points into a bounded confidence.
pub fn confidence_from_raw(raw: f32) -> f64 {
    (0.35 + (raw as f64 / 10.0)).clamp(0.35, 0.98)
}

/// Maps the raw score to the full advisory action ladder.
pub fn default_recommended_action(score: u8) -> Action {
    match score {
        1..=3 => Action::None,
        4..=5 => Action::Watch,
        6 => Action::Verify,
        7..=8 => Action::Quarantine,
        9 => Action::Timeout,
        _ => Action::Ban,
    }
}

#[cfg(test)]
mod tests {
    use super::{RuleFinding, confidence_from_raw, default_recommended_action, raw_to_score};
    use humanify_proto::Action;

    #[test]
    fn logistic_score_stays_inside_contract_bounds() {
        let findings = [RuleFinding::new("account_age_lt_24h", 2.5)];
        let score = raw_to_score(super::raw_points(&findings));

        assert!((1..=10).contains(&score));
        assert_eq!(default_recommended_action(10), Action::Ban);
    }

    #[test]
    fn confidence_is_clamped() {
        assert_eq!(confidence_from_raw(0.0), 0.35);
        assert_eq!(confidence_from_raw(100.0), 0.98);
    }
}
