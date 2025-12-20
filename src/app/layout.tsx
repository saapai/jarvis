import type { Metadata } from 'next'
import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}


