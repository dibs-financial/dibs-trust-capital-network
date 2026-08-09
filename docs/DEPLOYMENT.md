# DIBS Trust Capital Network — Production Deployment Guide

## 1. Prerequisites & Infrastructure Requirements

Before deploying the DIBS Trust Capital Network to production or staging environments, verify that all host systems and infrastructure dependencies meet the minimum requirements outlined below.

### 1.1 Node.js & Toolchain
- **Node.js**: Version `20.x` LTS (Active LTS, e.g., v20.11.0+).
- **npm**: Version `10.x` or higher (bundled with Node 20).
- **TypeScript**: Version `5.4.x` (managed via project `devDependencies`).

### 1.2 Smart Contract Toolchain (Foundry)
- **Foundry Toolchain**: `forge` and `cast` v1.7.1 or higher.
- Installation:
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  foundryup
  ```
- Verify installation:
  ```bash
  forge --version
  cast --version
  ```

### 1.3 Blockchain Node / RPC Providers
- **Primary EVM RPC Provider**: High-availability RPC endpoint (e.g., Alchemy, Infura, Chainstack, QuickNode).
  - Target Networks: Ethereum Mainnet (`1`), Sepolia Testnet (`11155111`), Arbitrum One (`42161`), Optimism Mainnet (`10`).
  - WebSockets / HTTP RPC connection supporting `eth_call`, `eth_sendRawTransaction`, `eth_getLogs`, and trace APIs.

### 1.4 Database Infrastructure
- **PostgreSQL**: Version `15.0` or higher.
  - Connection pool capacity: Minimum 20 concurrent connections.
  - Storage: SSD-backed persistent storage with automated daily snapshot backups.
- **Redis**: Version `7.0` or higher.
  - Primary use: Session caching, API rate limiting, pub/sub event stream distribution.
  - Persistence: RDB + AOF enabled for durability.

---

## 2. Environment Variables Reference

Configuration across all monorepo components is managed via environment variables. The repository includes `.env.example` as a master template. Copy this file to `.env` before running or deploying services.

### 2.1 Smart Contracts & EVM Blockchain Nodes
| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `MAINNET_RPC_URL` | Yes (Prod) | `https://eth-mainnet.g.alchemy.com/v2/...` | Ethereum Mainnet RPC endpoint |
| `SEPOLIA_RPC_URL` | Yes (Test) | `https://eth-sepolia.g.alchemy.com/v2/...` | Sepolia Testnet RPC endpoint |
| `ARBITRUM_RPC_URL` | Optional | `https://arb-mainnet.g.alchemy.com/v2/...` | Arbitrum One RPC endpoint |
| `OPTIMISM_RPC_URL` | Optional | `https://opt-mainnet.g.alchemy.com/v2/...` | Optimism Mainnet RPC endpoint |
| `CHAIN_ID` | Yes | `11155111` | Target EVM Chain ID (`1` = Mainnet, `11155111` = Sepolia) |
| `DEPLOYER_PRIVATE_KEY` | Yes | `0x...` (64 hex characters) | Private key for deployer account (requires gas balance) |
| `ETHERSCAN_API_KEY` | Yes | String | Etherscan API key for automated contract verification |
| `ARBISCAN_API_KEY` | Optional | String | Arbiscan API key for L2 contract verification |
| `OPTIMISTIC_ETHERSCAN_API_KEY` | Optional | String | Etherscan Optimism API key for L2 verification |
| `FORK_BLOCK_NUMBER` | Optional | `19000000` | Pin local anvil/forge fork tests to specific block |

### 2.2 Backend Server & API Gateway
| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` / `development` | Node runtime environment |
| `PORT` | Yes | `3000` | HTTP listening port for Express API Gateway |
| `LOG_LEVEL` | No | `info` (`debug`, `info`, `warn`, `error`) | Application log output verbosity |
| `JWT_SECRET` | Yes | High-entropy string (≥32 chars) | Secret key for signing session tokens and authorization headers |
| `API_SECRET_KEY` | Yes | High-entropy string (≥32 chars) | Secret key for internal service-to-service REST communication |

### 2.3 Database & Cache Infrastructure
| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/dbname` | Primary PostgreSQL database connection string |
| `REDIS_URL` | Yes | `redis://host:6379` | Redis cache, rate-limit, and event pub-sub store connection string |

### 2.4 External Integrations & Service Adapters
| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `VRDCT_API_KEY` | Yes | String | Credentials for VRDCT Trust Signal & Risk Monitoring API |
| `VRDCT_ENDPOINT_URL` | Yes | `https://api.vrdct.io/v1` | Base URL for VRDCT risk analytics service |
| `SETTLEMENT_BANK_API_KEY` | Yes | String | API key for partner banking settlement provider |
| `SETTLEMENT_BANK_URL` | Yes | `https://api.bank-partner.com/v2` | Endpoint URL for banking settlement service |
| `SANCTIONS_CHECK_API_KEY` | Yes | String | Credentials for KYC/AML & OFAC sanctions screening API |

### 2.5 Frontend Client Configuration (Vite)
*Note: Variables prefixed with `VITE_` are injected into the static client bundle during build time.*

| Variable Name | Required | Default / Format | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | Yes | `https://api.dibs.network/api` | Base URL of backend Express API Gateway |
| `VITE_CHAIN_ID` | Yes | `11155111` | Target EVM Chain ID for Web3 wallet providers |
| `VITE_APP_TITLE` | No | `DIBS Trust Capital Console` | Browser title bar and header title |

---

## 3. Smart Contract Deployment Sequence

Contract deployment follows a 12-step sequence to ensure that parameters, paired references, manager authorization, and non-redeemable seed liquidity are properly configured prior to accepting public deposits.

```
 [1. Deploy Asset] ---> [2. Sentinel Vault] ---> [3. Catalyst Vault]
                               |                        |
                               +------> [4. Set Min Junior Ratio (2000 bps)]
                               |                        |
                               +------> [5. Pair Vaults] <------------------+
                                                        |
 [6. Deploy PreservationManager] <----------------------+
           |
           +---> [7. Authorize Manager on Vaults]
           +---> [8. Set Liquidity Test Results = true]
           +---> [9. Set Minimum Seed Deposit]
           +---> [10. Seed Vaults (Permanent Lock = 0)]
           +---> [11. Assign Emergency Role (Optional)]
           +---> [12. Enable Catalyst Recapitalization (Optional)]
```

### 3.1 Step-by-Step Execution Guide

#### Step 1: Deploy Underlying Asset Token
Deploy an ERC-20 collateral asset token (e.g., USDC, DAI) or register an existing on-chain token address.
```bash
cast send --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY \
  "deployMockUSDC()"
```

#### Step 2: Deploy Sentinel Vault (Senior Class A)
Deploy `SentinelVault.sol` referencing the underlying asset, token name, token symbol, and initial deposit cap.
```bash
forge create contracts/vault/SentinelVault.sol:SentinelVault \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $ASSET_ADDRESS "DIBS Sentinel Senior Vault" "dSEN" $DEPOSIT_CAP \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

#### Step 3: Deploy Catalyst Vault (Subordinated Class B)
Deploy `CatalystVault.sol` referencing the underlying asset, token name, token symbol, and initial deposit cap.
```bash
forge create contracts/vault/CatalystVault.sol:CatalystVault \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $ASSET_ADDRESS "DIBS Catalyst First-Loss Vault" "dCAT" $DEPOSIT_CAP \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

#### Step 4: Configure Minimum Junior Ratio
Set the default minimum Junior Ratio threshold (`2000` basis points = `20.00%`) on both vaults.
```bash
cast send $SENTINEL_ADDRESS "setMinJuniorRatio(uint256)" 2000 --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "setMinJuniorRatio(uint256)" 2000 --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 5: Establish Vault Pairing
Link the Sentinel and Catalyst vaults to enable cross-vault Junior Ratio computation.
```bash
cast send $SENTINEL_ADDRESS "setPairedVault(address)" $CATALYST_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "setPairedVault(address)" $SENTINEL_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 6: Deploy Capital Preservation Manager
Deploy `CapitalPreservationManager.sol` configured with references to both vaults and the initial target reserve balance.
```bash
forge create contracts/vault/CapitalPreservationManager.sol:CapitalPreservationManager \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $SENTINEL_ADDRESS $CATALYST_ADDRESS $RESERVE_TARGET \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

#### Step 7: Authorize Preservation Manager on Vaults
Grant `preservationManager` operational authority on both Sentinel and Catalyst vaults.
```bash
cast send $SENTINEL_ADDRESS "setPreservationManager(address)" $MANAGER_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "setPreservationManager(address)" $MANAGER_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 8: Set Initial Liquidity Test Results
Initialize the liquidity test flag to `true` on both vaults to confirm initial liquidity compliance.
```bash
cast send $SENTINEL_ADDRESS "setLiquidityTestResult(bool)" true --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "setLiquidityTestResult(bool)" true --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 9: Configure Minimum Seed Deposit Thresholds
Define the minimum liquidity deposit required to complete vault initialization.
```bash
cast send $SENTINEL_ADDRESS "setMinimumSeedDeposit(uint256)" $MIN_SENTINEL_SEED --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "setMinimumSeedDeposit(uint256)" $MIN_CATALYST_SEED --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 10: Seed Vaults with Non-Redeemable Liquidity
Approve asset transfers and seed both vaults. Set lock expiry to `0` for permanent non-redeemable lock.
```bash
# Approve underlying asset spending
cast send $ASSET_ADDRESS "approve(address,uint256)" $SENTINEL_ADDRESS $SENTINEL_SEED_AMOUNT --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $ASSET_ADDRESS "approve(address,uint256)" $CATALYST_ADDRESS $CATALYST_SEED_AMOUNT --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

# Execute seed deposits (0 lockExpiry = permanent lock)
cast send $SENTINEL_ADDRESS "seedVault(uint256,uint256)" $SENTINEL_SEED_AMOUNT 0 --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "seedVault(uint256,uint256)" $CATALYST_SEED_AMOUNT 0 --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 11: Assign Emergency Role (Optional but Recommended)
Designate a dedicated multisig or security hot wallet for emergency pause actions.
```bash
cast send $SENTINEL_ADDRESS "assignEmergencyRole(address)" $EMERGENCY_ROLE_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
cast send $CATALYST_ADDRESS "assignEmergencyRole(address)" $EMERGENCY_ROLE_ADDRESS --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

#### Step 12: Enable Catalyst Recapitalization Mechanics (Optional)
Configure automated recapitalization triggering thresholds on the Catalyst vault (e.g., 1500 bps = 15% NAV drop).
```bash
cast send $CATALYST_ADDRESS "enableRecapitalization(uint256)" 1500 --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

---

## 4. Post-Deployment Verification Checklist

Execute the following verification read calls (`cast call`) to confirm system integrity before opening vaults to user activity:

| Check Description | Target Function / Assertion | Expected Value | Status |
|---|---|---|---|
| Sentinel Vault Class | `sentinel.vaultClass()` | `1` (Class A / Sentinel) | `[ ] PASS` |
| Catalyst Vault Class | `catalyst.vaultClass()` | `2` (Class B / Catalyst) | `[ ] PASS` |
| Sentinel Paired Vault | `sentinel.pairedVault()` | Address of Catalyst Vault | `[ ] PASS` |
| Catalyst Paired Vault | `catalyst.pairedVault()` | Address of Sentinel Vault | `[ ] PASS` |
| Sentinel Manager | `sentinel.preservationManager()` | Address of Manager Contract | `[ ] PASS` |
| Catalyst Manager | `catalyst.preservationManager()` | Address of Manager Contract | `[ ] PASS` |
| Sentinel Seed Status | `sentinel.isSeeded()` | `true` | `[ ] PASS` |
| Catalyst Seed Status | `catalyst.isSeeded()` | `true` | `[ ] PASS` |
| CPM Active State | `sentinel.preservationModeActive()` | `false` | `[ ] PASS` |
| Catalyst Distributions | `catalyst.distributionsSuspended()` | `false` | `[ ] PASS` |
| Timelock Delay | `sentinel.timelockDelay()` | `172800` (48 hours) | `[ ] PASS` |
| Virtual Assets Offset | `sentinel.decimalsOffset()` | `6` | `[ ] PASS` |

Automated Verification Script Command:
```bash
cast call $SENTINEL_ADDRESS "isSeeded()(bool)" --rpc-url $RPC_URL
cast call $SENTINEL_ADDRESS "preservationModeActive()(bool)" --rpc-url $RPC_URL
cast call $CATALYST_ADDRESS "distributionsSuspended()(bool)" --rpc-url $RPC_URL
```

---

## 5. Backend Server Build & Deployment

### 5.1 Build Preparation
1. Install backend dependencies:
   ```bash
   npm ci
   ```
2. Run TypeScript compilation check:
   ```bash
   npx tsc --noEmit
   ```
3. Execute backend Jest test suite:
   ```bash
   npx jest --config jest.config.js
   ```

### 5.2 Production Startup
Start the backend Express API Gateway service using `ts-node` or compiled JS distribution:
```bash
NODE_ENV=production PORT=3000 npm run dev
```

### 5.3 Process Management (PM2 / Docker)
For production deployments, execute via PM2 or containerized image:
```bash
# PM2 process configuration
pm2 start backend/api/index.ts --name "dibs-backend" --instances max --exec-mode cluster
```

### 5.4 Database Initialization
Ensure PostgreSQL tables and schema migrations are applied prior to launch. Verify database connection:
```bash
curl -X GET http://localhost:3000/api/health
```

---

## 6. Frontend Build & Deployment Instructions

### 6.1 Installation & Configuration
1. Navigate to the frontend workspace directory:
   ```bash
   cd frontend
   ```
2. Install frontend dependencies:
   ```bash
   npm ci
   ```
3. Configure environment file `.env.production`:
   ```env
   VITE_API_BASE_URL=https://api.dibs.network/api
   VITE_CHAIN_ID=11155111
   VITE_APP_TITLE=DIBS Trust Capital Console
   ```

### 6.2 Application Compilation
Execute Vite production build script:
```bash
npm run build
```
The build process compiles React TypeScript assets into optimized static bundles located in `frontend/dist/`.

### 6.3 Static Hosting Deployment Options

#### Option A: AWS S3 + CloudFront CDN
```bash
aws s3 sync frontend/dist/ s3://dibs-frontend-production --delete
aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
```

#### Option B: Nginx Reverse Proxy & Static Web Server
Configure Nginx server block to serve `frontend/dist/` with single-page application fallback:
```nginx
server {
    listen 443 ssl http2;
    server_name console.dibs.network;

    root /var/www/dibs-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 7. CI/CD Activation Steps

The repository includes GitHub Actions automated workflows in `.github/workflows/`.

### 7.1 Workflow Architecture
- **`.github/workflows/ci.yml`**: Triggers automatically on `push` and `pull_request` to `main`.
  - Job 1: `foundry-tests` — Compiles Solidity smart contracts and executes 64 Forge unit/simulation tests.
  - Job 2: `backend-tests` — Runs TypeScript type-check (`tsc --noEmit`) and 95 Jest tests across 10 suites.
  - Job 3: `frontend-build` — Installs dependencies and builds the React static bundle via Vite.
- **`.github/workflows/deploy.yml`**: Production deployment workflow triggered via `workflow_dispatch`.

### 7.2 GitHub Secrets Configuration
To activate automated deployment via `deploy.yml`, configure the following secrets in GitHub Repository Settings (`Settings > Secrets and variables > Actions`):

#### Smart Contract Secrets
- `MAINNET_RPC_URL`: Mainnet/L2 RPC connection string.
- `SEPOLIA_RPC_URL`: Sepolia testnet RPC URL.
- `DEPLOYER_PRIVATE_KEY`: Deployment wallet private key.
- `ETHERSCAN_API_KEY`: Etherscan verification API key.

#### Backend Secrets
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis endpoint.
- `JWT_SECRET`: Web token signature key.
- `API_SECRET_KEY`: Inter-service secret.
- `VRDCT_API_KEY`: VRDCT analytics API key.
- `SETTLEMENT_BANK_API_KEY`: Banking partner credentials.

#### Frontend Secrets
- `VITE_API_BASE_URL`: Production backend URL (`https://api.dibs.network/api`).
- `VITE_CHAIN_ID`: EVM chain identifier.

### 7.3 Triggering Manual Deployment
1. Navigate to GitHub Actions tab.
2. Select **Production Deployment**.
3. Click **Run workflow**, choose target branch (`main`) and environment (`production` or `staging`).

---

## 8. Monitoring & Alerting Recommendations

To guarantee platform availability and risk enforcement, monitor the following metrics across on-chain contracts and infrastructure layers:

### 8.1 On-Chain Monitoring Metrics
- **Junior Ratio (`JuniorRatio`)**: Continuously poll `computeJuniorRatioBps()`.
  - *Alert Condition*: `JuniorRatio < 2500 bps` (Warning), `JuniorRatio < 2000 bps` (Critical — CPM Auto-Triggered).
- **Capital Preservation Mode Status**: Listen for `CapitalPreservationTriggered` and `CapitalPreservationLifted` events.
- **Sentinel Withdrawal Queue**: Monitor `queueLength()` and `pendingQueueCount()`.
- **Yield Routing Diversions**: Track `YieldRouted` events diverting cash flows to segregated reserves.
- **Timelock Proposals**: Monitor `ParameterChangeQueued` events to detect queued governance modifications.

### 8.2 Backend & Infrastructure Monitoring
- **Express Gateway Health Check**: Poll `GET /api/health` every 30 seconds.
- **PostgreSQL Connection Pool**: Monitor connection saturation and transaction latency.
- **Redis Memory & Pub/Sub**: Track eviction counts and socket connection health.

### 8.3 External Integrations Health
- **VRDCT API Status**: Monitor API request response time and error rate.
- **Settlement Exception Alerts**: Monitor `/api/settlement/exceptions` for unmatched banking transactions.

### 8.4 Severity Tiers & Escalate Matrix
- **P0 Critical (Immediate On-Call Page)**: CPM triggered, database unreachable, emergency pause activated.
- **P1 High (1-Hour SLA)**: Junior Ratio < 2500 bps, settlement reconciliation exception logged, VRDCT API degradation.
- **P2 Info (Daily Review)**: Parameter change queued in timelock, seed lock parameters updated.

---

## 9. Emergency Procedures

### 9.1 Emergency Protocol Pause
In the event of an active exploit or security threat, authorized accounts can immediately freeze vault deposits and withdrawals without timelock delays.

#### Pause Execution
Call `emergencyPause()` from the Admin or Emergency role address:
```bash
cast send $SENTINEL_ADDRESS "emergencyPause()" --rpc-url $RPC_URL --private-key $EMERGENCY_PRIVATE_KEY
cast send $CATALYST_ADDRESS "emergencyPause()" --rpc-url $RPC_URL --private-key $EMERGENCY_PRIVATE_KEY
```

#### Unpause Execution
Once the incident is mitigated, call `emergencyUnpause()`:
```bash
cast send $SENTINEL_ADDRESS "emergencyUnpause()" --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
cast send $CATALYST_ADDRESS "emergencyUnpause()" --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
```

### 9.2 Manual Preservation Mode Trigger
If off-chain risk models detect imminent impairment, preservation mode can be manually triggered:
```bash
cast send $MANAGER_ADDRESS "checkAndTrigger()" --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
```
Or directly on the vault:
```bash
cast send $SENTINEL_ADDRESS "triggerPreservationMode()" --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
```

### 9.3 Emergency Role Management
Assign or revoke emergency responder addresses using `assignEmergencyRole`:
```bash
cast send $SENTINEL_ADDRESS "assignEmergencyRole(address)" $NEW_EMERGENCY_ADDRESS --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
```

### 9.4 Draining Sentinel Queues & Orderly Liquidation
When lifting Capital Preservation Mode after recapitalization and liquidity restoration:
1. Verify Junior Ratio meets or exceeds minimum (`≥ 2000 bps`).
2. Verify liquidity test passes (`setLiquidityTestResult(true)`).
3. Call `liftPreservation()` on `CapitalPreservationManager`.
4. Process queued Sentinel redemptions sequentially:
   ```bash
   cast send $SENTINEL_ADDRESS "processQueue(uint256)" $BATCH_SIZE --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY
   ```

---

## 10. Known Limitations & Operating Constraints

1. **Virtual Assets/Shares Offset (`_DECIMALS_OFFSET = 6`)**:
   - Designed to mitigate ERC-4626 inflation and donation attacks.
   - Initial deposit or seed liquidity is required before public deposits to establish non-zero share supply.

2. **Non-Redeemable Seed Liquidity**:
   - Seed liquidity deposited with `lockExpiry = 0` is permanently locked and non-redeemable.
   - Seed shares cannot be transferred or burned under any circumstances.

3. **Timelocked Parameter Governance**:
   - Parameter modifications (`setMinJuniorRatio`, `setPairedVault`, `setPreservationManager`, `assignEmergencyRole`, `setDepositCap`, `setTimelockDelay`) require a mandatory 48-hour delay (`DEFAULT_TIMELOCK_DELAY`).
   - Timelock delay cannot be configured below 1 hour (`MIN_TIMELOCK_DELAY`) or above 7 days (`MAX_TIMELOCK_DELAY`).

4. **Minimum Junior Ratio Constraint**:
   - Junior Ratio is constrained to basis points (`10000 bps = 100%`).
   - Standard baseline requirement is `2000 bps` (20.00%). Drops below this threshold automatically activate Capital Preservation Mode.

5. **Tokenization Sandbox Prerequisites**:
   - Restricted token deployments in `RestrictedTokenSandbox.sol` require 5 explicit compliance prerequisite approvals (Legal, Custody, Governance, Audit, Compliance) before tokens can be minted or activated.

6. **Single-Chain Deployment Scope**:
   - Smart contracts operate on a single EVM chain per deployment instance. Cross-chain state synchronization requires external messaging bridges.
