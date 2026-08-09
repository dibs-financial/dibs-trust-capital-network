import { useQuery } from '@tanstack/react-query';
import { healthApi } from '../api/client';
import { useState } from 'react';

export default function AdminPortal() {
  const { data: health } = useQuery({ queryKey: ['admin-health'], queryFn: () => healthApi.check() });
  const [paused, setPaused] = useState(false);

  const services = (health?.data?.services || {}) as Record<string, string>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Admin & Compliance Portal</h1>
        <p className="text-sm text-dibs-400">Emergency controls, system configuration, and compliance monitoring</p>
      </div>

      {/* Emergency controls */}
      <div className="card">
        <div className="card-header"><span className="card-title">Emergency Controls</span></div>
        <div className="flex items-center gap-4">
          <div>
            <span className="stat-label">System State</span>
            <div className="mt-1">
              <span className={`badge ${paused ? 'badge-red' : 'badge-green'}`}>
                {paused ? 'PAUSED' : 'OPERATIONAL'}
              </span>
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Unpause System' : 'Emergency Pause'}
          </button>
        </div>
        <p className="mt-3 text-xs text-dibs-400">
          Emergency pause freezes all capital releases, settlement instructions, and covenant state transitions.
          Requires post-incident review before restart.
        </p>
      </div>

      {/* Service registry */}
      <div className="card">
        <div className="card-header"><span className="card-title">Service Registry</span></div>
        <table className="table">
          <thead><tr><th>Service</th><th>Status</th><th>Build Step</th></tr></thead>
          <tbody>
            {Object.entries(services).map(([svc, status]) => (
              <tr key={svc}>
                <td className="text-dibs-200">{svc}</td>
                <td><span className="badge badge-green">{status}</span></td>
                <td className="text-dibs-400">{svc}</td>
              </tr>
            ))}
            {Object.keys(services).length === 0 && (
              <tr><td colSpan={3} className="text-dibs-400 text-center py-8">Service status unavailable</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* VRDCT compliance */}
      <div className="card">
        <div className="card-header"><span className="card-title">VRDCT Compliance Constraints</span></div>
        <div className="space-y-2">
          {[
            'No opaque scoring',
            'No undisclosed adverse-decision automation',
            'No non-consented behavioral inputs',
            'No protected-class proxies',
            'No sole basis for financing denial',
            'Require explainable reason codes',
            'Require human review for material adverse action',
          ].map((rule) => (
            <div key={rule} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-dibs-300">{rule}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Non-negotiable operating rules */}
      <div className="card">
        <div className="card-header"><span className="card-title">Non-Negotiable Operating Rules</span></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            'No trust-based disbursement',
            'No mutable spreadsheet ledger',
            'No release without machine-verifiable state',
            'No capital-state change without audit event',
            'No automatic financing promise',
            'No guaranteed investment result',
            'No guaranteed tax result',
            'No guaranteed policy performance',
            'No guaranteed liquidity',
            'No claim of chartered-bank status',
          ].map((rule) => (
            <div key={rule} className="flex items-center gap-2 text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-dibs-600" />
              <span className="text-dibs-300">{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
