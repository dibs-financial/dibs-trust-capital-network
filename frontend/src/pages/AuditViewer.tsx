import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../api/client';

const eventTypeColors: Record<string, string> = {
  CAPITAL_REQUEST_CREATED: 'badge-blue',
  CAPITAL_REQUEST_APPROVED: 'badge-green',
  CAPITAL_REQUEST_HELD: 'badge-yellow',
  CAPITAL_REQUEST_REJECTED: 'badge-red',
  CAPITAL_REQUEST_ESCALATED: 'badge-yellow',
  EVIDENCE_SUBMITTED: 'badge-blue',
  EVIDENCE_VALIDATED: 'badge-green',
  EVIDENCE_FLAGGED: 'badge-yellow',
  EVIDENCE_EXPIRED: 'badge-red',
  RELEASE_AUTHORIZED: 'badge-green',
  SETTLEMENT_CONFIRMED: 'badge-green',
  SETTLEMENT_EXCEPTION: 'badge-red',
  COVENANT_BREACHED: 'badge-red',
  COVENANT_WAIVED: 'badge-blue',
  CAPITAL_PRESERVATION_TRIGGERED: 'badge-red',
  EMERGENCY_PAUSE: 'badge-red',
};

export default function AuditViewer() {
  const { data } = useQuery({ queryKey: ['audit-events'], queryFn: () => auditApi.events(0, 100) });
  const events = data?.data?.events || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Audit Event Viewer</h1>
        <p className="text-sm text-dibs-400">Immutable, hash-linked event chain for all state transitions</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Event Chain</span>
          <span className="badge badge-green">{events.length} events</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Event ID</th><th>Type</th><th>Actor</th><th>Role</th><th>Timestamp</th><th>Hash</th></tr>
          </thead>
          <tbody>
            {events.map((e: any) => (
              <tr key={e.eventId}>
                <td className="font-mono text-xs text-dibs-300">{e.eventId}</td>
                <td><span className={`badge ${eventTypeColors[e.eventType] || 'badge-blue'}`}>{e.eventType}</span></td>
                <td className="text-dibs-300">{e.actorId}</td>
                <td className="text-dibs-400">{e.actorRole}</td>
                <td className="text-dibs-400 text-xs">{new Date(e.timestamp).toLocaleString()}</td>
                <td className="font-mono text-xs text-dibs-500">{e.previousEventHash?.slice(0, 16)}...</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={6} className="text-dibs-400 text-center py-8">No audit events recorded</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
