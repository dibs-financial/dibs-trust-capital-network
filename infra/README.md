# DIBS Infrastructure

## Deployment

### `deployment/`
- Docker Compose for local development
- Kubernetes manifests for staging/production
- Terraform for cloud infrastructure provisioning

### `ci-cd/`
- GitHub Actions workflows for:
  - Contract compilation and testing (Foundry)
  - Backend build and test
  - Frontend build and test
  - Security scanning (Slither, Mythril)
  - Fuzz testing automation
  - Fork testing on mainnet
  - Deployment gates requiring two-audit sign-off

### `monitoring/`
- Health check configurations
- Alerting rules for:
  - Covenant breach/warning
  - Capital Preservation Mode trigger
  - Oracle staleness
  - Liquidity threshold approach
  - Settlement exception
  - Emergency pause events
- Dashboards for:
  - System health
  - Tranche NAV and junior ratio
  - Reserve health
  - Withdrawal queue depth
  - Strategy exposure
