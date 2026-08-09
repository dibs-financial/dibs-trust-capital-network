import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import OperatorConsole from './pages/OperatorConsole';
import LenderDashboard from './pages/LenderDashboard';
import SponsorDashboard from './pages/SponsorDashboard';
import BorrowerPortal from './pages/BorrowerPortal';
import EvidenceUpload from './pages/EvidenceUpload';
import CovenantDashboard from './pages/CovenantDashboard';
import CollateralDashboard from './pages/CollateralDashboard';
import TrancheAnalytics from './pages/TrancheAnalytics';
import PolicyLoanDashboard from './pages/PolicyLoanDashboard';
import AuditViewer from './pages/AuditViewer';
import AdminPortal from './pages/AdminPortal';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<OperatorConsole />} />
        <Route path="/lender" element={<LenderDashboard />} />
        <Route path="/sponsor" element={<SponsorDashboard />} />
        <Route path="/borrower" element={<BorrowerPortal />} />
        <Route path="/evidence" element={<EvidenceUpload />} />
        <Route path="/covenants" element={<CovenantDashboard />} />
        <Route path="/collateral" element={<CollateralDashboard />} />
        <Route path="/tranches" element={<TrancheAnalytics />} />
        <Route path="/policy-loan" element={<PolicyLoanDashboard />} />
        <Route path="/audit" element={<AuditViewer />} />
        <Route path="/admin" element={<AdminPortal />} />
      </Route>
    </Routes>
  );
}
