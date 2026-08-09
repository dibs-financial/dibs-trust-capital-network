# Contributing

DIBS Trust Capital Network is currently in **Phase 0 — Validation and Foundation**. The repository is private and contributions are limited to authorized team members.

## Process

1. Create a feature branch from `main` (`feat/`, `fix/`, `docs/`, `infra/`)
2. Ensure all tests pass (`npm test` / `forge test`)
3. Submit a pull request with a clear description of changes
4. Require at least one review before merge
5. Squash-merge into `main`

## Code Standards

- **Contracts**: Solidity with Foundry toolchain, NatSpec comments required on all external functions
- **Backend**: TypeScript, strict mode, full type coverage
- **Frontend**: TypeScript, React, strict ESLint configuration
- **Shared**: All types and schemas must be versioned

## Security

- Never commit secrets, API keys, or private keys
- Report security vulnerabilities privately to the security lead
- All contract changes require invariant and fuzz test coverage
- Material deployments require two independent tier-1 audits

## Branch Naming

```
feat/controlled-draw-state-machine
fix/covenant-evaluation-edge-case
docs/erc4626-vault-spec
infra/deployment-pipeline
```

---

**Proprietary & Confidential** — © Cornerstone Creative Capital LLC. All rights reserved.
