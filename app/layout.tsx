import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { CompanyProvider } from "@/components/layout/company-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IT Finance Dashboard",
  description: "IT Budget Management & Cost Analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="dark min-h-full bg-slate-950 text-slate-100">
        <SessionProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <CompanyProvider>
            <TooltipProvider delay={300}>
              {/* Outer flex: sidebar + content column */}
              <div className="flex min-h-screen">
                {/* Fixed desktop sidebar */}
                <Sidebar />

                {/* Main content column — offset by sidebar width on desktop */}
                <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
                  {/* Sticky header */}
                  <Header />

                  {/* Scrollable page content */}
                  <main className="flex-1 overflow-auto p-6">
                    {children}
                  </main>
                </div>
              </div>
            </TooltipProvider>
          </CompanyProvider>
        </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
