import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
import { getSettingsSafe } from "@/lib/settings-safe";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getSettingsSafe();
  return {
    name: s.productName,
    short_name: s.productName.length > 12 ? "Visitas" : s.productName,
    description: "Registro rápido de visitas de locação",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f8fa",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
