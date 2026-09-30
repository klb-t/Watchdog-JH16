import type { Role } from './authorization';

export interface AdmissionRequest {
  principal_id: string; email: string; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; updated_at: string;
}
export interface AdmissionInvitation {
  id: string; email: string; message: string; actor_principal_id: string;
  created_at: string; expires_at: string; revoked_at: string | null;
  accepted_at: string | null; accepted_principal_id: string | null;
}
export interface InstallationGrant {
  email: string; roles: Role[]; active: boolean; actor_principal_id: string; updated_at: string;
}
export interface AdmissionStatus {
  verified: boolean; email: string | null; status: 'anonymous' | 'unrequested' | 'pending' | 'approved' | 'rejected' | 'revoked';
  request: AdmissionRequest | null;
}
