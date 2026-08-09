import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/client';

export default function TrancheAnalytics() {
  const { data } = useQuery({ queryKey: ['tranche-analytics'], queryFn: () => analyticsApi.tranche() });
  const tranche = data?.data || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Tranche Analytics</h1>
        <p className="text-sm text-dibs-400">Sentinel (senior) and Catalyst (first-loss) vault performance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ color: '#6a91ba' }}>Sentinel Vault (Class A)</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between"><span className="stat-label">NAV</span><span className="text-dibs-100 font-mono">${(tranche.sentinelNAV || 0).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="stat-label">Target Yield</span><span className="text-dibs-100">—</span></div>
            <div className="flex justify-between"><span className="stat-label">Loss-Buffer Coverage</span><span className="text-dibs-100">{tranche.lossBufferCoverage || '—'}</span></div>
            <div className="flex justify-between"><span className="stat-label">Reserve Ratio</span><span className="text-dibs-100">{tranche.reserveRatio || '—'}</span></div>
            <div className="flex justify-between"><span className="stat-label">Withdrawal Queue</span><span className="text-dibs-100">{tranche.withdrawalQueueDuration || '—'}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ color: '#d97706' }}>Catalyst Vault (Class B)</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between"><span className="stat-label">NAV</span><span className="text-dibs-100 font-mono">${(tranche.catalystNAV || 0).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="stat-label">Residual Yield</span><span className="text-dibs-100">—</span></div>
            <div className="flex justify-between"><span className="stat-label">Loss Severity</span><span className="text-dibs-100">{tranche.lossSeverity || '—'}</span></div>
            <div className="flex justify-between"><span className="stat-label">Junior Ratio</span><span className="text-dibs-100">{tranche.juniorRatio || '—'}</span></div>
            <div className="flex justify-between"><span className="stat-label">Min Junior Ratio</span><span className="text-dibs-100">{tranche.minJuniorRatio || '—'}</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Capital Preservation Mode</span></div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="stat-label">Preservation Mode Active</span>
            <div className="mt-1">
              <span className={`badge ${tranche.preservationMode ? 'badge-red' : 'badge-green'}`}>
                {tranche.preservationMode ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          </div>
          <div>
            <span className="stat-label">Preservation Duration (hours)</span>
            <div className="stat-value mt-1">{tranche.preservationModeDurationHours || 0}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Capital Waterfall</span></div>
        <ol className="list-decimal space-y-1 pl-4 text-sm text-dibs-300">
          <li>Receive portfolio cash flows, collateral proceeds, recoveries</li>
          <li>Recognize expenses</li>
          <li>Recognize servicing costs</li>
          <li>Recognize realized losses</li>
          <li>Fund required reserves</li>
          <li>Accrue protocol fees</li>
          <li>Distribute to Sentinel (senior priority)</li>
          <li>Distribute residual to Catalyst (if reserves permit)</li>
          <li>Apply losses to Catalyst NAV first</li>
          <li>Apply remaining losses to Sentinel (after Catalyst exhausted)</li>
        </ol>
      </div>
    </div>
  );
}
