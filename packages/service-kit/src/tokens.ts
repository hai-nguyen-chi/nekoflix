export const SERVICE_IDENTITY = Symbol('SERVICE_IDENTITY');

export interface ServiceIdentity {
  name: string;
  version: string;
}

export const SERVICE_KIT_OPTIONS = Symbol('SERVICE_KIT_OPTIONS');
