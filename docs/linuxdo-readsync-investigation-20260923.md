# LinuxDO read-sync investigation: readsync-20260923-r3-firstparty

## Scope and provenance

Base commit: `4a8fe9d` on `beta`. The earlier recovery work landed as `a84c7f7`; this r3 audit and its additional corrections were verified in the independent `newsnook-readsync-proof` worktree without overwriting concurrent work. Unrelated TTS, video, and search modifications in the main workspace are excluded.

The previously supplied signed cloud APK contained the `session-chain` change from `4a8fe9d`. Its failure was not explained by accidentally sending the earlier browserOnly build.

## Confirmed client-side defects

1. `postFormVoid` retried any 403 as a stale CSRF token, including a Cloudflare challenge during the CSRF GET before the timings POST existed. The error lacked the actual request phase and path.
2. Concurrent CSRF requests were not consolidated. Native response handling returned the token without waiting for asynchronous CookieManager writes to finish.
3. The read tracker discarded security/authentication/network failures, ignored Retry-After, could retry transient failures forever, and left retry timers active after stopping. Late callbacks could apply to a new lifecycle.
4. Any successful HTTP status was treated as a timings acknowledgement, even if a redirect returned a login HTML document.
5. Browser verification in AccountView did not apply the returned session to the API client/workspace.
6. The browser fallback executed fetch in a synthetic blank same-origin document. This alone did not establish that the site's ordinary HTML browser initialization had run or that authenticated writing was available.
7. The user-visible failure was a short-lived toast. Production debug logs could not reliably distinguish CSRF preflight, POST, and fallback outcomes.

The real React TopicView test also established that the prior acknowledgement callback did remove blue dots after a successful response. UI rendering alone was not the explanation for the reported 403.

## Implemented correction

- Differentiate literal Discourse BAD CSRF from Cloudflare challenge and permission failures; one bounded token refresh, never generic 403 loops.
- Single-flight CSRF acquisition; generation checks prevent account changes during an asynchronous request from replaying another account's reading data.
- Wait for all CookieManager callbacks before exposing native CSRF responses; bounded failure handling.
- Retain blocked reading batches for explicit same-account recovery; bounded transient retries and Retry-After compliance; cancel stopped-session work.
- Reject redirected/nonempty HTML as a successful timings response. Apply post.read and per-post read sets only after a valid acknowledgement.
- On a challenge, make one bounded ordinary first-party HTML visit, without a JavaScriptInterface exposed to the remote page. The site's own scripts run normally. Verify current user and fresh CSRF before retrying; check that account ID and username match. No CAPTCHA automation, fingerprint spoofing, third-party credential forwarding, or suppression of genuine challenge errors.
- If a user action is required, show an in-app verification action. Keep the current batch until that same account is verified and then resume it.
- Add browser request deadlines and actual transport/response-path metadata. Show a persistent status card and a copyable allowlisted diagnostic containing build marker, phase, path, status, transport, CF-Ray, topic/post numbers, but no Cookie, CSRF, username, query string, or response body.
- Observe only real post article elements, not quoted post-reference nodes.
- Add LinuxDO behavior tests to the Android release workflow.

## Runtime evidence collected in the independent proof worktree

The Pixel_10_Pro emulator is now online. Its system images live under `D:/Android/Sdk`; the previous failed launches used a different SDK root. No emulator data or account was wiped.

The earlier local signed APK was inspected: its embedded capacitor config has no remote server URL, its LinuxDO bundle contains `session-chain`, and it does not force `browserOnly`. APK SHA-256: `43b3737b35d04f1c224bdc52fa10f2daaeafb390f294ac73f4b956f03b02e01c`. This rules out sending the older browser-only frontend.

An independently built DEBUG APK pinned to `4a8fe9d` was installed over the emulator's existing debug app, preserving data. Runtime probes through the actual Capacitor native bridge returned:

| Request | Result |
| --- | --- |
| GET /latest.json?page=0 | 200 JSON, 30 topics |
| GET /session/csrf.json | 200 JSON, token present |
| POST /topics/timings | 403 HTML, cf-mitigated=challenge |

The emulator is not authenticated. The diagnostic POST used an empty body, without topic IDs or fabricated reading durations, so no reading statistics were created. A request from a real first-party Linux.do document reached Discourse and returned the JSON login-required response rather than the Cloudflare challenge. After ordinary first-party initialization, the synthetic browser transport also reached that authentication gate. This is evidence of distinct request/browser initialization behavior, not proof of the exact private WAF rule.

The fresh recovery implementation was executed on the emulator. It visited the actual first-party page and returned `ready=false`, `phase=session`, `status=404`, without a CSRF token or a claimed successful session. Discourse SessionController.current explicitly returns empty 404 for an anonymous user; this now appears as login-required rather than another opaque Cloudflare error.

## Additional r3 correction

The prepared first-party document is retained for a bounded idle period. The retried CSRF/timings requests execute inside that same document; the app no longer obtains a token there and immediately destroys it before retrying in a synthetic blank document. No JavaScriptInterface is exposed to the remote page. The in-document request asset restricts destination, method, credentials, redirects, response size and timeout. Other arbitrary APIs and cross-origin redirects are rejected. Logout/destruction cancels pending work.

Diagnostics distinguish `native`, `browser` and `browser-firstparty`; the copied build marker is `readsync-20260923-r3-firstparty`.

## Verification

Tests execute the real TypeScript API client/service and React views; only the native/network boundary is substituted in those automated cases. The injected JavaScript assets are executed as code, not checked only with source regexes.

- Transport/authentication: 13 cases, including explicit BAD CSRF, challenged CSRF preflight, POST challenge, permission failures, single-flight CSRF, account switching, rejected login HTML, bounded recovery, first-party hop diagnostics and the anonymous-current-session 404 contract.
- Timing queue: 6 cases, including retained security failures, network retry, Retry-After, teardown and stale callbacks.
- Real React TopicView/AccountView: 5 cases, including ACK removing both dots, failed POST preserving them, same-account recovery/resume and a failed GET before any POST.
- Session probe asset: 9 cases.
- First-party request asset: 6 cases.
- Native CookieManager ordering: 4 cases.
- Native browser recovery: 5 cases.

The baseline failed eight original transport cases and all six queue cases. Its real React ACK path already cleared blue dots, so the visual component alone was not the cause of the reported HTTP failure.

The existing LinuxDO suite, release/update contract, Cloudflare routing, WebView runtime/CSS compatibility, Android hardware back, logger, lint and production build are included in the verification commands. Expected test-fixture error logs and existing project build/lint warnings must not be described as new production failures. Detailed local command output is under the ignored `evidence/readsync/` directory of `newsnook-readsync-proof`.

## Delivery boundary

Package version remains `1.8.9-beta.3`; this investigation does not publish or retag a GitHub release. Any new local APK must be given an r3-specific filename and have its embedded marker, signature and file hash checked after building. Previous r2 artifacts are not evidence of the r3 source.

The user's authenticated phone request and the server-side posts_read_count increment remain unverified until a logged-in test session is available. The emulator is online but not logged in. Do not report a completed authenticated end-to-end fix based only on these successful builds and controlled tests. Genuine interactive challenges must remain explicit and user-completed.
