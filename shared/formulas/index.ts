/**
 * DIBS Shared — Risk Formulas
 *
 * Core financial and risk calculations used across the platform.
 * All formulas must be versioned with stored calculation inputs.
 */

// === Dynamic Capital Floor ===

/**
 * JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
 *
 * Capital Preservation Mode triggers when JuniorRatio < MinJuniorRatio.
 * Initial range: 20%–30% (not universally sufficient — calibrate by asset profile).
 */
export function calculateJuniorRatio(navCatalyst: number, navSentinel: number): number {
  const total = navCatalyst + navSentinel;
  if (total === 0) return 0;
  return navCatalyst / total;
}

export function isCapitalPreservationMode(
  juniorRatio: number,
  minJuniorRatio: number
): boolean {
  return juniorRatio < minJuniorRatio;
}

// === Reserve Release ===

/**
 * ReserveRelease = 0 when JuniorRatio < MinJuniorRatio
 * ReserveRelease = Eligible when JuniorRatio >= MinJuniorRatio AND liquidity tests pass
 */
export function canReleaseReserve(
  juniorRatio: number,
  minJuniorRatio: number,
  liquidityTestsPassed: boolean
): boolean {
  return juniorRatio >= minJuniorRatio && liquidityTestsPassed;
}

// === Loan-to-Value ===

export function calculateLTV(debtBalance: number, collateralValue: number): number {
  if (collateralValue === 0) return Infinity;
  return debtBalance / collateralValue;
}

// === Debt Service Coverage Ratio ===

export function calculateDSCR(netOperatingIncome: number, debtService: number): number {
  if (debtService === 0) return Infinity;
  return netOperatingIncome / debtService;
}

// === Debt Yield ===

export function calculateDebtYield(netOperatingIncome: number, loanAmount: number): number {
  if (loanAmount === 0) return 0;
  return netOperatingIncome / loanAmount;
}

// === Policy-Loan Arbitrage Spread ===

/**
 * Spread = Deployment Yield - Policy-Loan Effective Cost
 *
 * Do NOT assume gross yield equals realizable net return.
 * Do NOT assume policy dividends offset loan cost automatically.
 * Apply liquidity haircuts and tax assumptions only where legally validated.
 */
export function calculateArbitrageSpread(
  deploymentYield: number,
  loanEffectiveCost: number,
  liquidityHaircut: number = 0,
  taxRate: number = 0
): number {
  const netYield = deploymentYield * (1 - liquidityHaircut);
  const afterTaxYield = netYield * (1 - taxRate);
  return afterTaxYield - loanEffectiveCost;
}

// === Risk-Adjusted Yield Efficiency ===

/**
 * RAYE = Net Yield / Economic Capital at Risk
 *
 * Net Yield: Yield after losses, fees, reserve contributions, and operating costs.
 * Economic Capital at Risk: Primarily Catalyst capital plus modeled residual Sentinel exposure.
 * Protocol Objective: Improve risk-adjusted yield without undercapitalizing first-loss buffer.
 */
export function calculateRAYE(netYield: number, economicCapitalAtRisk: number): number {
  if (economicCapitalAtRisk === 0) return 0;
  return netYield / economicCapitalAtRisk;
}

// === LTV (Enterprise Software) ===

/**
 * LTV = ACV × GrossMargin / AnnualChurn
 *
 * Do NOT rely on unadjusted theoretical LTV.
 * Haircut for: implementation burden, contract length, sales-cycle delays,
 * integration scope, compliance cost, customer concentration, AUM volatility,
 * unproven renewal behavior.
 */
export function calculateEnterpriseLTV(acv: number, grossMargin: number, annualChurn: number): number {
  if (annualChurn === 0) return Infinity;
  return (acv * grossMargin) / annualChurn;
}

// === AUM Revenue ===

/**
 * Annual AUM Revenue = AUM × ManagementFeeRate
 */
export function calculateAUMRevenue(aum: number, managementFeeRate: number): number {
  return aum * managementFeeRate;
}

// === Equity Price Mechanics ===

export function calculatePostMoney(preMoney: number, newCapital: number): number {
  return preMoney + newCapital;
}

export function calculateInvestorOwnership(newCapital: number, postMoney: number): number {
  if (postMoney === 0) return 0;
  return newCapital / postMoney;
}

export function calculatePricePerShare(preMoney: number, fullyDilutedPreMoneyShares: number): number {
  if (fullyDilutedPreMoneyShares === 0) return 0;
  return preMoney / fullyDilutedPreMoneyShares;
}

// === DCF Valuation ===

/**
 * PV(Terminal Value) = Terminal Value / (1 + Discount Rate)^Years
 * Probability-Adjusted = PV × Survival Probability
 */
export function calculatePresentValue(terminalValue: number, discountRate: number, years: number): number {
  return terminalValue / Math.pow(1 + discountRate, years);
}

export function calculateProbabilityAdjusted(presentValue: number, survivalProbability: number): number {
  return presentValue * survivalProbability;
}
