import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Landmark, Building2, FileText, Upload,
  ShieldCheck, Home, BarChart3, Wallet, ScrollText, Settings,
} from 'lucide-react';

const navItems = [
  { to: '/', label: 'Operator Console', icon: LayoutDashboard },
  { to: '/lender', label: 'Lender Dashboard', icon: Landmark },
  { to: '/sponsor', label: 'Sponsor Dashboard', icon: Building2 },
  { to: '/borrower', label: 'Borrower Portal', icon: FileText },
  { to: '/evidence', label: 'Evidence Upload', icon: Upload },
  { to: '/covenants', label: 'Covenant Dashboard', icon: ShieldCheck },
  { to: '/collateral', label: 'Collateral Dashboard', icon: Home },
  { to: '/tranches', label: 'Tranche Analytics', icon: BarChart3 },
  { to: '/policy-loan', label: 'Policy-Loan Arbitrage', icon: Wallet },
  { to: '/audit', label: 'Audit Viewer', icon: ScrollText },
  { to: '/admin', label: 'Admin & Compliance', icon: Settings },
];

export default function Layout({ children }: { children?: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-dibs-800 bg-dibs-950">
        <div className="flex h-16 items-center gap-2 border-b border-dibs-800 px-4">
          <div className="h-8 w-8 rounded-md bg-dibs-600" />
          <div>
            <div className="text-sm font-bold text-dibs-100">DIBS</div>
            <div className="text-xs text-dibs-400">Trust Capital Network</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-link ${isActive || (to === '/' && location.pathname === '/') ? 'nav-link-active' : ''}`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-dibs-800 p-3">
          <div className="text-xs text-dibs-400">Cornerstone Creative Capital</div>
          <div className="text-xs text-dibs-500">v0.1.0</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-dibs-950">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
