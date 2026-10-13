import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { getSettingsSafe } from "@/lib/settings-safe";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ErrorReporter } from "@/components/error-reporter";
import { cookies } from "next/headers";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettingsSafe();
  return {
    title: { default: s.productName, template: `%s · ${s.productName}` },
    description: "Registro de visitas de locação",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: s.productName, statusBarStyle: "default" },
    icons: { icon: [{ url: "/icons/favicon-32.png", sizes: "32x32" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121416" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettingsSafe();
  // aparência escolhida no menu da conta (sem cookie = automático, segue o aparelho)
  const t = (await cookies()).get("vl_theme")?.value;
  const theme = t === "light" || t === "dark" ? t : undefined;
  return (
    <html lang="pt-BR" className={manrope.variable} data-theme={theme} style={{ ["--accent" as string]: s.primaryColor }}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
        <ErrorReporter />
      </body>
    </html>
  );
}
