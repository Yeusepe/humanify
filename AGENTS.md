# AGENTS.md

This is the working contract for any coding agent operating in this repository.

An agent must not write code as if this were a blank project. Every meaningful change must be grounded in:

1. The repository's local architecture, product, and operating documentation
2. Relevant upstream package, framework, protocol, or service references
3. Executable tests written before or alongside implementation

If an agent cannot identify the governing local docs and upstream references for a change, it is not ready to code that change.

---

## 1. Non-negotiable rules

### 1.1 Work TDD-first

- Start with docs and contracts if the change affects architecture, APIs, data models, workflows, or user-visible behaviour.
- Write failing tests before implementation when executable tests are practical.
- Do not treat tests as cleanup or follow-up work.
- Run all relevant tests after every change.
- Run linting, formatting, type-checking, security scans, or equivalent quality gates after every meaningful change.
- A change without a relevant test run and quality check is not complete.

### 1.2 Never mock or stub production functionality

Production code must use real dependencies and real control flow.

- If a component needs a dependency, wire the real dependency.
- If the real dependency cannot be wired, fail with an explicit error.
- Do not fake production behaviour to make a feature appear complete.
- Mocks are acceptable only in tests where they are the correct level of isolation.
- Prefer integration tests with real services, local emulators, containers, or official sandboxes when validating system boundaries.
- A stub in production code is a bug. Treat it as one.

It is better for the system to fail clearly than to succeed through fake behaviour.

### 1.3 Never implement workarounds

A workaround is a change that produces the desired output temporarily while violating the architecture, bypassing the proper system, or creating hidden dependencies that will break later.

Workarounds are not acceptable. If a solution requires a workaround, stop and design the proper flow.

Signs you are writing a workaround:

- Special-casing one provider, customer, entity, or path instead of using the general system.
- Reading data that happens to be available instead of the architecturally correct source.
- Duplicating existing logic rather than calling or extending the existing implementation.
- Adding flags, conditionals, environment switches, or runtime directives only to avoid a proper architectural change.
- Creating behaviour that works today but would silently break if surrounding systems changed.

The correct response is always: design the proper flow, implement it properly, and test it properly.

### 1.4 Map every change to governing docs

- Before coding, identify which local docs govern the change.
- Update those docs when the change affects architecture, contracts, operations, data models, security, or behaviour.
- If the repo lacks a governing doc for a meaningful change, create or update one before or alongside implementation.

### 1.5 Attach references to code changes

Every new source file, major module, workflow, adapter, route, job, or integration must include traceability to:

- The local docs that govern it
- The upstream external docs it depends on
- The tests that prove it works

### 1.6 Do not invent core platform semantics casually

- Reuse architecture established by the repository.
- If a change alters core semantics, update architecture docs, ADRs, contracts, or equivalent records first or alongside the change.
- Make breaking changes explicit and documented.

### 1.7 Keep implementation traceable

Code, tests, docs, and operational expectations must move together.

For meaningful changes, the pull request or change summary should explain:

- Why the change exists
- Which docs govern it
- Which upstream behaviour it relies on
- Which tests prove it
- Which operational concerns changed, if any

### 1.8 Search official sources before writing integration code

Before writing code that integrates with, wraps, configures, or calls an external library, framework, service, SDK, or protocol:

1. Search for and read the official documentation.
2. Prefer LLM-friendly docs, generated API references, examples, and migration guides when available.
3. Verify against the installed package's types, source, or generated client where applicable.
4. Do not rely on memory for APIs, method signatures, configuration shapes, endpoint paths, or component patterns.
5. Do not guess. Look it up, then verify locally.

This applies to every external dependency in the stack.

### 1.9 Use what libraries and platforms already provide

Before writing any new integration module, wrapper, client, middleware, provider, cache, retry layer, parser, or adapter, determine what the upstream library or platform already provides.

- Use official SDKs before hand-rolled HTTP clients.
- Use official companion packages before custom providers.
- Use built-in middleware before custom middleware.
- Use framework primitives before recreating framework behaviour.
- Use library-provided validation, parsing, auth, retries, and caching when they fit the requirement.
- If the library provides most of what is needed, write a thin adapter for the gap rather than reimplementing internals.

Custom code should exist only where the repository has a real domain-specific need.

---

## 2. Required reading before coding

Before any non-trivial task, read the relevant local documentation. Common sources include:

1. `README.md`
2. Documentation index files such as `docs/README.md`
3. Architecture or system overview docs
4. Service, API, or module-specific docs
5. Domain model, data model, or contract docs
6. Security, observability, operations, and testing docs
7. ADRs, design notes, or implementation plans related to the change area

Then read upstream documentation for every external dependency involved in the change.

If these docs do not exist, add the minimum useful documentation needed to make the change reviewable and maintainable.

---

## 3. Documentation map for coding work

Use the closest matching local docs for the area you touch. If a row is missing, create or update the appropriate local documentation.

| If you touch... | Read and follow... |
| --- | --- |
| Public APIs, routes, controllers, RPC, GraphQL, or protocol contracts | API docs, service architecture docs, auth and authorization docs, interface/data-flow docs |
| Database schema, migrations, persistence, or repositories | Data model docs, migration docs, transaction/concurrency docs, backup/restore docs |
| Authentication, authorization, identity, sessions, or permissions | Security docs, threat model, auth provider docs, policy docs |
| UI components, design systems, styling, themes, or accessibility | Design system docs, accessibility docs, component library docs, installed component types |
| Payments, billing, licensing, subscriptions, or financial flows | Billing architecture docs, provider docs, compliance/security docs, reconciliation docs |
| Search, indexing, recommendation, embedding, or ranking systems | Search/relevance docs, indexing docs, provider docs, data freshness docs |
| File upload, media processing, storage, or CDN integration | Storage architecture docs, file validation docs, provider docs, security docs |
| Background jobs, queues, schedulers, or workflows | Job/workflow docs, retry/idempotency docs, operations docs |
| Webhooks, inbound events, outbound events, or integrations | Event contract docs, provider docs, signature verification docs, replay/idempotency docs |
| Observability, logging, tracing, metrics, or alerting | Observability docs, OpenTelemetry or platform docs, runbooks |
| Feature flags, experiments, or configuration | Configuration docs, feature flag provider docs, rollout docs |
| CI/CD, deployment, infrastructure, or environments | Deployment docs, infrastructure docs, secrets docs, rollback docs |
| Security-sensitive code | Threat model, OWASP guidance, secure development lifecycle docs, provider security docs |

---

## 4. External dependency reference rule

For any external API, SDK, library, service, protocol, or platform behaviour, the agent must:

1. Cite or link the relevant documentation in the plan, code comment, module header, or supporting docs.
2. Verify the endpoint, method, type, prop, option, or configuration shape before implementing.
3. Verify response and error shapes after implementing.
4. Avoid assuming endpoint paths, method names, exports, or configuration keys.

Example reference header:

```ts
/**
 * Purpose: Creates checkout sessions and records their lifecycle events.
 * Governing docs:
 *   - docs/architecture.md
 *   - docs/billing.md
 *   - docs/security.md
 * External references:
 *   - https://example-provider.com/docs/checkout
 *   - https://example-provider.com/docs/webhooks
 * Tests:
 *   - tests/billing/create-checkout-session.test.ts
 *   - tests/billing/checkout-webhook.test.ts
 */
```

### 4.1 Library and SDK API verification rule

Before writing code that calls a library function, accesses a type, uses a component, or passes a configuration object:

1. Inspect the installed package types, generated clients, source, or local API definitions.
2. Verify named exports vs default exports.
3. Verify method signatures, constructor arguments, return types, and error types.
4. Verify discriminated unions using their actual discriminant properties.
5. Verify configuration object shape and required fields.
6. Verify version-specific behaviour against the installed dependency version.

The 30-second rule: spending 30 seconds reading the installed types can save 30 minutes debugging a wrong assumption.

### 4.2 UI component usage rule

Before writing code with any UI library or design system:

1. Read the project's design system docs.
2. Read the official docs for the specific component.
3. Verify the installed component API and types.
4. Follow the library's intended composition patterns.
5. Do not assume prop names, slot names, variants, event names, accessibility behaviour, or theming APIs.
6. Do not hard-code semantic colours, spacing, or typography when the design system provides tokens.

### 4.3 External service call rule

For outbound calls to external systems:

- Use the official SDK or generated client when available and appropriate.
- Use existing repository resilience utilities for timeouts, retries, circuit breakers, and backoff.
- Retry only safe and idempotent operations.
- Propagate trace context when crossing service boundaries.
- Emit useful spans, metrics, and structured logs.
- Attach provider error context without logging secrets or sensitive data.
- Validate and narrow response shapes before using them.

---

## 5. Analytics and observability-first implementation

Analytics, logging, tracing, and metrics are part of the architecture, not optional extras.

- Every new request path, mutation, job, workflow, webhook, verification flow, and provider integration must preserve or extend existing observability coverage.
- When touching existing flows, use the shared observability utilities rather than isolated logging or timing logic.
- If a change creates a boundary between systems, propagate trace context across that boundary.
- Do not remove, bypass, or silently degrade analytics, logs, metrics, or traces unless explicitly approved and documented.
- When choosing between equivalent implementations, prefer the one that keeps behaviour observable and diagnosable.

---

## 6. Security rules

### 6.1 Security engineering principles

Follow industry-standard security engineering practices:

- Defence in depth
- Secure defaults
- Least privilege
- Fail closed
- Explicit trust boundaries
- Auditable access and mutation paths

### 6.2 Input, output, and data handling

- Validate all external input at the first boundary.
- Use typed schemas or validators for API, event, job, and configuration inputs.
- Use parameterised queries for database access.
- Encode output to prevent injection and XSS.
- Use CSRF protection for state-changing browser requests where applicable.
- Treat uploaded files as untrusted until validated.
- Validate file signatures and content type where relevant.
- Preserve quarantine or rejection paths for suspicious inputs.

### 6.3 Secrets and sensitive data

- Never commit secrets to source control.
- Never log secrets, tokens, credentials, or sensitive personal data.
- Never include secrets in error responses.
- Use environment variables, secret managers, or platform secret stores for credentials.
- Redact sensitive values in logs, traces, metrics, and test snapshots.

### 6.4 Authorization and access control

- Enforce authorization at the server or trusted boundary.
- Do not rely on client-side checks for access control.
- Deny by default when authorization context is missing or ambiguous.
- Test positive and negative authorization cases.

---

## 7. TDD workflow

Follow this order for every non-documentation-only task:

1. Identify governing docs.
2. Identify upstream references.
3. Update docs or contracts if needed.
4. Write failing tests at the correct layer.
5. Implement the smallest correct change that makes the tests pass.
6. Run relevant tests.
7. Run linting, formatting, type-checking, and security checks as applicable.
8. Update traceability if the change is architecturally meaningful.

### 7.1 Test execution commands

Use the commands defined by the repository. Common examples include:

```bash
# Install dependencies
<package-manager> install

# Run all tests
<package-manager> test

# Run unit tests
<package-manager> run test:unit

# Run integration tests
<package-manager> run test:integration

# Run end-to-end tests
<package-manager> run test:e2e

# Run linting
<package-manager> run lint

# Run formatting check
<package-manager> run format:check

# Run type-checking
<package-manager> run typecheck

# Run all checks
<package-manager> run check
```

If these commands do not exist, follow the repository's conventions and add missing scripts when the task requires them.

---

## 8. Resilient coding rules for agents

Agents are expected to produce code that is resilient, diagnosable, and reviewable by default.

1. Make invariants explicit in types, validation, and tests.
2. Validate external input at the first boundary.
3. Do not hide failures behind silent fallbacks or broad catches.
4. Attach enough context to errors and logs for production diagnosis.
5. Bound I/O and remote work with explicit timeouts.
6. Retry only safe and idempotent operations with bounded backoff.
7. Prefer explicit data flow over ambient mutable state.
8. Keep modules single-purpose and named by domain responsibility.
9. Write tests for failure paths, replay behaviour, and idempotency.
10. Measure hot paths before claiming optimisation.
11. Keep structured logs, metrics, and traces in mind for operator-relevant paths.
12. Treat cache, queue, and workflow state as supporting state unless docs define it as canonical business truth.
13. For mutating APIs, document the idempotency plan: key scope, duplicate behaviour, and durable completion evidence.
14. For database changes, document transaction, isolation, lock, and optimistic-concurrency expectations.
15. For workflow changes, cover replay, versioning behaviour, and retry semantics in tests.
16. For ingest changes, validate file signatures and preserve quarantine or rejection paths for suspicious inputs.
17. Use typed API errors unless a narrower contract is defined.
18. Do not leave floating promises or undocumented fire-and-forget behaviour.
19. Prefer boring, well-supported, upstream-supported solutions over bespoke infrastructure.
20. Keep performance, resilience, and security decisions explicit and reviewable.

---

## 9. Documentation attached to code

### 9.1 For every new source file

Attach a concise header or nearby documentation that states:

- File or module purpose
- Governing local docs
- Upstream external references
- Test location or test evidence

Minimum reference header format:

```ts
/**
 * Purpose: <what this module does>
 * Governing docs:
 *   - docs/<relevant-doc>.md
 * External references:
 *   - https://<official-upstream-doc>
 * Tests:
 *   - tests/<relevant-test>.test.ts
 */
```

Use the commenting style appropriate to the language.

### 9.2 For every changed module or subsystem

Update or create the nearest supporting documentation:

- Module README
- Design note
- ADR
- API contract
- Runbook
- Governing architecture doc section

---

## 10. Required change bundle

For every meaningful code change, the agent must deliver:

- Implementation code
- Tests at the correct layer
- Documentation updates when behaviour, architecture, contracts, operations, or security posture changes
- Local doc references
- External references for upstream behaviour
- Evidence that relevant checks were run

If one of these is missing, the work is probably incomplete.

---

## 11. Definition of done

An agent is not done when code compiles or tests pass once.

Work is done when:

1. Governing docs were identified and updated if necessary.
2. Code has attached documentation and references where appropriate.
3. Tests exist at the correct layer.
4. Implementation matches the repository architecture.
5. Operational implications are reflected where relevant.
6. Traceability is preserved.
7. Observability coverage is preserved or extended.
8. No production stubs, fake implementations, or workaround flows were introduced.
9. Relevant tests pass.
10. Relevant linting, formatting, type-checking, and security checks pass.
11. The final change summary includes what changed, why, tests run, and any follow-up risks.

---

## 12. Anti-patterns for agents

Do not:

- Write integration code without reading official docs first.
- Code library calls from memory.
- Assume method signatures, type shapes, endpoint paths, prop names, event names, or config objects.
- Reinvent functionality that installed or official libraries already provide.
- Write HTTP clients for APIs that have suitable official SDKs or generated clients.
- Write custom providers, adapters, caches, or middleware when official ones exist and meet the need.
- Write authentication, token validation, crypto, or session logic when the auth library provides it.
- Add a package without documenting why it is preferred over existing or alternative options.
- Add routes, RPC methods, events, jobs, or workflows without updating contracts or docs when needed.
- Add storage logic without documenting canonical vs derived responsibilities.
- Hide core behaviour in undocumented utility functions.
- Claim TDD while writing tests only after implementation.
- Optimise by folklore instead of measurement.
- Strip context from errors, logs, traces, or metrics.
- Stub, mock, or fake production dependencies.
- Implement workaround paths instead of proper architectural solutions.
- Remove or bypass observability coverage.
- Commit developer-local paths, usernames, machine-specific settings, or secrets.
- Hard-code design tokens when the project provides a design system.
- Add broad catch blocks, silent fallbacks, or swallowed promises.
- Leave TODOs that mask incomplete behaviour.

---

## 13. Parallel agents and delegated work

When delegating work to sub-agents or parallel coding agents, every prompt must include the relevant parts of this contract.

At minimum, remind delegated agents to:

1. Read governing local docs before coding.
2. Search official upstream docs before writing integration code.
3. Inspect installed types or generated clients before calling library APIs.
4. Use official SDKs, companion packages, and built-in features before writing custom code.
5. Preserve observability and propagate trace context across service boundaries.
6. Use existing resilience utilities for outbound calls.
7. Write tests first, then implement.
8. Add documentation headers or references for new source files and major modules.
9. Avoid production stubs, fake implementations, and workarounds.
10. Report tests and checks run.

Read-only research agents may inspect and summarize. Coding agents must follow the full implementation workflow.

---

## 14. Working principle

Code is never just code.

Every meaningful implementation artifact must be linked to:

- Why it exists: requirement, user story, defect, incident, or architectural decision
- Which docs govern it: architecture, contracts, operations, security, or design docs
- Which upstream behaviour it relies on: official API, SDK, library, protocol, or framework docs
- Which tests prove it: unit, integration, end-to-end, contract, regression, or security tests

Build the smallest correct solution that fits the repository architecture, uses upstream capabilities, is tested, is observable, and is easy for the next maintainer to understand.
