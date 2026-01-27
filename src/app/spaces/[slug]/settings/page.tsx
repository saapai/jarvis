import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth/supabase-server'
import { getOrCreateUser, isSpaceAdmin } from '@/lib/auth/user'
import { getPrisma } from '@/lib/prisma'
import { SpaceSettingsForm } from '@/components/SpaceSettingsForm'

interface SettingsPageProps {
  params: Promise<{ slug: string }>
}

async function getSpace(slug: string) {
  const prisma = await getPrisma()
  return prisma.space.findUnique({
    where: { slug }
  })
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params
  const supabaseUser = await requireAuth()
  const user = await getOrCreateUser(supabaseUser)

  if (!user) {
    redirect('/auth/login')
  }

  const space = await getSpace(slug)

  if (!space) {
    return <div>Space not found</div>
  }

  const isAdmin = await isSpaceAdmin(user.id, space.id)

  if (!isAdmin) {
    redirect(`/spaces/${slug}`)
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Space Settings</h2>
        <p className="text-sm text-gray-500">
          Manage your space configuration
        </p>
      </div>

      <SpaceSettingsForm space={space} />

      {/* Danger Zone */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h3>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h4 className="text-sm font-medium text-red-800">Delete Space</h4>
          <p className="mt-1 text-sm text-red-600">
            Once you delete a space, there is no going back. All members, messages, and data will be permanently deleted.
          </p>
          <button
            className="mt-4 inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            disabled
          >
            Delete Space (Coming Soon)
          </button>
        </div>
      </div>
    </div>
  )
}
