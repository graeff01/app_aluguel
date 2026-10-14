/** CPF: só dígitos e conferência dos dígitos verificadores (usado no servidor e no navegador). */
export function cpfDigits(raw: string) {
  return raw.replace(/\D/g, "");
}

/** Dígitos verificadores do CPF (recusa sequências repetidas). */
export function isValidCpf(raw: string) {
  const d = cpfDigits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

