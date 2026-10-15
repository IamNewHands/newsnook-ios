[中文](README.md) | **English**

# NewsNook（有所闻）

<p align="center">
  <strong>A local-first, ready-out-of-the-box, freely extensible information aggregation and reading platform.</strong>
</p>

<p align="center">
  News, RSS, Web / CMS sites and independent content communities, brought together in one clean, controllable reading experience.
</p>

<p align="center">
  <a href="https://github.com/t59688/newsnook/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/t59688/newsnook?style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/t59688/newsnook?style=flat-square"></a>
  <a href="https://github.com/t59688/newsnook/issues"><img alt="GitHub Issues" src="https://img.shields.io/github/issues/t59688/newsnook?style=flat-square"></a>
  <img alt="Android" src="https://img.shields.io/badge/platform-Android-3DDC84?style=flat-square&logo=android&logoColor=white">
  <img alt="iOS" src="https://img.shields.io/badge/platform-iOS-000000?style=flat-square&logo=apple&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square">
</p>

<p align="center">
  <a href="#why-newsnook">Why NewsNook</a> ·
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#development">Development</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

> **This repository is the iOS port branch**
>
> Upstream [t59688/newsnook](https://github.com/t59688/newsnook) is the Android client. This repository layers an iOS
> implementation on top of it and builds an **unsigned IPA** in the cloud with GitHub Actions:
>
> - **Download**: [`NewsNook-unsigned.ipa`](https://github.com/IamNewHands/newsnook-ios/releases/latest/download/NewsNook-unsigned.ipa)
>   — this address never changes and always points at the latest build
> - **Install**: download the IPA and sign it locally with your own Apple ID using SideStore / LiveContainer / SideInstaller (the artifact contains no certificate, and you do not need to provide one)
> - **Which build am I running?**: the subtitle under "Me → About" shows `build <run>-<shortSHA>`, e.g. `36-8d141d1`
> - **Translation works out of the box**: the keyless Google / Microsoft channels need no API key, and on iOS 18 and above the system's built-in offline translation is available too; the translation channel can be switched straight from the reader's top bar
> - **Build & automation**: [`docs/ios-build.md`](./docs/ios-build.md)
> - **Automatic upstream tracking**: upstream **stable** tags are checked every day; when a new version appears the iOS layer is re-applied, the IPA is built and a release is published
> - **Exactly one release**: the tag is always `ios-latest` and the asset is always `NewsNook-unsigned.ipa`; every build overwrites it in place instead of stacking a tag per upstream version
> - **Branch convention**: `main` = upstream stable code + the iOS layer (fast-forward only); `ios-layer` is the internal single-commit branch used to re-apply the patches
> - **Differences from upstream**: see "iOS feature boundary" in [`docs/ios-build.md`](./docs/ios-build.md#ios-功能边界) (local translation engines, in-app update, casting and media sniffing, etc.)

## What NewsNook is

NewsNook（有所闻）is neither a single-purpose RSS reader nor a conventional news client.

It aims to be **an information doorway that belongs to its user**: right after installation you can read the built-in news and topics, then keep adding your own RSS / Atom / JSON Feed sources, attach recognisable Web / CMS directory sites, and use content communities such as Zhihu through a dedicated site workspace.

All of these sources end up in the same reading toolkit: full-text reading, images and video, translation, AI speed-reading, read-later, history, local search, offline caching, sharing and optional sync.

> NewsNook neither produces nor hosts news content, and it does not drive distribution with ads, cloud profiling or time-on-screen.  
> You decide what to read; the app is responsible for organising it, making it readable and keeping it on your own device.

### At a glance

| Capability | NewsNook |
| --- | --- |
| Read immediately after install | Built-in news sources, topic categories and scenario presets |
| Your own subscriptions | RSS 2.0 / Atom / RDF / JSON Feed / OPML |
| Web sites | Generic directory extraction and framework detection |
| CMS | MacCMS, WordPress, Hugo, Hexo, Ghost and more |
| Dedicated site workspaces | Currently includes a Zhihu workspace |
| Article body | In-app full text, Readability and per-site custom extraction |
| Multimedia | Images, audio, Progressive / HLS / DASH, custom player |
| Casting | DLNA |
| Translation | Cloud translation, AI translation, keyless channels, system offline translation (iOS 18+), Android on-device translation, Bergamot |
| AI | OpenAI-compatible providers, AI speed-reading |
| Local capabilities | Read-later, history, search, recommendations, cache, reading position |
| Sync | Optional account, configuration domain only; reading data stays local |
| Platforms | Android (upstream) · iOS (this repository) |

---

## Why NewsNook

Information today is scattered across news sites, RSS, blogs, independent websites, content communities and video pages. The problem is rarely "there is nothing to read" — it is having to keep switching between a pile of apps, web pages and algorithmic feeds.

NewsNook tries to offer another way.

### Ready out of the box, not starting from a blank page

The first launch does not require you to go find RSS addresses.

The project ships built-in news, technology, AI, business, international and long-form sources plus scenario presets, so you can start reading right away and adjust things into your own information structure later.

### Open subscriptions, not locked into one content pool

Standard feeds are first-class citizens. You can add RSS / Atom / JSON Feed sources, and import from or export to other readers through OPML.

NewsNook does not require content to come from sources the maintainers pre-registered.

### More than RSS

Many sites have no feed at all, or a feed that carries very little information.

NewsNook therefore provides Web Catalog and CMS framework detection, able to recognise categories, pagination, search and content cards from a page directory. The current code includes adapters for MacCMS, WordPress, Hugo, Hexo, Ghost and others, plus a generic directory extraction path.

### Independent sites can have a real workspace

Complex content communities do not fit well when forced into the RSS model.

NewsNook provides a dedicated site workspace architecture for them. The current Zhihu workspace has its own navigation, feed, search, questions and answers, comments, users, topics, collections and account-related modules, without polluting ordinary news sources.

Some account-private or write capabilities depend on the upstream protocol, login state and current live verification; when unavailable they degrade, rather than dressing unverified capabilities up as stable features. See the [Zhihu protocol matrix](./docs/zhihu-protocol.md) for the protocol boundary.

### Local-first, not cloud-first

Reading history, article cache, read-later, read state and reading position belong to the device first.

An account is not a barrier to use. Cloud sync is optional and decoupled from content reading; even without logging in, with the cloud unavailable or the network down, reading that has already been saved locally still works.

### Recommendations may exist, but must not be a black box

NewsNook has no cloud "you might like" feed.

The project includes **local recommendations** that can be turned off: they only re-rank content from currently enabled sources on the device, based on the user's own read behaviour. No reading profile is uploaded, and user-configured categories and sources are never replaced.

See [Local recommendations](./docs/local-recommend.md) for the implementation notes.

---

## Interface

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/home.jpg" alt="Home feed" />
      <br />
      <sub>A feed that works out of the box</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/bilingual.jpg" alt="Bilingual reading" />
      <br />
      <sub>Article translation and bilingual reading</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/scenes.jpg" alt="Scenario presets" />
      <br />
      <sub>Switch reading scenarios in one tap</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/categories.jpg" alt="Categories and sources" />
      <br />
      <sub>Category and source management</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/appearance.jpg" alt="Appearance settings" />
      <br />
      <sub>Appearance and reading preferences</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/home-dark.jpg" alt="Dark mode" />
      <br />
      <sub>Night reading</sub>
    </td>
  </tr>
</table>

> Screenshots evolve with each version; the current release is the source of truth for how the app actually looks.

---

## Features

### 1. News and feeds that work out of the box

- Built-in Chinese and international news, technology, AI, business and long-form sources
- Categorised feeds
- Scenario presets that switch a whole set of categories and sources in one tap
- Single-source browsing
- Favourite sources and quick filtering inside a category
- Pull-to-load, pull-to-refresh and pagination
- Optional local recommendations driven by the on-device reading profile
- Translation of foreign-language list titles

NewsNook's built-in sources are not meant to be a closed content pool. They are just the default configuration: you can disable, reorganise or replace them with your own.

### 2. RSS / Atom / JSON Feed

- RSS 2.0
- Atom
- RDF
- JSON Feed
- Custom subscriptions
- OPML import and export
- Custom categories
- Custom sources take part in the normal feed, scenarios and local capabilities
- Generic article extraction with graceful degradation

For paywalls, aggressive anti-scraping, login-only content or feeds that only return summaries, NewsNook does not promise to bypass the source site's restrictions.

### 3. Web Catalog and CMS

For sites without a standard feed, NewsNook can probe the page directory and build a site-type source.

The current code includes framework detection and adapters for MacCMS, SeaCMS, WordPress, Hugo, Hexo, Ghost and others, while keeping a generic directory parsing path. Capabilities include:

- Directory card extraction
- Category discovery
- Pagination rules
- In-site search templates
- Sorting
- Detail-page parsing
- Media discovery

Framework detection only helps the client understand public page structure. It does not mean bypassing site authentication, authorisation, regional restrictions, paid access or DRM.

### 4. Zhihu workspace

Zhihu is not treated as an ordinary RSS source, but as a dedicated workspace.

The current architecture includes:

- Public recommendation / feed
- Question and answer reading
- Navigation between answers
- Comments
- Search
- User pages
- Topics
- Collection-related screens
- Notification and session modules
- Editor and local drafts
- Android first-party WebView login flow
- Local state isolation per account
- Separate cache, navigation stack and storage domain

Zhihu's upstream protocol may change, and account-private or write capabilities also need the corresponding authorisation and live verification. NewsNook enables or disables operations according to the capability matrix instead of assuming every endpoint stays available forever.

See the [Zhihu protocol matrix](./docs/zhihu-protocol.md) for the detailed design.

### 5. Reader

One unified reader turns different sources into a consistent reading experience:

- Title, source, time, body and images
- Readability plus per-source custom extraction
- Reading position memory
- Font size, typeface, line height, paragraph spacing, first-line indent
- Dark mode
- E-ink mode
- Paged reading
- Image zoom, save and share
- Comment / reply entry points
- Original-article cross-check
- Re-extract the body
- In-app share links

Fully read articles can be kept on the device and revisited without a network connection.

### 6. Video, audio and media discovery

NewsNook does not restrict articles to plain text.

Media capabilities include:

- Progressive media
- HLS
- DASH
- Static media recognition on the page
- Android runtime media discovery on the original page
- A generic media sniffer
- A custom video player
- Playback progress and speed
- Portrait / landscape full screen
- Double-tap, long-press, swipe and zoom player gestures
- DLNA casting
- Some audio / podcast content

Media discovery only uses resource information that the current page session can legitimately produce. DRM, membership, login, regional restrictions and server-side authorisation remain the source site's decision.

See the [media sniffing document](./docs/sniffer.md) for the implementation and boundaries.

### 7. Translation

Article and feed-title translation are both supported.

Online capabilities:

- Google
- Azure
- DeepL
- DeepLX
- OpenAI-compatible AI translation

**Keyless channels**: when the Google and Microsoft API keys are left empty, requests go to the same endpoints the browsers' built-in translation uses (`translate.googleapis.com` and Edge's `translatetext`) — no registration, ready to use. Filling in your own key automatically switches to the official API. These two endpoints are provided by the vendors for their own browsers, have no public SLA, and may be rate-limited or changed at any time.

Local capabilities:

- Android ML Kit
- Bergamot Translator
- iOS 18 and above: the system's built-in translation (`Translation` framework; language packs are downloaded and managed by the system and work fully offline once installed)

The reader offers two main modes: translation only, or original plus translation side by side. **The translation channel can be switched straight from the reader's top bar** without going back to the settings page; text within the same paragraph is always translated as one batch, so you never get "half a translated paragraph plus half the original".

API keys are configured by the user and stored on the device; the client talks directly to the service the user chose.

### 8. AI reading capabilities

NewsNook treats AI as an optional reading tool, not as the controller of the content doorway.

The project currently includes OpenAI-compatible provider configuration and AI speed-reading. You can use your own model endpoint, key and model — the reading experience is not tied to any single AI service.

### 9. Local library

- Read later
- Recently read
- Read state
- Reading position
- Article cache
- List cache
- Local search
- Local recommendations
- Configuration backup and restore

Local search only searches data the device already has; private reading records never need to be uploaded to a search server.

### 10. Optional account and sync

Logging in is not a prerequisite for using NewsNook.

Cloud sync is used for configuration that makes sense across devices, such as subscriptions, categories and app settings. Article bodies, caches, read-later, read state and reading position are not uploaded as part of ordinary cloud sync.

See [Cloud deployment](./docs/cloud-deploy.md) for the cloud implementation.

---

## Privacy and product principles

NewsNook's design follows a few explicit principles:

1. **Local-first**  
   Reading behaviour and caches are stored on the device first.

2. **Account optional**  
   The core reading flow works without registering an account.

3. **The user chooses the sources**  
   Built-in sources, custom feeds, sites and scenarios are all under user control.

4. **No advertising-driven design**  
   The project itself does not rely on an ad feed to increase time on screen.

5. **No cloud reading-profile recommendations**  
   Optional recommendations run on the device; no reading profile is uploaded.

6. **No hosting of third-party content libraries**  
   Content comes from its original publisher; NewsNook fetches, parses and presents it locally.

7. **Respect for source-site permission boundaries**  
   No promise of bypassing login, paywalls, DRM, regional restrictions or other access controls.

See [Legal notice](./docs/legal.md) for more on the legal and liability boundaries.

---

## Install

### iOS

This repository provides an **unsigned IPA** that you sign locally on the device with your own Apple ID:

1. Download [**`NewsNook-unsigned.ipa`**](https://github.com/IamNewHands/newsnook-ios/releases/latest/download/NewsNook-unsigned.ipa) (a fixed address that is always the latest build; you can also download it from the [Releases](https://github.com/IamNewHands/newsnook-ios/releases) page).
2. Sign and install it with SideStore / LiveContainer / SideInstaller or a similar tool.
3. Neither the repository nor the release contains any certificate or provisioning profile, and you do not need to provide your Apple ID.

Once installed, check the `build <run>-<shortSHA>` subtitle under "Me → About" to see which build you are running
(`CFBundleShortVersionString` follows the upstream version and does not change with every build).

The minimum system requirement is iOS 15.0. **The system's built-in offline translation needs iOS 18 or above**; below that the option does not appear and nothing else is affected.

See [iOS build notes](./docs/ios-build.md) for cloud builds, automatic upstream tracking and the branch convention.

### Android

Android is currently the platform officially aimed at users.

Go to **[GitHub Releases](https://github.com/t59688/newsnook/releases)** and download the latest APK.

The project offers two build variants:

| Variant | Who it is for | Notes |
| --- | --- | --- |
| cloud | Most users | Smaller; uses online / AI translation |
| local | Users who need on-device translation | Includes ML Kit / Bergamot and other local translation capabilities; a larger package |

Both variants share the same app identity and can overwrite each other as needed. For actual APK sizes and ABI support, refer to the release notes of the corresponding build.

> When installing a third-party APK on Android, the system may ask you to allow the current browser or file manager to "install unknown apps".

### In-app update

The Android version includes update detection plus download and install. The release channel and download address follow the project's current release / update configuration.

---

## Development

### Tech stack

- React 19
- TypeScript
- Vite
- Capacitor 8
- Android
- iOS (Capacitor 8 + Swift Package Manager, no CocoaPods)
- Tailwind CSS
- Mozilla Readability

Node.js and npm are recommended; Android development additionally needs Android Studio / the Android SDK and a JDK, and iOS development needs macOS and Xcode.

### Running locally

~~~bash
git clone https://github.com/IamNewHands/newsnook-ios.git
cd newsnook-ios

npm install

# web development server
npm run dev
~~~

### Building

~~~bash
# web / front-end production build
npm run build

# static checks
npm run lint
~~~

### iOS

iOS builds do not need a local Mac: push to `main` and trigger the `iOS Build` workflow manually (or let `iOS Sync` call it after detecting a new upstream stable version), and the cloud produces an **unsigned IPA** published as a release asset.

~~~bash
# cloud build: Actions → iOS Build → Run workflow
# artifact: NewsNook-unsigned.ipa (overwrites the ios-latest release in place)

# locally you only run the front-end checks
npm run test:translation      # translation pipeline (keyless channels and paragraph splitting)
npm run test:apple-translation # TS-side contract of the iOS system translation plugin
~~~

With a Mac, use `npx cap sync ios && npx cap open ios` to open the Xcode project. See [iOS build notes](./docs/ios-build.md) for the full instructions.

### Android

~~~bash
# lightweight build
npm run android:run

# full build with on-device translation
npm run android:run:local
~~~

If you need Bergamot's native translation capability, prepare the corresponding dependencies following the Android build documentation first.

See [Android build and debug](./docs/android-build.md) for the full instructions.

### Tests

The repository keeps a large set of module-scoped regression tests in scripts/, covering feeds, caching, translation, media, sharing, sync, CMS framework detection, Zhihu and more.

The available test commands are the `test:*` scripts in package.json. Before committing a change, run at least the tests for the module you touched, plus:

~~~bash
npm run lint
npm run build
~~~

---

## Architecture

NewsNook's core is not any single feed protocol, but one unified "content in → normalise → read" pipeline.

~~~mermaid
flowchart LR
    A["Built-in news sources"] --> F["Fetch / parse"]
    B["RSS / Atom / JSON Feed"] --> F
    C["Web / CMS Catalog"] --> F
    D["Dedicated site workspace"] --> W["Site-specific capabilities"]

    F --> N["Unified Article / Source model"]
    N --> L["Feed / categories / scenarios"]
    N --> R["Unified reader"]

    W --> R

    R --> M["Images / video / audio / DLNA"]
    R --> T["Translation / AI speed-reading"]
    R --> P["Read later / history / search / cache"]

    S["Local Preferences"] --> L
    S --> R

    O["Optional Cloud Sync"] -. "config domain only" .-> S
~~~

### Code structure

~~~text
newsnook/
├─ src/
│  ├─ components/          shared UI and player components
│  ├─ features/            self-contained business capabilities
│  │  ├─ zhihu/            Zhihu workspace
│  │  ├─ mediaSniffer/     media discovery
│  │  ├─ frameworkDetect/  CMS / framework detection
│  │  ├─ catalogEngine/    Web Catalog extraction
│  │  ├─ translation/      translation
│  │  ├─ sync/             sync
│  │  └─ ...
│  ├─ lib/                 feeds, article body, cache, sharing and other foundations
│  ├─ screens/             screen-level UI
│  └─ sources/             Source / Category / Preset registration and preferences
├─ android/                Capacitor Android project
├─ ios/                    Capacitor iOS project (Xcode + SPM, added by the iOS layer)
├─ cloud/                  optional account and configuration sync service
├─ functions/              edge functions / web capabilities
├─ scripts/                test, build and maintenance scripts
└─ docs/                   design, architecture and development docs
~~~

See the [architecture document](./docs/architecture.md) for the fuller module boundaries, data flow and state model.

---

## Documentation

> The linked documents are currently written in Chinese.

| Document | Contents |
| --- | --- |
| [User guide](./docs/user-guide.md) | Feature documentation for users |
| [Architecture](./docs/architecture.md) | App layering, data flow, state model |
| [News sources](./docs/news-sources.md) | Built-in sources and parsing notes |
| [iOS build](./docs/ios-build.md) | iOS layer, cloud IPA builds, upstream tracking, trade-offs and feature boundary |
| [Android build](./docs/android-build.md) | Android environment, signing, debugging and releases |
| [Cloud deployment](./docs/cloud-deploy.md) | The optional sync service |
| [Local recommendations](./docs/local-recommend.md) | Local recommendation algorithm and privacy boundary |
| [Media sniffing](./docs/sniffer.md) | Media discovery, player and capability boundaries |
| [Zhihu protocol](./docs/zhihu-protocol.md) | Zhihu capability matrix and verification status |
| [Differences from FreshRSS](./docs/vs-freshrss.md) | Product positioning comparison |
| [Security policy](./SECURITY.md) | How to report security issues |
| [Contributing guide](./CONTRIBUTING.md) | Development and commit conventions |
| [Legal notice](./docs/legal.md) | Third-party content, liability and licence notes |

---

## What NewsNook is not

To avoid misunderstandings, the following are not project goals:

- Not a mirror or hosting platform for third-party content
- Not a feed product run on advertising and user profiling
- Not a tool for bypassing payment, login, DRM or regional restrictions
- Not a universal crawler that guarantees any website can always be parsed
- Not a reader that requires deploying a server to be usable
- Not a traditional RSS-only subscription tool

NewsNook is better described as a layer of personal reading infrastructure sitting between "information sources" and "the user reading".

---

## Project status

NewsNook is still evolving.

Because many capabilities depend directly on third-party public APIs, feeds, page structures or WebView behaviour, upstream changes can temporarily break a source or a site feature. The project tries to isolate single points of failure through parsers, capability probing, caching and degradation paths, but it does not guarantee third-party availability over time.

If you find a broken source, please open an issue and include as much of the following as possible:

- NewsNook version (iOS: the `build <run>-<shortSHA>` on the About screen; Android: the upstream tag)
- Platform, OS version and device model (Android version / iOS version plus model)
- Source / site name
- Article or page URL
- Screenshots or logs
- Reproduction steps

---

## Contributing

Issues and pull requests are welcome.

You can help with:

- Fixing broken sources
- Adding new public feeds or site adapters
- Improving article extraction
- Improving CMS / Catalog compatibility
- Completing the Zhihu workspace
- Improving video and media experience
- Improving translation and AI reading
- Polishing the Android / iOS / web UI
- Adding tests and documentation

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before you start.

For larger features, opening an issue first to describe the goal, interaction and technical direction is recommended, so work is not duplicated or in conflict with the existing architecture.

---

## Security

Please do not disclose sensitive vulnerabilities, credentials or details usable against real services through public issues.

Report security issues following the process in [SECURITY.md](./SECURITY.md).

API keys, login credentials, signing files and other secrets should never be committed to the Git repository.

---

## License

NewsNook is open source under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

See:

- [LICENSE](./LICENSE)
- [NOTICE](./NOTICE)

NewsNook's licence covers only this project's own code and does not change the ownership of third-party articles, images, videos, trademarks, websites or APIs.

---

## Acknowledgements

NewsNook builds on a large number of excellent open-source projects and open standards, including but not limited to:

- React
- Vite
- TypeScript
- Capacitor
- Tailwind CSS
- Mozilla Readability
- Bergamot Translator

Thanks also to the communities and content publishers who provide public feeds, open APIs, technical documentation and compatibility feedback.

Particular thanks to the [LINUX DO community](https://linux.do/) for supporting open-source exchange, technical discussion and community feedback, and to the community members who follow NewsNook and share suggestions.

### Links

- [LINUX DO](https://linux.do/)

---

## Supporting the project

NewsNook is a free, open-source personal project.

If it helps you, you can:

- Give the repository a star
- Report bugs and compatibility feedback
- Improve the documentation
- Contribute code
- Recommend it to others who need a local-first reading tool

You can also support ongoing maintenance through 爱发电 (Afdian):

[![爱发电](https://img.shields.io/badge/爱发电-支持_NewsNook-946CE6?style=for-the-badge)](https://ifdian.net/a/t59688)

Sponsorship is entirely voluntary and does not affect software features, access to releases or community participation.

---

<p align="center">
  <strong>NewsNook · 有所闻</strong><br />
  <sub>Bring scattered information back into your own reading space.</sub>
</p>
