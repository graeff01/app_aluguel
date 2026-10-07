/** Variáveis de ambiente lidas sob demanda (o build não exige segredos). */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get tokenKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID ?? "";
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET ?? "";
  },
  get googleRedirectUri() {
    return process.env.GOOGLE_REDIRECT_URI ?? `${this.appUrl}/api/google/callback`;
  },
  get setupToken() {
    return process.env.SETUP_TOKEN ?? "";
  },
  get secureCookies() {
    return this.appUrl.startsWith("https://");
  },
};
