import { EB_Garamond, Cormorant_Garamond } from 'next/font/google'
import './admin.css'

// Roundletter's editorial faces: Cormorant Garamond (display, italic wordmarks
// + names) and EB Garamond (body/reading). Mono comes from the system stack.
const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--admin-display',
  display: 'swap'
})

const body = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--admin-body',
  display: 'swap'
})

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${body.variable}`}>{children}</div>
}
