/**
 * DIBS Track A — policy packs, keyed by immutable version.
 *
 * A deal pins effective_policy_version; a draw locks it at SUBMITTED. In-flight
 * draws keep their locked pack even after a deal moves to a new version.
 * Until a policy_version table exists, packs live here and are append-only:
 * never edit a published version, add a new one.
 */

import { DomainError } from '../api/db';

export interface PolicyPack {
  version: string;
  /** Evidence types that must be in the frozen manifest and verified. */
  requiredEvidence: string[];
  /** Distinct approvers needed to enter APPROVED. */
  requiredApprovals: number;
  /** Roles that may record an approval decision. */
  approverRoles: string[];
  /** Sanctions screening must be newer than this on the payee counterparty. */
  sanctionsMaxAgeDays: number;
}

const PACKS: Record<string, PolicyPack> = {
  'policy-2026.09.19': {
    version: 'policy-2026.09.19',
    requiredEvidence: ['INVOICE', 'INSPECTION_REPORT'],
    requiredApprovals: 1,
    approverRoles: ['RiskOwner', 'Underwriter', 'LenderAdmin', 'PortfolioManager'],
    sanctionsMaxAgeDays: 30,
  },
};

export function getPolicyPack(version: string | null): PolicyPack {
  const pack = version ? PACKS[version] : undefined;
  if (!pack) throw new DomainError('POLICY_VERSION_UNKNOWN', String(version));
  return pack;
}
