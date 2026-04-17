import type { Metadata } from "next"
import { Barlow_Condensed, Barlow } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { PostHogProvider } from "@/components/providers/posthog-provider"

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-display',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'beetle — reddit gtm copilot',
  description: 'Find the Reddit threads your buyers are already in.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${barlow.variable}`}>
      <body className="bg-beetle-bg text-beetle-ink font-body antialiased">
        <PostHogProvider>
          {children}
        </PostHogProvider>
        <Toaster />
      </body>
    </html>
  )
}
