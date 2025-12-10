import type { Metadata } from 'next'
import { Baumans } from 'next/font/google'
import './globals.css'

const displayFont = Baumans({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-bauhaus',
})

export const metadata: Metadata = {
  title: 'Jarvis SMS',
  description: 'SMS-based announcement and poll system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={displayFont.variable}>{children}</body>
    </html>
  )
}


