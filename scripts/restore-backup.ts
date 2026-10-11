/**
 * Restaura um backup do Visitas Locação.
 *
 *   1) Prepare um banco VAZIO e rode as migrações da MESMA versão:  DATABASE_URL=<destino> npx prisma migrate deploy
 *   2) Restaure:
 *      RESTORE_DATABASE_URL=<destino> BACKUP_ENCRYPTION_KEY=<chave> npx tsx scripts/restore-backup.ts --arquivo backup.vlb
 *      (ou --chave backups/visitas-AAAA-MM-DD-HHMM.vlb para baixar do armazenamento; exige as variáveis BACKUP_S3_*)
 *   --substituir  apaga os dados do destino antes (cuidado: irreversível)
 *   --listar      só lista os backups disponíveis no armazenamento
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { backupConfig, decryptBackup, restoreInto, s3Storage } from "../src/server/backup";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("Defina BACKUP_ENCRYPTION_KEY (32 bytes em base64).");

if (process.argv.includes("--listar")) {
  const cfg = backupConfig();
  if (!cfg) throw new Error("Defina as variáveis BACKUP_S3_*.");
  for (const k of (await s3Storage(cfg).list("backups/")).sort()) console.log(k);
  process.exit(0);
}

const target = process.env.RESTORE_DATABASE_URL;
if (!target) throw new Error("Defina RESTORE_DATABASE_URL (banco de destino, já migrado).");
let buf: Buffer;
if (arg("arquivo")) buf = readFileSync(arg("arquivo")!);
else if (arg("chave")) {
  const cfg = backupConfig();
  if (!cfg) throw new Error("Defina as variáveis BACKUP_S3_*.");
  buf = await s3Storage(cfg).get(arg("chave")!);
} else throw new Error("Informe --arquivo <caminho> ou --chave <nome no armazenamento>.");

const data = decryptBackup(buf, key);
console.log(`Backup de ${data.createdAt}: ${Object.keys(data.tables).length} tabelas.`);
const r = await restoreInto(target, data, { replace: process.argv.includes("--substituir") });
console.log(`Restaurado: ${r.rows} linhas em ${r.tables} tabelas.`);
