import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/core/components/ThemeProvider";
import { Header } from "@/core/components/Header";
import { Toaster } from "sonner"; // <-- Added

export const metadata: Metadata = {
  title: "ImageForge | Pro Image Processor",
  description: "Background image processing with RabbitMQ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50 transition-colors duration-300">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex flex-col min-h-screen">
            <Header />
            <main className="flex-1 w-full max-w-6xl mx-auto">
              {children}
            </main>
          </div>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}