# DIBS Frontend

## Application Surfaces

### `operator/`
- Enterprise operator console — full system administration and monitoring

### `lender/`
- Lender dashboard — draw approvals, covenant status, collateral overview

### `sponsor/`
- Sponsor dashboard — project status, draw requests, budget tracking

### `borrower/`
- Borrower draw-request portal — submit requests, upload evidence, track status

### `evidence/`
- Evidence-upload workflow — multi-format document submission with validation feedback

### `covenant/`
- Covenant dashboard — real-time covenant state, breach alerts, cure tracking

### `collateral/`
- Collateral dashboard — LTV, lien status, valuation freshness, hazard flags

### `analytics/`
- Sentinel/Catalyst analytics — NAV, junior ratio, reserve health, APY, withdrawal queue

### `policy-loan/`
- Policy-loan arbitrage dashboard — loan balance, spread economics, LTV creep, risk alerts

### `audit/`
- Audit and event viewer — immutable event log, hash-linked chain verification

### `admin/`
- Admin and compliance portal — user management, policy configuration, compliance overrides

## Tech Stack
- **Framework**: React with TypeScript (strict)
- **Build**: Vite
- **State**: Zustand or Redux Toolkit
- **API**: tRPC or REST with OpenAPI schema
- **Charts**: Recharts or TradingView Lightweight Charts for analytics
- **Real-time**: WebSocket for institutional telemetry tier
