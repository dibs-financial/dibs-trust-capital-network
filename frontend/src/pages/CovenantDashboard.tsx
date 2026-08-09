import { useQuery } from '@tanstack/react-query';
import { covenantApi } from '../api/client';

const stateColor: Record<string, string> = {
  compliant: 'badge-green',
  warning: 'badge-yellow',
  breached: 'badge-red',
  cure_period: 'badge-yellow',
  waived: 'badge-blue',
  default: 'badge-red',
};

export default function CovenantDashboard() {
  const { data } = useQuery({ queryKey: ['covenant-evaluations'], queryFn: () => covenantApi.evaluations() });

  const evaluations = data?.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Covenant Dashboard</h1>
        <p className="text-sm text-dibs-400">24+ covenant categories with continuous monitoring</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card"><span className="stat-label">Compliant</span><div className="stat-value mt-2 text-emerald-400">{evaluations.filter((e: any) => e.state === 'compliant').length}</div></div>
        <div className="card"><span className="stat-label">Warning</span><div className="stat-value mt-2 text-amber-400">{evaluations.filter((e: any) => e.state === 'warning').length}</div></div>
        <div className="card"><span className="stat-label">Breached</span><div className="stat-value mt-2 text-red-400">{evaluations.filter((e: any) => e.state === 'breached').length}</div></div>
        <div className="card"><span className="stat-label">Waived</span><div className="stat-value mt-2 text-blue-400">{evaluations.filter((e: any) => e.state === 'waived').length}</div></div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Covenant Evaluations</span></div>
        <table className="table">
          <thead><tr><th>Evaluation ID</th><th>State</th><th>Alerts</th><th>Timestamp</th></tr></thead>
          <tbody>
            {evaluations.map((e: any) => (
              <tr key={e.evaluationId}>
                <td className="font-mono text-xs">{e.evaluationId}</td>
                <td><span className={`badge ${stateColor[e.state] || 'badge-blue'}`}>{e.state}</span></td>
                <td className="text-dibs-400 text-xs">{e.alerts?.join(', ') || '—'}</td>
                <td className="text-dibs-400">{new Date(e.timestamp).toLocaleString()}</td>
              </tr>
            ))}
            {evaluations.length === 0 && (
              <tr><td colSpan={4} className="text-dibs-400 text-center py-8">No covenant evaluations recorded</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
