export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <div className="w-2 h-2 rounded-full bg-[var(--accent-emerald)] animate-pulse" />
            <span className="text-sm text-[var(--text-secondary)]">system online</span>
          </div>
          
          <h1 className="text-5xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-violet)] bg-clip-text text-transparent">
              jarvis
            </span>
          </h1>
          
          <p className="text-xl text-[var(--text-secondary)]">
            sms-powered announcements & polls
          </p>
        </div>

        {/* Phone Number Card */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-violet)] flex items-center justify-center text-2xl">
              📱
            </div>
            <div>
              <p className="text-sm text-[var(--text-muted)] uppercase tracking-wide">text to activate</p>
              <p className="text-2xl font-mono font-semibold text-[var(--text-primary)]">
                +1 (805) 919-8529
              </p>
            </div>
          </div>
        </div>

        {/* Admin Commands - Announcements & Polls */}
        <div className="p-6 rounded-2xl border border-[var(--accent-amber)]/30 bg-[var(--bg-secondary)]">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <span className="text-[var(--accent-amber)]">👑</span> admin commands
          </h3>
          
          {/* Announcement Format */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📢</span>
              <span className="font-medium text-[var(--text-primary)]">send an announcement</span>
            </div>
            <div className="bg-[var(--bg-primary)] rounded-lg p-4 font-mono text-sm border border-[var(--border-subtle)]">
              <p className="text-[var(--accent-cyan)]">announce</p>
              <p className="text-[var(--text-secondary)] mt-1">announce meeting tonight at 7pm in the main room</p>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              → sends to all subscribed users instantly
            </p>
          </div>
          
          {/* Poll Format */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📊</span>
              <span className="font-medium text-[var(--text-primary)]">create a poll</span>
            </div>
            <div className="bg-[var(--bg-primary)] rounded-lg p-4 font-mono text-sm border border-[var(--border-subtle)]">
              <p className="text-[var(--accent-violet)]">poll</p>
              <p className="text-[var(--text-secondary)] mt-1">poll active meeting tonight?</p>
              <p className="text-[var(--text-secondary)]">poll who&apos;s coming to the event on friday?</p>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              → users can reply yes/no/maybe with notes like &quot;yes but running late&quot;
            </p>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent-cyan)] transition-colors">
            <div className="text-3xl mb-3">📢</div>
            <h3 className="font-semibold mb-1">announcements</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              admins can broadcast messages to everyone instantly
            </p>
          </div>
          
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent-violet)] transition-colors">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-semibold mb-1">polls</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              create polls with yes/no/maybe and track responses
            </p>
          </div>
          
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent-emerald)] transition-colors">
            <div className="text-3xl mb-3">🤖</div>
            <h3 className="font-semibold mb-1">smart parsing</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              understands &quot;ya but running 15 late&quot; as yes + note
            </p>
          </div>
          
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent-amber)] transition-colors">
            <div className="text-3xl mb-3">🔄</div>
            <h3 className="font-semibold mb-1">airtable sync</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              all responses synced to your airtable base automatically
            </p>
          </div>
        </div>

        {/* User Commands */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <span className="text-[var(--accent-cyan)]">$</span> user commands
          </h3>
          <div className="space-y-2 font-mono text-sm">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-elevated)]">
              <span className="text-[var(--accent-violet)]">START</span>
              <span className="text-[var(--text-muted)]">→</span>
              <span className="text-[var(--text-secondary)]">opt in to receive messages</span>
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-elevated)]">
              <span className="text-[var(--accent-violet)]">STOP</span>
              <span className="text-[var(--text-muted)]">→</span>
              <span className="text-[var(--text-secondary)]">unsubscribe from all messages</span>
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-elevated)]">
              <span className="text-[var(--accent-violet)]">HELP</span>
              <span className="text-[var(--text-muted)]">→</span>
              <span className="text-[var(--text-secondary)]">see available commands</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-[var(--text-muted)]">
          powered by enclave × twilio × airtable
        </p>
      </div>
    </main>
  )
}
