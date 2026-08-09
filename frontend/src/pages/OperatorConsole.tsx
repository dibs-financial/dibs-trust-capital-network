import { useQuery } from '@tanstack/react-query';
import { analyticsApi, healthApi } from '../api/client';
import { Activity, DollarSign, AlertTriangle, Shield } from 'lucide-react';

export default function OperatorConsole() {
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => healthApi.check() });
  const { data: summary } = useQuery({ queryKey: ['analytics-summary'], queryFn: () => analyticsApi.summary() });

  const services = (health?.data?.services || {}) as Record<string, string>;
  const svcCount = Object.keys(services).length;
  const operational = Object.values(services).filter((s) => s === 'operational').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Operator Console</h1>
        <p className="text-sm text-dibs-400">System-wide overview of controlled-capital infrastructure</p>
      </div>

      {/* System health strip */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">System Health</span>
          <span className="badge badge-green">{operational}/{svcCount} operational</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(services).map(([svc, status]) => (
            <div key={svc} className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${status === 'operational' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-dibs-300">{svc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Capital Requests</span>
            <DollarSign className="h-4 w-4 text-dibs-400" />
          </div>
          <div className="stat-value mt-2">{summary?.data?.capitalRequests?.total || 0}</div>
          <div className="text-xs text-dibs-400">{summary?.data?.capitalRequests?.pending || 0} pending</div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Active Exceptions</span>
            <AlertTriangle className="h-4 w-4 text-dibs-400" />
          </div>
          <div className="stat-value mt-2">{summary?.data?.exceptions?.open || 0}</div>
          <div className="text-xs text-dibs-400">{summary?.data?.exceptions?.escalated || 0} escalated</div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Covenant Status</span>
            <Shield className="h-4 w-4 text-dibs-400" />
          </div>
          <div className="stat-value mt-2">{summary?.data?.covenants?.compliant || 0}</div>
          <div className="text-xs text-dibs-400">{summary?.data?.covenants?.breached || 0} breached</div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Event Throughput</span>
            <Activity className="h-4 w-4 text-dibs-400" />
          </div>
          <div className="stat-value mt-2">{summary?.data?.events?.total || 0}</div>
          <div className="text-xs text-dibs-400">immutable audit events</div>
        </div>
      </div>

      {/* Recent activity placeholder */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Capital Requests</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Project</th>
              <th>Amount</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} className="text-dibs-400 text-center py-8">Loading capital requests...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
