export const PROFILE_PIN_ITERATIONS: 180000;
export function hashProfilePin(pin: string, cryptoSource?: Crypto): Promise<{ salt: string; hash: string; iterations: 180000 }>;
export function verifyProfilePin(pin: string, record: { salt: string; hash: string; iterations: number }, cryptoSource?: Crypto): Promise<boolean>;
