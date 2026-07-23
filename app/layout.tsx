import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { CompanyProvider } from "@/components/layout/company-context";
import { DateRangeProvider } from "@/components/layout/date-range-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Tabular monospace for financial figures (was a dangling --font-geist-mono ref).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IT Finance Dashboard",
  description: "IT Budget Management & Cost Analysis",
};

// Render every route dynamically (no static HTML) so a fresh deploy always
// reaches users. Static HTML was being cached by the browser/CDN, pinning an
// old client bundle — which left interactive controls dead and pages stuck
// "Loading…" because the new JavaScript never replaced the cached one.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:text-sm">
          Skip to main content
        </a>
        <SessionProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <CompanyProvider>
            <DateRangeProvider>
            <TooltipProvider delay={300}>
              {/* Outer flex: sidebar + content column */}
              <div className="flex min-h-screen">
                {/* Fixed desktop sidebar */}
                <Sidebar />

                {/* Main content column — offset by the (collapsible) sidebar width on desktop */}
                <div className="flex flex-1 flex-col min-w-0 transition-[padding] duration-300 ease-out lg:[padding-left:var(--sidebar-w)]">
                  {/* Sticky header */}
                  <Header />

                  {/* Scrollable page content */}
                  <main id="main-content" className="flex-1 overflow-auto">
                    <div className="mx-auto w-full max-w-[1600px] p-6 lg:p-8">
                      {children}
                    </div>
                  </main>
                </div>
              </div>
            </TooltipProvider>
            </DateRangeProvider>
          </CompanyProvider>
        </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
