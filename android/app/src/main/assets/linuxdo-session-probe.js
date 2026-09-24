(function () {
  'use strict';
  if (location.origin !== 'https://linux.do' || window.__newsnookSessionProbe) return;
  // A synthetic blank document or an interstitial is not a loaded forum page.
  var generator = document.querySelector('meta[name="generator"]');
  var forum = generator && /Discourse/i.test(generator.content || '');
  if (!forum && !document.querySelector('#data-discourse-setup, #data-preloaded')) return;
  window.__newsnookSessionProbe = { pending: true };
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 10000);
  var phase = 'session';
  var options = {
    credentials: 'include', cache: 'no-store', signal: controller.signal,
    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  };
  (async function () {
    try {
      var current = await fetch('/session/current.json', options);
      if (!current.ok || current.headers.get('cf-mitigated') === 'challenge') {
        window.__newsnookSessionProbe = { ready: false, phase: phase, status: current.status };
        return;
      }
      var identity = await current.json();
      var user = identity.current_user || identity.user;
      if (!user || !user.username || !(user.id > 0)) {
        window.__newsnookSessionProbe = { ready: false, phase: phase, status: 401 };
        return;
      }
      phase = 'csrf';
      var response = await fetch('/session/csrf.json', options);
      if (!response.ok || response.headers.get('cf-mitigated') === 'challenge') {
        window.__newsnookSessionProbe = { ready: false, phase: phase, status: response.status };
        return;
      }
      var payload = await response.json();
      if (typeof payload.csrf !== 'string' || !payload.csrf.trim()) {
        window.__newsnookSessionProbe = { ready: false, phase: phase, status: 200 };
        return;
      }
      // This value is read only by the owning app's evaluateJavascript callback.
      // Never log it or expose a JavaScriptInterface to this remote page.
      window.__newsnookSessionProbe = { ready: true, username: user.username, userId: user.id, csrf: payload.csrf };
    } catch {
      window.__newsnookSessionProbe = { ready: false, phase: phase, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  })();
})();
