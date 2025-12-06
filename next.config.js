/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['twilio', '@libsql/client', '@prisma/adapter-libsql', 'libsql']
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize libsql native bindings
      config.externals.push('@libsql/darwin-x64', '@libsql/darwin-arm64', '@libsql/linux-x64-gnu', '@libsql/linux-arm64-gnu', '@libsql/win32-x64-msvc')
    }
    return config
  }
}

module.exports = nextConfig


