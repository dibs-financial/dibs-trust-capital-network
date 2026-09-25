/**
 * Energy evaluation for a compiled artifact. Research helpers only: energy is
 * not money, and a low energy is not a validator verdict.
 */

import { QuboArtifact } from './types';

/** E(x) = Σ Q_ii x_i + Σ_{i<j} 2·Q_ij x_i x_j + E0 for x ∈ {0,1}^n. */
export function quboEnergy(artifact: QuboArtifact, x: ReadonlyArray<0 | 1>): number {
  if (x.length !== artifact.n) throw new Error(`Expected ${artifact.n} bits, got ${x.length}.`);
  let e = artifact.E0;
  artifact.Q_diag.forEach((q, i) => {
    if (x[i]) e += q;
  });
  for (const { i, j, q } of artifact.Q_offdiag) {
    if (x[i] && x[j]) e += 2 * q;
  }
  return e;
}

/** H(z) = Σ h_i z_i + Σ_{i<j} J_ij z_i z_j + energy_shift for z ∈ {−1,+1}^n. */
export function isingEnergy(artifact: QuboArtifact, z: ReadonlyArray<-1 | 1>): number {
  if (z.length !== artifact.n) throw new Error(`Expected ${artifact.n} spins, got ${z.length}.`);
  let e = artifact.energy_shift;
  artifact.h.forEach((h, i) => {
    e += h * z[i];
  });
  for (const { i, j, value } of artifact.J_sparse) e += value * z[i] * z[j];
  return e;
}

/** Frozen spin map: z = 1 − 2x, so x = 0 ↦ z = +1 and x = 1 ↦ z = −1. */
export function bitsToSpins(x: ReadonlyArray<0 | 1>): Array<-1 | 1> {
  return x.map((b) => (b ? -1 : 1));
}
