import { useQuery } from '@tanstack/react-query';
import { policyLoanApi } from '../api/client';

export default function PolicyLoanDashboard() {
  const { data } = useQuery({ queryKey: ['policy-loans'], queryFn: () => policyLoanApi.listPolicies() });
  const policies = data?.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Policy-Loan Arbitrage Dashboard</h1>
        <p className="text-sm text-dibs-400">Personal infinite banking, policy-loan tracking, and spread economics</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card">
          <span className="stat-label">Total Cash Value</span>
          <div className="stat-value mt-2">${policies.reduce((s: number, p: any) => s + (p.cashValue || 0), 0).toLocaleString()}</div>
        </div>
        <div className="card">
          <span className="stat-label">Total Loan Balance</span>
          <div className="stat-value mt-2">${policies.reduce((s: number, p: any) => s + (p.loanBalance || 0), 0).toLocaleString()}</div>
        </div>
        <div className="card">
          <span className="stat-label">Avg Loan Rate</span>
          <div className="stat-value mt-2">{policies.length ? (policies.reduce((s: number, p: any) => s + (p.loanInterestRate || 0), 0) / policies.length * 100).toFixed(2) + '%' : '—'}</div>
        </div>
        <div className="card">
          <span className="stat-label">Active Policies</span>
          <div className="stat-value mt-2">{policies.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Policy Records</span>
          <button className="btn-primary">New Policy</button>
        </div>
        <table className="table">
          <thead>
            <tr><th>Policy ID</th><th>Carrier</th><th>Cash Value</th><th>Loan Balance</th><th>LTV</th><th>Phase</th><th>Draws Frozen</th></tr>
          </thead>
          <tbody>
            {policies.map((p: any) => (
              <tr key={p.policyId}>
                <td className="font-mono text-xs">{p.policyId}</td>
                <td>{p.carrierId}</td>
                <td>${p.cashValue?.toLocaleString()}</td>
                <td>${p.loanBalance?.toLocaleString()}</td>
                <td>{(p.policyLoanLTV * 100).toFixed(1)}%</td>
                <td><span className="badge badge-blue">{p.phase}</span></td>
                <td>{p.isDrawsFrozen ? <span className="badge badge-red">FROZEN</span> : <span className="badge badge-green">OPEN</span>}</td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr><td colSpan={7} className="text-dibs-400 text-center py-8">No policy records created</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Arbitrage Risk Controls</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            'Liquidity reserve', 'Hard LTV ceiling', 'Soft LTV warning',
            'DSCR < 1.1x redirect', 'Multi-year yield lag', 'Dividend smoothing',
            'Direct vs non-direct recognition', 'Phase-dependent LTV limits',
          ].map((ctrl) => (
            <div key={ctrl} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-dibs-500" />
              <span className="text-dibs-300">{ctrl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
