import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';
import { slug } from 'github-slugger';

// GitHub's anchors (e.g. #upgrading-to-20), so links written for the README
// and its headings keep working on the site
const slugify = (text: string) => slug(text);

// The latest release: the workspace version only changes in release pull requests
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const minorVersion = version.split('.').slice(0, 2).join('.');

export default defineConfig({
  title: 'rust-fetch',
  description:
    'A resilient HTTP client for JavaScript and TypeScript: fetch() plus the timeouts, retries, typed errors and security limits production code needs, from one Rust core.',
  base: '/rust-fetch/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md'],
  markdown: { anchor: { slugify } },
  head: [['meta', { name: 'theme-color', content: '#654ff0' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '^/guide/' },
      { text: 'Security', link: '/security' },
      { text: 'Performance', link: '/performance' },
      { text: 'Conformance', link: '/conformance' },
      {
        text: 'More',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Using it from Rust', link: '/rust' },
          { text: 'Compatibility', link: '/compatibility' },
          { text: 'Stability and releases', link: '/stability' },
          { text: 'Development', link: '/development' },
          { text: 'FAQ', link: '/faq' },
          { text: 'Changelog', link: 'https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md' },
        ],
      },
      {
        text: `v${minorVersion}`,
        items: [
          { text: `${minorVersion} (latest)`, link: '/' },
          { text: '2.7', link: '/v2.7/' },
          { text: '2.6', link: '/v2.6/' },
          { text: '2.5', link: '/v2.5/' },
          { text: 'Changelog', link: 'https://github.com/asemqaffaf/rust-fetch/blob/main/CHANGELOG.md' },
        ],
      },
    ],
    sidebar: {
      '/v2.6/': [
        {
          text: 'Start here',
          items: [
            { text: 'Introduction', link: '/v2.6/guide/introduction' },
            { text: 'Getting started', link: '/v2.6/guide/getting-started' },
            { text: 'Guide overview', link: '/v2.6/guide/' },
          ],
        },
        {
          text: 'Guide',
          items: [
            {
              text: 'Basics',
              items: [
                { text: 'Client options', link: '/v2.6/guide/configuration' },
                { text: 'Requests and responses', link: '/v2.6/guide/requests' },
                { text: 'Errors', link: '/v2.6/guide/errors' },
              ],
            },
            {
              text: 'Reliability',
              items: [
                { text: 'Timeouts, retries and cancellation', link: '/v2.6/guide/timeouts-and-retries' },
                { text: 'Interceptors', link: '/v2.6/guide/interceptors' },
              ],
            },
            {
              text: 'Streaming and real-time',
              items: [
                { text: 'Streaming and Server-Sent Events', link: '/v2.6/guide/streaming' },
                { text: 'Uploads', link: '/v2.6/guide/uploads' },
                { text: 'WebSockets', link: '/v2.6/guide/websockets' },
              ],
            },
            {
              text: 'Tooling',
              items: [{ text: 'TypeScript', link: '/v2.6/guide/typescript' }],
            },
          ],
        },
        {
          text: 'Production',
          items: [
            { text: 'Security', link: '/v2.6/security' },
            { text: 'Performance', link: '/v2.6/performance' },
            { text: 'Transport conformance', link: '/v2.6/conformance' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/v2.6/architecture' },
            { text: 'Using it from Rust', link: '/v2.6/rust' },
            { text: 'Compatibility and limitations', link: '/v2.6/compatibility' },
            { text: 'Stability and releases', link: '/v2.6/stability' },
            { text: 'Development and benchmarking', link: '/v2.6/development' },
            { text: 'FAQ', link: '/v2.6/faq' },
          ],
        },
      ],
      '/v2.7/': [
        {
          text: 'Start here',
          items: [
            { text: 'Introduction', link: '/v2.7/guide/introduction' },
            { text: 'Getting started', link: '/v2.7/guide/getting-started' },
            { text: 'Guide overview', link: '/v2.7/guide/' },
          ],
        },
        {
          text: 'Guide',
          items: [
            {
              text: 'Basics',
              items: [
                { text: 'Client options', link: '/v2.7/guide/configuration' },
                { text: 'Requests and responses', link: '/v2.7/guide/requests' },
                { text: 'Errors', link: '/v2.7/guide/errors' },
              ],
            },
            {
              text: 'Reliability',
              items: [
                { text: 'Timeouts, retries and cancellation', link: '/v2.7/guide/timeouts-and-retries' },
                { text: 'Concurrency and rate limits', link: '/v2.7/guide/load-limits' },
                { text: 'Circuit breakers', link: '/v2.7/guide/circuit-breakers' },
                { text: 'Observability', link: '/v2.7/guide/observability' },
                { text: 'Interceptors', link: '/v2.7/guide/interceptors' },
              ],
            },
            {
              text: 'Streaming and real-time',
              items: [
                { text: 'Streaming and Server-Sent Events', link: '/v2.7/guide/streaming' },
                { text: 'Uploads', link: '/v2.7/guide/uploads' },
                { text: 'WebSockets', link: '/v2.7/guide/websockets' },
              ],
            },
            {
              text: 'Tooling',
              items: [
                { text: 'TypeScript', link: '/v2.7/guide/typescript' },
              ],
            },
          ],
        },
        {
          text: 'Production',
          items: [
            { text: 'Security', link: '/v2.7/security' },
            { text: 'Performance', link: '/v2.7/performance' },
            { text: 'Reliability under faults', link: '/v2.7/reliability' },
            { text: 'Transport conformance', link: '/v2.7/conformance' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/v2.7/architecture' },
            { text: 'Using it from Rust', link: '/v2.7/rust' },
            { text: 'Compatibility and limitations', link: '/v2.7/compatibility' },
            { text: 'Stability and releases', link: '/v2.7/stability' },
            { text: 'Development and benchmarking', link: '/v2.7/development' },
            { text: 'FAQ', link: '/v2.7/faq' },
          ],
        },
      ],
      '/': [
        {
          text: 'Start here',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Guide overview', link: '/guide/' },
          ],
        },
        {
          text: 'Guide',
          items: [
            {
              text: 'Basics',
              items: [
                { text: 'Client options', link: '/guide/configuration' },
                { text: 'Requests and responses', link: '/guide/requests' },
                { text: 'Errors', link: '/guide/errors' },
              ],
            },
            {
              text: 'Reliability',
              items: [
                { text: 'Timeouts, retries and cancellation', link: '/guide/timeouts-and-retries' },
                { text: 'Concurrency and rate limits', link: '/guide/load-limits' },
                { text: 'Circuit breakers', link: '/guide/circuit-breakers' },
                { text: 'Observability', link: '/guide/observability' },
                { text: 'Interceptors', link: '/guide/interceptors' },
              ],
            },
            {
              text: 'Streaming and real-time',
              items: [
                { text: 'Streaming and Server-Sent Events', link: '/guide/streaming' },
                { text: 'Uploads', link: '/guide/uploads' },
                { text: 'WebSockets', link: '/guide/websockets' },
              ],
            },
            {
              text: 'Tooling',
              items: [
                { text: 'TypeScript', link: '/guide/typescript' },
                { text: 'Testing your code', link: '/guide/testing' },
                { text: 'Examples', link: '/guide/examples' },
                { text: 'API reference', link: '/api/' },
              ],
            },
          ],
        },
        {
          text: 'Production',
          items: [
            { text: 'Security', link: '/security' },
            { text: 'Threat model', link: '/threat-model' },
            { text: 'Independent review', link: '/security-review' },
            { text: 'Security release checklist', link: '/security-release-checklist' },
            { text: 'Performance', link: '/performance' },
            { text: 'Reliability under faults', link: '/reliability' },
            { text: 'Transport conformance', link: '/conformance' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/architecture' },
            { text: 'Using it from Rust', link: '/rust' },
            { text: 'Compatibility and limitations', link: '/compatibility' },
            { text: 'Stability and releases', link: '/stability' },
            { text: 'Development and benchmarking', link: '/development' },
            { text: 'FAQ', link: '/faq' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/asemqaffaf/rust-fetch' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/rust-fetch' },
    ],
    search: { provider: 'local' }, // archived versions set `search: false`, so results are the latest's
    outline: { level: [2, 3] },
    editLink: {
      pattern: 'https://github.com/asemqaffaf/rust-fetch/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT or Apache-2.0 license.',
      copyright: 'rust-fetch',
    },
  },
});
