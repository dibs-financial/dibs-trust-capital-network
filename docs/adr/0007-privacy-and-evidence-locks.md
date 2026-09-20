# ADR-0007: Policy version and evidence manifest lock at submit

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A

## Context

If policy or evidence can change after submit, an approval can bind to a different package than the one reviewed.

## Options

1. Live-read policy and evidence at approve time.
2. Lock policy version and evidence manifest hash on SUBMITTED. Approve against the locks.
3. Snapshot the entire policy document into the event payload.

## Decision

Option 2.

lockedPolicyVersion and lockedEvidenceManifestHash are set by submit and then immutable for that draw. approvalFailures requires policyVersionMatchesLock and manifestHashMatchesLock. A policy edit creates a new version; in-flight draws keep the old one.

## Consequences

- Good: the audit event names the exact policy and evidence bundle.
- Good: reviewers can re-hash the manifest and match the lock.
- Bad: a needed policy fix does not apply mid-draw. Recourse is reject / expire / new draw.
- Bad: full snapshot is still allowed as payload extra, not required.
