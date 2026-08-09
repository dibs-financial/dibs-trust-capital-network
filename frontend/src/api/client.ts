import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const tenantId = localStorage.getItem('dibs_tenant') || 'default';
  const role = localStorage.getItem('dibs_role') || 'viewer';
  config.headers['x-dibs-tenant'] = tenantId;
  config.headers['x-dibs-role'] = role;
  return config;
});

// ─── API Client Functions ──────────────────────────────────

// Capital Requests
export const capitalApi = {
  createRequest: (data: any) => api.post('/capital/request', data),
  getRequest: (id: string) => api.get(`/capital/request/${id}`),
  listRequests: (state?: string) => api.get('/capital/requests', { params: { state } }),
  transition: (id: string, data: any) => api.post(`/capital/request/${id}/transition`, data),
  validate: (id: string, data: any) => api.post(`/capital/request/${id}/validate`, data),
  createPolicy: (data: any) => api.post('/capital/policy', data),
  getPolicy: (id: string) => api.get(`/capital/policy/${id}`),
};

// Evidence
export const evidenceApi = {
  submit: (data: any) => api.post('/evidence', data),
  list: (params?: any) => api.get('/evidence', { params }),
  validate: (id: string) => api.post(`/evidence/${id}/validate`),
  flags: (projectId: string) => api.get(`/evidence/flags/${projectId}`),
};

// Settlement
export const settlementApi = {
  createInstruction: (data: any) => api.post('/settlement/instruction', data),
  confirm: (id: string, data: any) => api.post(`/settlement/${id}/confirm`, data),
  reconcile: (id: string, data: any) => api.post(`/settlement/${id}/reconcile`, data),
  list: (params?: any) => api.get('/settlement', { params }),
};

// Covenant
export const covenantApi = {
  evaluate: (data: any) => api.post('/covenant/evaluate', data),
  evaluations: () => api.get('/covenant/evaluations'),
};

// Collateral
export const collateralApi = {
  createHold: (data: any) => api.post('/collateral/hold', data),
  getHold: (id: string) => api.get(`/collateral/hold/${id}`),
  releaseHold: (id: string) => api.post(`/collateral/hold/${id}/release`),
  listHolds: (projectId: string) => api.get(`/collateral/holds/${projectId}`),
  flags: (projectId: string) => api.get(`/collateral/flags/${projectId}`),
};

// Exceptions & Waivers
export const exceptionApi = {
  create: (data: any) => api.post('/exceptions', data),
  get: (id: string) => api.get(`/exceptions/${id}`),
  escalate: (id: string, data: any) => api.post(`/exceptions/${id}/escalate`, data),
  requestWaiver: (exceptionId: string, data: any) => api.post(`/exceptions/${exceptionId}/waiver`, data),
  approveWaiver: (waiverId: string, data: any) => api.post(`/exceptions/${waiverId}/approve`, data),
  denyWaiver: (waiverId: string, data: any) => api.post(`/exceptions/${waiverId}/deny`, data),
};

// VRDCT
export const vrdctApi = {
  signals: (entityId: string) => api.get(`/vrdct/signals/${entityId}`),
  recordSignal: (data: any) => api.post('/vrdct/signals', data),
  adverseNotices: (entityId: string) => api.get(`/vrdct/adverse-notices/${entityId}`),
};

// Reporting
export const reportingApi = {
  generate: (type: string, params: any) => api.get(`/reporting/report/${type}`, { params }),
};

// Analytics
export const analyticsApi = {
  summary: (params?: any) => api.get('/analytics/summary', { params }),
  capitalRequests: (params?: any) => api.get('/analytics/capital-requests', { params }),
  covenants: (params?: any) => api.get('/analytics/covenants', { params }),
  tranche: (params?: any) => api.get('/analytics/tranche', { params }),
  events: (params?: any) => api.get('/analytics/events', { params }),
};

// Policy-Loan
export const policyLoanApi = {
  createPolicy: (data: any) => api.post('/policy-loan/policy', data),
  getPolicy: (id: string) => api.get(`/policy-loan/policy/${id}`),
  listPolicies: () => api.get('/policy-loan/policies'),
  draw: (data: any) => api.post('/policy-loan/draw', data),
  repay: (data: any) => api.post('/policy-loan/repayment', data),
  payPremium: (data: any) => api.post('/policy-loan/premium', data),
  collateral: (id: string) => api.get(`/policy-loan/policy/${id}/collateral`),
  accrue: (id: string, asOfDate?: string) => api.post(`/policy-loan/policy/${id}/accrue`, { asOfDate }),
  redirectCash: (id: string, amount: number) => api.post(`/policy-loan/policy/${id}/redirect-cashflow`, { amount }),
};

// Audit
export const auditApi = {
  events: (skip?: number, limit?: number) => api.get('/audit/events', { params: { skip, limit } }),
};

// Health
export const healthApi = {
  check: () => axios.get('/health'),
};
