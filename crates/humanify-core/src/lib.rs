//! Purpose: shared Rust service metadata, bind-address handling, and tracing bootstrap.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\workspaces.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://doc.rust-lang.org/cargo/reference/workspaces.html
//! - https://docs.rs/tokio/latest/tokio/
//! - https://docs.rs/tracing/latest/tracing/
//! - https://docs.rs/tower-http/latest/tower_http/trace/
//!
//! Tests:
//! - cargo test --workspace

use serde::Serialize;
use std::{env, net::SocketAddr, sync::OnceLock};
use tracing_subscriber::EnvFilter;

/// The current Bun↔Rust contract version documented in `docs\contracts.md`.
pub const CONTRACT_VERSION: &str = "0.1.0";

/// Static metadata shared by Rust HTTP services and workers.
#[derive(Debug, Clone)]
pub struct ServiceDescriptor {
    /// Human-readable service name.
    pub name: &'static str,
    /// Environment variable used to override the bind address.
    pub bind_addr_env: &'static str,
    /// Default TCP port used during local development.
    pub default_port: u16,
    /// Whether the service remains advisory-only.
    pub advisory_only: bool,
    /// High-level service responsibilities.
    pub responsibilities: &'static [&'static str],
    /// Governing local documentation.
    pub governing_docs: &'static [&'static str],
    /// Official upstream documentation references.
    pub upstream_docs: &'static [&'static str],
}

impl ServiceDescriptor {
    /// Creates a new static service descriptor.
    pub const fn new(
        name: &'static str,
        bind_addr_env: &'static str,
        default_port: u16,
        advisory_only: bool,
        responsibilities: &'static [&'static str],
        governing_docs: &'static [&'static str],
        upstream_docs: &'static [&'static str],
    ) -> Self {
        Self {
            name,
            bind_addr_env,
            default_port,
            advisory_only,
            responsibilities,
            governing_docs,
            upstream_docs,
        }
    }

    /// Resolves the socket address from environment or the service default.
    pub fn bind_address(&self) -> Result<SocketAddr, std::net::AddrParseError> {
        env::var(self.bind_addr_env)
            .unwrap_or_else(|_| format!("127.0.0.1:{}", self.default_port))
            .parse()
    }

    /// Builds a JSON-friendly health response.
    pub fn health_report(&self) -> HealthReport {
        HealthReport {
            service: self.name,
            status: "ok",
            contract_version: CONTRACT_VERSION,
            advisory_only: self.advisory_only,
        }
    }

    /// Builds a JSON-friendly service metadata response.
    pub fn service_info(&self) -> ServiceInfo {
        ServiceInfo {
            service: self.name,
            version: env!("CARGO_PKG_VERSION"),
            contract_version: CONTRACT_VERSION,
            bind_addr_env: self.bind_addr_env,
            default_port: self.default_port,
            advisory_only: self.advisory_only,
            responsibilities: self.responsibilities,
            governing_docs: self.governing_docs,
            upstream_docs: self.upstream_docs,
        }
    }
}

/// Lightweight health response used by service skeletons.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    /// Service identifier.
    pub service: &'static str,
    /// Health status.
    pub status: &'static str,
    /// Shared contract version.
    pub contract_version: &'static str,
    /// Whether the service is advisory-only.
    pub advisory_only: bool,
}

/// JSON-serializable service metadata for operator introspection.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    /// Service identifier.
    pub service: &'static str,
    /// Crate version.
    pub version: &'static str,
    /// Shared contract version.
    pub contract_version: &'static str,
    /// Environment variable used for bind-address overrides.
    pub bind_addr_env: &'static str,
    /// Default TCP port.
    pub default_port: u16,
    /// Whether the service is advisory-only.
    pub advisory_only: bool,
    /// High-level service responsibilities.
    pub responsibilities: &'static [&'static str],
    /// Governing local docs.
    pub governing_docs: &'static [&'static str],
    /// Upstream docs.
    pub upstream_docs: &'static [&'static str],
}

/// Initializes JSON tracing output once per process.
pub fn init_tracing(service_name: &'static str) {
    static INIT: OnceLock<()> = OnceLock::new();

    INIT.get_or_init(|| {
        let fallback_filter = format!("{service_name}=info,tower_http=info");
        let filter =
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(fallback_filter));

        let _ =
            tracing_subscriber::fmt().with_env_filter(filter).json().with_target(true).try_init();
    });
}

#[cfg(test)]
mod tests {
    use super::{CONTRACT_VERSION, ServiceDescriptor};

    #[test]
    fn service_descriptor_builds_health_and_info_reports() {
        let descriptor = ServiceDescriptor::new(
            "example-rs",
            "EXAMPLE_BIND_ADDR",
            5000,
            true,
            &["health", "metadata"],
            &["AGENTS.md"],
            &["https://docs.rs/axum/latest/axum/"],
        );

        let health = descriptor.health_report();
        let info = descriptor.service_info();

        assert_eq!(health.status, "ok");
        assert_eq!(health.contract_version, CONTRACT_VERSION);
        assert_eq!(info.service, "example-rs");
        assert!(info.advisory_only);
    }
}
