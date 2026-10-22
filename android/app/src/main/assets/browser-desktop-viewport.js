/* Applied only while the user requests a desktop page. Never handles website image clicks. */
(() => {
  if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
  if (window.__newsnookDesktopViewport) { window.__newsnookDesktopViewport.apply(); return; }
  const content = 'width=980, user-scalable=yes';
  const originals = new Map();
  let owned = null;
  let stopped = false;
  const apply = () => {
    if (stopped || !document.head) return;
    let metas = [...document.querySelectorAll('meta[name="viewport" i]')];
    if (!metas.length) {
      owned = document.createElement('meta');
      owned.name = 'viewport';
      owned.content = content;
      document.head.appendChild(owned);
      metas = [owned];
    }
    for (const meta of metas) {
      const value = meta.getAttribute('content');
      if (value === content) continue;
      if (meta !== owned) originals.set(meta, value);
      meta.setAttribute('content', content);
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['content', 'name'] });
  window.__newsnookDesktopViewport = {
    apply,
    restore() {
      stopped = true;
      observer.disconnect();
      for (const [meta, value] of originals) {
        if (value === null) meta.removeAttribute('content');
        else meta.setAttribute('content', value);
      }
      if (owned) owned.remove();
      delete window.__newsnookDesktopViewport;
    },
  };
  apply();
})();
