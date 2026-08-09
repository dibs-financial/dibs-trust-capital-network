import { useQuery } from '@tanstack/react-query';
import { capitalApi } from '../api/client';

export default function SponsorDashboard() {
  const { data } = useQuery({ queryKey: ['sponsor-requests'], queryFn: () => capitalApi.listRequests() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Sponsor Dashboard</h1>
        <p className="text-sm text-dibs-400">Project draw management and covenant status</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card"><span className="stat-label">Total Drawn</span><div className="stat-value mt-2">$0</div></div>
        <div className="card"><span className="stat-label">Pending Draws</span><div className="stat-value mt-2">{data?.data?.length || 0}</div></div>
        <div className="card"><span className="stat-label">Covenant Breaches</span><div className="stat-value mt-2">0</div></div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Draw History</span></div>
        <table className="table">
          <thead><tr><th>Request ID</th><th>Amount</th><th>State</th><th>Date</th></tr></thead>
          <tbody>
            {(data?.data || []).map((r: any) => (
              <tr key={r.requestId}>
                <td className="font-mono text-xs">{r.requestId}</td>
                <td>${r.requestedAmount?.toLocaleString()}</td>
                <td><span className="badge badge-blue">{r.currentState}</span></td>
                <td className="text-dibs-400">{new Date(r.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {(!data?.data || data.data.length === 0) && (
              <tr><td colSpan={4} className="text-dibs-400 text-center py-8">No draws submitted</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
