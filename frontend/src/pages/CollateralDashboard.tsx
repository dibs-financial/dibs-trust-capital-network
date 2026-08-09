import { useQuery } from '@tanstack/react-query';
import { collateralApi } from '../api/client';

export default function CollateralDashboard() {
  const { data } = useQuery({
    queryKey: ['collateral-flags'],
    queryFn: () => collateralApi.flags('all'),
    enabled: false,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Collateral Dashboard</h1>
        <p className="text-sm text-dibs-400">LTV monitoring, lien tracking, and collateral risk flags</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card"><span className="stat-label">Total Collateral</span><div className="stat-value mt-2">$0</div></div>
        <div className="card"><span className="stat-label">Avg LTV</span><div className="stat-value mt-2">—</div></div>
        <div className="card"><span className="stat-label">Active Flags</span><div className="stat-value mt-2">0</div></div>
        <div className="card"><span className="stat-label">Active Holds</span><div className="stat-value mt-2">0</div></div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Collateral Risk Controls</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            'Stale appraisals', 'New liens', 'Title defects', 'Probate issues',
            'Ground-rent obligations', 'Demolition orders', 'Unpaid property taxes',
            'Insurance lapse', 'Subordination changes', 'Unapproved refinancing',
            'Collateral-transfer events', 'LTV policy breach',
          ].map((flag) => (
            <div key={flag} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-dibs-500" />
              <span className="text-dibs-300">{flag}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Collateral Holds</span></div>
        <table className="table">
          <thead><tr><th>Hold ID</th><th>Asset</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            <tr><td colSpan={5} className="text-dibs-400 text-center py-8">No collateral holds active</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
