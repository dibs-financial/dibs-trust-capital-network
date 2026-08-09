import { useQuery } from '@tanstack/react-query';
import { capitalApi } from '../api/client';

export default function BorrowerPortal() {
  const { data } = useQuery({ queryKey: ['borrower-requests'], queryFn: () => capitalApi.listRequests() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Borrower Portal</h1>
        <p className="text-sm text-dibs-400">Submit draw requests and track approval status</p>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Submit New Draw Request</span></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="stat-label">Project ID</label><input className="input mt-1 w-full" placeholder="proj_001" /></div>
          <div><label className="stat-label">Requested Amount</label><input className="input mt-1 w-full" placeholder="$500,000" /></div>
          <div><label className="stat-label">Draw Category</label><input className="input mt-1 w-full" placeholder="construction" /></div>
          <div><label className="stat-label">Payment Destination</label><input className="input mt-1 w-full" placeholder="acct_001" /></div>
        </div>
        <button className="btn-primary mt-4">Submit Draw Request</button>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">My Requests</span></div>
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
              <tr><td colSpan={4} className="text-dibs-400 text-center py-8">No requests submitted</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
