import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ShellPort',
  description: 'Zero-dependency encrypted terminal bridge with TOTP 2FA and built-in web UI',
  base: '/shellport/',
  head: [
    ['link', { rel: 'icon', href: '/logo.png' }]
  ],
  ignoreDeadLinks: true,
  themeConfig: {
    logo: '/logo.png',
    editLink: {
      pattern: 'https://github.com/igorls/shellport/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started/installation' },
      { text: 'Guides', link: '/guides/' },
      { text: 'API', link: '/api/' },
      { text: 'Internals', link: '/internals/' },
      { text: 'GitHub', link: 'https://github.com/igorls/shellport' }
    ],
    sidebar: [
      {
        text: 'Getting Started',
        collapsible: true,
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Quick Start', link: '/getting-started/quick-start' }
        ]
      },
      {
        text: 'Guides',
        collapsible: true,
        items: [
          { text: 'Basic Usage', link: '/guides/basic-usage' },
          { text: 'Security', link: '/guides/security' },
          { text: 'TOTP 2FA', link: '/guides/totp' },
          { text: 'Tailscale Integration', link: '/guides/tailscale' }
        ]
      },
      {
        text: 'API Reference',
        collapsible: true,
        items: [
          { text: 'CLI Reference', link: '/api/cli' },
          { text: 'NanoTermV2 Library', link: '/api/nanoterm' }
        ]
      },
      {
        text: 'Internals',
        collapsible: true,
        items: [
          { text: 'Architecture', link: '/internals/architecture' },
          { text: 'Security Model', link: '/internals/security' }
        ]
      },
      {
        text: 'Comparison',
        collapsible: true,
        items: [
          { text: 'Comparison', link: '/comparison' }
        ]
      }
    ],
    search: {
      provider: 'local'
    }
  }
})
