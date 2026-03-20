import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ShellPort',
  description: 'Zero-dependency encrypted terminal bridge with TOTP 2FA and built-in web UI',
  base: '/shellport/',
  head: [
    ['link', { rel: 'icon', href: '/shellport/logo.png' }]
  ],
  themeConfig: {
    logo: '/shellport/logo.png',
    editLink: {
      pattern: 'https://github.com/igorls/shellport/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    nav: [
      { text: 'Home', link: '/shellport/' },
      { text: 'Getting Started', link: '/shellport/getting-started' },
      { text: 'Guides', link: '/shellport/guides/' },
      { text: 'API', link: '/shellport/api/' },
      { text: 'Internals', link: '/shellport/internals/' },
      { text: 'GitHub', link: 'https://github.com/igorls/shellport' }
    ],
    sidebar: [
      {
        text: 'Getting Started',
        collapsible: true,
        items: [
          { text: 'Installation', link: '/shellport/getting-started' },
          { text: 'Quick Start', link: '/shellport/getting-started/quick-start' }
        ]
      },
      {
        text: 'Guides',
        collapsible: true,
        items: [
          { text: 'Encryption', link: '/shellport/guides/encryption' },
          { text: 'TOTP 2FA', link: '/shellport/guides/totp' },
          { text: 'CLI Client', link: '/shellport/guides/cli-client' }
        ]
      },
      {
        text: 'API Reference',
        collapsible: true,
        items: [
          { text: 'Server Options', link: '/shellport/api/server-options' },
          { text: 'NanoTermV2 Library', link: '/shellport/api/nanoterm' }
        ]
      },
      {
        text: 'Internals',
        collapsible: true,
        items: [
          { text: 'Architecture', link: '/shellport/internals/architecture' },
          { text: 'Security Model', link: '/shellport/internals/security' }
        ]
      }
    ],
    search: {
      provider: 'local'
    }
  }
})
