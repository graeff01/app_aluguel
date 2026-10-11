import { hash, verify } from "@node-rs/argon2";

// Argon2id (padrão do @node-rs/argon2) — parâmetros OWASP.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
let dummyHash: Promise<string> | null = null;

export const PASSWORD_MIN = 10;

export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `A senha deve ter ao menos ${PASSWORD_MIN} caracteres.`;
  if (pw.length > 200) return "Senha muito longa.";
  if (/^(.)\1+$/.test(pw)) return "Escolha uma senha menos previsível.";
  return null;
}

export function hashPassword(pw: string) {
  return hash(pw, OPTS);
}

/** Verifica com custo constante mesmo sem usuário (evita enumeração por tempo). */
export async function verifyPassword(storedHash: string | null | undefined, pw: string): Promise<boolean> {
  try {
    if (!storedHash) {
      // sem senha guardada (usuário inexistente, convite pendente ou só Google): gasta o mesmo tempo e SEMPRE recusa
      await verify(await (dummyHash ??= hash("senha-ficticia-para-tempo-constante", OPTS)), pw);
      return false;
    }
    return await verify(storedHash, pw);
  } catch {
    return false;
  }
}
