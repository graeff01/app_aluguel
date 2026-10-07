import { getSettings } from "./settings";

/** Configuração visual com fallback (o app continua renderizando se o banco estiver indisponível). */
export async function getSettingsSafe() {
  try {
    const s = await getSettings();
    return { productName: s.productName, primaryColor: s.primaryColor };
  } catch {
    return { productName: "Visitas Locação", primaryColor: "#dc7519" };
  }
}
