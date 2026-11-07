export const PROFILE_PIN_ITERATIONS = 180000;

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  return new Uint8Array(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

function validatePin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("Le code PIN doit contenir de 4 à 8 chiffres.");
}

async function derive(pin, salt, cryptoSource) {
  const material = await cryptoSource.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return cryptoSource.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PROFILE_PIN_ITERATIONS }, material, 256);
}

export async function hashProfilePin(pin, cryptoSource = globalThis.crypto) {
  validatePin(pin);
  if (!cryptoSource?.subtle || typeof cryptoSource.getRandomValues !== "function") throw new Error("Le navigateur ne permet pas de protéger le code PIN.");
  const salt = cryptoSource.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: toHex(await derive(pin, salt, cryptoSource)), iterations: PROFILE_PIN_ITERATIONS };
}

export async function verifyProfilePin(pin, record, cryptoSource = globalThis.crypto) {
  if (!/^\d{4,8}$/.test(pin) || !record?.salt || !record?.hash || record.iterations !== PROFILE_PIN_ITERATIONS || !cryptoSource?.subtle) return false;
  try {
    const candidate = new Uint8Array(await derive(pin, fromHex(record.salt), cryptoSource));
    const expected = fromHex(record.hash);
    let difference = candidate.length ^ expected.length;
    for (let index = 0; index < candidate.length; index++) difference |= candidate[index] ^ expected[index];
    return difference === 0;
  } catch { return false; }
}
