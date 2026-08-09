# DIBS Tests

## Test Categories

### `unit/`
- Contract unit tests (Foundry)
- Backend service unit tests (Jest/Vitest)
- Frontend component tests (Vitest + Testing Library)
- Shared library validation tests

### `integration/`
- Cross-service integration tests
- API endpoint integration
- Contract-to-backend integration
- Evidence-gating workflow end-to-end

### `fork/`
- Mainnet fork tests for Morpho Blue adapter
- Mainnet fork tests for Pendle adapter
- Oracle integration fork tests
- Settlement adapter fork tests

### `fuzz/`
- Donation attack fuzzing (ERC-4626 vault)
- Rounding attack fuzzing
- Covenant boundary fuzzing
- Authorization bypass fuzzing
- State transition fuzzing

### `simulation/`
- Liquidity stress simulation
- Default and recovery simulation
- Oracle manipulation simulation
- Stale data simulation
- External adapter failure simulation
- Withdrawal surge simulation
- Recapitalization simulation
- Reserve-rebuild simulation
- Capital Preservation Mode trigger/lift simulation
