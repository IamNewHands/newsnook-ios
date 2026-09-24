(function () {
  'use strict';
  if (window.__newsnookFirstPartyRequest) return;
  window.__newsnookFirstPartyResults = Object.create(null);
  window.__newsnookFirstPartyRequest = function (request) {
    var results = window.__newsnookFirstPartyResults;
    var id = request.id;
    if (results[id]) return;
    results[id] = { pending: true };
    var target;
    try { target = new URL(request.url); } catch {}
    var csrf = target && /^\/session\/csrf(?:\.json)?$/.test(target.pathname);
    var timings = target && target.pathname === '/topics/timings';
    if (location.origin !== 'https://linux.do' || !target || target.origin !== 'https://linux.do'
        || target.username || target.password || target.search || target.hash
        || !(csrf && request.method === 'GET' || timings && request.method === 'POST')) {
      results[id] = { error: 'Invalid first-party read-sync request' };
      return;
    }
    var aborter = new AbortController();
    var timeout = setTimeout(function () { aborter.abort(); }, 30000);
    fetch(target.href, {
      method: request.method, credentials: 'include', redirect: 'error', cache: 'no-store',
      headers: request.headers, body: request.method === 'GET' ? undefined : request.body,
      signal: aborter.signal
    }).then(async function (response) {
      var data = await response.text();
      if (data.length > 131072) throw new Error('Response too large');
      var headers = {};
      response.headers.forEach(function (value, name) {
        if (!/^(set-cookie2?|authorization|proxy-authorization)$/i.test(name)) headers[name] = value;
      });
      results[id] = { status: response.status, data: data, headers: headers, responseUrl: response.url };
    }).catch(function () {
      results[id] = { error: 'First-party browser request failed or timed out' };
    }).finally(function () { clearTimeout(timeout); });
  };
})();
