/**
 * Infraestrutura do Railway (IaC). Aplicar com:  railway config plan && railway config apply
 * Segredos (TOKEN_ENCRYPTION_KEY, GOOGLE_*; SETUP_TOKEN só temporariamente) NÃO ficam aqui: são definidos no Railway
 * (railway variables --set ...) e marcados com preserve() para o IaC nunca sobrescrevê-los.
 */
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

const REPO = "graeff01/app_aluguel";

export default defineRailway(() => {
  const db = postgres("Postgres");

  const shared = {
    DATABASE_URL: db.env.DATABASE_URL,
    TOKEN_ENCRYPTION_KEY: preserve(),
    GOOGLE_CLIENT_ID: preserve(),
    GOOGLE_CLIENT_SECRET: preserve(),
  };

  const web = service("web", {
    source: github(REPO, { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run start",
    preDeploy: "npm run db:migrate",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    env: {
      ...shared,
      APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  const worker = service("worker", {
    source: github(REPO, { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run worker",
    preDeploy: "npm run db:migrate",
    deploy: { restartPolicyType: "ALWAYS" },
    env: {
      ...shared,
      APP_URL: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("app_aluguel", { resources: [db, web, worker] });
});
