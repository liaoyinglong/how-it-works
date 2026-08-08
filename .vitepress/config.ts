import { defineConfig } from 'vitepress'
import { withPwa } from '@vite-pwa/vitepress'
import { createSidebar } from './sidebar'

const sidebar = createSidebar()

export default withPwa(
  defineConfig({
    lang: 'zh-CN',
    title: 'How It Works',
    description: '从源码、运行时、协议和真实执行链路理解工具、框架和工程项目。',
    cleanUrls: true,
    lastUpdated: true,
    head: [
      ['meta', { name: 'theme-color', content: '#111827' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }],
    ],
    themeConfig: {
      nav: [
        { text: '首页', link: '/' },
        { text: 'GitHub', link: 'https://github.com/liaoyinglong/how-it-works' },
      ],
      sidebar,
      outline: {
        level: [2, 3],
        label: '本页目录',
      },
      search: {
        provider: 'local',
        options: {
          translations: {
            button: {
              buttonText: '搜索文档',
              buttonAriaLabel: '搜索文档',
            },
            modal: {
              noResultsText: '没有找到相关内容',
              resetButtonTitle: '清除查询',
              footer: {
                selectText: '选择',
                navigateText: '切换',
                closeText: '关闭',
              },
            },
          },
        },
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/liaoyinglong/how-it-works' },
      ],
      editLink: {
        pattern: 'https://github.com/liaoyinglong/how-it-works/edit/main/:path',
        text: '在 GitHub 上编辑此页',
      },
      lastUpdated: {
        text: '最后更新',
        formatOptions: {
          dateStyle: 'medium',
          timeStyle: 'short',
        },
      },
      docFooter: {
        prev: '上一篇',
        next: '下一篇',
      },
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '目录',
      darkModeSwitchLabel: '外观',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',
    },
    pwa: {
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'How It Works',
        short_name: 'How It Works',
        description: '源码与工程实现解析',
        theme_color: '#111827',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{css,js,html,svg,ico,png,webp,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: null,
      },
    },
  }),
)
