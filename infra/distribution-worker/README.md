# @md-editor/distribution-worker

The download gateway for Inkpoint, a [Cloudflare Worker](https://workers.cloudflare.com/) served at `download.jiaqi.im`. It gives installers a stable address, serves the version lists and the app's update manifest, and works when GitHub is slow or rate limited. The older domain `download.justdev.cn` redirects here.

Installers are served from the same domain as the manifests that list them, so a client never has to follow a link to another host.

## Routes

`<app>` is `inkpoint`. It can be left out for the default app.

| Route | Returns |
| :--- | :--- |
| `/<app>/desktop/<platform>/latest` | Redirect to the latest desktop package. Platforms: `macos`, `macos-x64`, `windows`, `windows-arm64`, `linux`, `linux-arm64`, `linux-deb`, `linux-deb-arm64`. |
| `/<app>/desktop/updater.json` | The update manifest the desktop app reads |
| `/<app>/desktop/install.sh`, `install.ps1` | The install scripts |
| `/<app>/android/latest` | The latest published Android APK |
| `/<app>/ios/latest` | The latest published unsigned iOS IPA, when `version.json` has an iOS entry |
| `/<app>/<version>/<file>` | A specific file from a specific version |
| `/api/<app>/version.json` | The latest version of each platform |
| `/api/<app>/releases` | The full release history, with `/api/<app>/android/releases` and similar per-platform lists |
| `/<app>/`, `/<app>/<platform>/`, `/releases` | A plain directory-style index of versions |
| `/gh/<org>/<repo>/releases/download/<tag>/<file>` | A cached mirror of a GitHub release asset |
| `POST /api/purge-cache` | Clears the edge cache |

Android and iOS are no longer released. The routes stay so the last published builds (0.2.1) keep working.

## Where the data comes from

The version history tries three sources in order, so the page still works when one of them fails:

1. **R2.** The bucket `inkpoint-releases` holds `releases.json`, `version.json`, the update manifest and the mobile packages. For desktop packages the Worker looks in R2 first and then streams the file from the GitHub release.
2. **The GitHub Releases API**, read live.
3. **`src/fallback-releases.json`**, a snapshot bundled into the Worker. It is the only source when both of the others are down.

After a release uploads new files, CI calls `POST /api/purge-cache` and the Cloudflare purge API, so the new version appears at once. Downloads are counted in a D1 database (`DOWNLOAD_ANALYTICS`, see `migrations/`).

## Layout

```
infra/distribution-worker/
├── src/
│   ├── index.ts                   # Worker entry
│   ├── router.ts, router/         # route matching: system, catalog, latest-artifacts, manifest-api
│   ├── distribution/              # GitHub release and asset handling, streaming responses
│   ├── releases/                  # building the release list, version comparison
│   ├── portal.ts                  # the directory-style HTML index
│   ├── analytics.ts               # download counting
│   └── fallback-releases.json     # bundled snapshot
├── migrations/                    # D1 schema for download counts
├── tests/
└── wrangler.toml
```

## Development and deploy

```bash
pnpm dev:worker                                      # run locally with Wrangler
pnpm --filter @md-editor/distribution-worker test    # unit tests
pnpm deploy:worker                                   # deploy to Cloudflare
```

`HMAC_SALT` is set as a secret with `wrangler secret put HMAC_SALT`.
