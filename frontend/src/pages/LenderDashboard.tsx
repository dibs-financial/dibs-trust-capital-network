import { useQuery } from '@tanstack/react-query';
import { capitalApi } from '../api/client';

export default function LenderDashboard() {
  const { data } = useQuery({ queryKey: ['capital-requests'], queryFn: () => capitalApi.listRequests() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Lender Dashboard</h1>
        <p className="text-sm text-dibs-400">Draw approval, evidence verification, and release management</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Capital Requests</span>
          <button className="btn-primary">New Draw Request</button>
        </div>
        <table className="table">
          <thead>
            <tr><th>Request ID</th><th>Borrower</th><th>Project</th><th>Amount</th><th>State</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {(data?.data || []).map((r: any) => (
              <tr key={r.requestId}>
                <td className="font-mono text-xs">{r.requestId}</td>
                <td>{r.borrowerOrSponsorId}</td>
                <td>{r.projectId}</td>
                <td>${r.requestedAmount?.toLocaleString()}</td>
                <td><span className="badge badge-blue">{r.currentState}</span></td>
                <td>
                  <button className="text-xs text-dibs-400 hover:text-dibs-200">Review</button>
                </td>
              </tr>
            ))}
            {(!data?.data || data.data.length === 0) && (
              <tr><td colSpan={6} className="text-dibs-400 text-center py-8">No capital requests yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
