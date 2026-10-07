import type { Metadata, Viewport } from "next";
import { Chivo, Chivo_Mono } from "next/font/google";
import "./globals.css";

const chivo = Chivo({
  variable: "--font-ui",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const chivoMono = Chivo_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "nextrun — Adaptive Running Coach",
  description:
    "Your running plan keeps up with your life. Adaptive AI coaching that monitors sleep, HRV, and every sport you play.",
  appleWebApp: {
    capable: true,
    title: "nextrun",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#fdfdfc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${chivo.variable} ${chivoMono.variable} antialiased`}
      >
        <div
          hidden
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A coach's paper training logbook being written as you live it; refuses the dark quantified-self dashboard of neon accents and arc gauges.
OWN-WORLD: Ledger-white paper (#F7F8F6), blue feint rules (#CCD6E2), red margin line (#BC3A2A), racing-green buckram cloth chrome (#21402E), green for done (#2F6B45); ruled log rows instead of cards; date/phase stamps; Chivo UI with italic coach annotations, Chivo Mono splits.
STORY: The runner opens today's page, reads the coach's penciled note explaining what changed and why, trusts it, runs.
FIRST VIEWPORT (phone): today's ruled log entry enlarged - session, pace band, readiness verdict in one plain sentence - with the coach's margin note beside it; the week's remaining rows fade below.
FORM: Coach's Paper Logbook, candidate 1 of 7 (IMPECCABLE'S PICK, user-locked); seed 8d83b0a9.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
