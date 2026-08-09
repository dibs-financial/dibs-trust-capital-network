import { useState } from 'react';

export default function EvidenceUpload() {
  const [files, setFiles] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dibs-100">Evidence Upload</h1>
        <p className="text-sm text-dibs-400">Submit milestone documentation for evidence-gated release</p>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Submit Evidence</span></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="stat-label">Request ID</label>
            <input className="input mt-1 w-full" placeholder="cr_..." />
          </div>
          <div>
            <label className="stat-label">Evidence Class</label>
            <select className="input mt-1 w-full">
              <option value="">Select class...</option>
              <option value="construction_photos">Construction Photographs</option>
              <option value="inspection_report">Inspection Report</option>
              <option value="invoice">Invoice Documentation</option>
              <option value="change_order">Change Order</option>
              <option value="lien_waiver">Lien Waiver</option>
              <option value="title_update">Title Update</option>
              <option value="insurance_verification">Insurance Verification</option>
              <option value="appraisal">Appraisal Record</option>
              <option value="bank_validation">Bank Account Validation</option>
              <option value="collateral_value">Collateral Value Documentation</option>
              <option value="covenant_attestation">Covenant Compliance Attestation</option>
              <option value="third_party_inspection">Third-Party Inspection</option>
              <option value="signatory_verification">Authorized Signatory Verification</option>
              <option value="kyc_documentation">KYC Documentation</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="stat-label">Document Upload</label>
          <div className="mt-1 rounded-lg border-2 border-dashed border-dibs-700 p-8 text-center">
            <p className="text-sm text-dibs-400">Drag and drop files here, or click to browse</p>
            <p className="text-xs text-dibs-500 mt-1">Documents are SHA-256 hashed on submission</p>
          </div>
        </div>
        <button className="btn-primary mt-4">Submit Evidence</button>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Evidence Classes Required</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {['Construction Photos', 'Inspection Report', 'Invoice', 'Lien Waiver', 'Title Update', 'Insurance Verification', 'Appraisal', 'Bank Validation', 'Collateral Value'].map((cls) => (
            <div key={cls} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-dibs-300">{cls}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
