import parsePhoneNumber, { CountryCode } from 'libphonenumber-js';

export function normalizePhone(rawPhone: string, defaultCountry: CountryCode = 'IN'): string {
  const cleaned = rawPhone.trim();
  const parsed = parsePhoneNumber(cleaned, defaultCountry);

  if (!parsed || !parsed.isValid()) {
    throw new Error(`Invalid phone number: ${rawPhone}. Please provide a valid phone number.`);
  }

  return parsed.format('E.164');
}

export function maskPhone(phoneE164: string, role: string): string {
  // ADMIN and CSP_MEMBER can see full numbers; AGRI_PANCHAYAT and others see masked
  if (role === 'ADMIN' || role === 'CSP_MEMBER') {
    return phoneE164;
  }

  if (!phoneE164 || phoneE164.length < 6) {
    return '******';
  }

  const prefix = phoneE164.slice(0, 3);
  const suffix = phoneE164.slice(-4);
  return `${prefix} ****** ${suffix}`;
}
