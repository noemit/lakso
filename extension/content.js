/* DOM markers preserve native layout; glass.css owns the visual overrides. */
(() => {
  'use strict';

  const root = document.documentElement;

  const THREAD_ROUTE = /^\/[^/]+\/status\/\d+(?:\/photo\/\d+)?\/?$/;
  const MESSAGES_ROUTE = /^\/(?:i\/chat|messages)(?:\/|$)/;
  // The 2px reply connector between posts. Segments that point up to the
  // previous post are absolutely positioned (atomic class .r-1p0dtai).
  const CONNECTOR = '.r-m5arl1';
  const CONNECTOR_UP = 'r-1p0dtai';
  // The rail collapses to icons below some viewport widths and always on Chat.
  const COMPACT_NAV_MAX_WIDTH = 110;
  // Opaque backgrounds of X's dark, dim and light themes.
  const NATIVE_SURFACES = new Set(['0,0,0', '255,255,255', '21,32,43', '22,24,28', '247,249,249', '239,243,244']);

  let settings = XGlow.normalize();
  let nativeTone = 'dark';
  let frame = 0;

  const mark = (element, name) => {
    if (element && !element.hasAttribute(name)) element.setAttribute(name, '');
  };
  const isThread = () => root.hasAttribute('data-xlg-thread');

  /* ---------------------------------------------------------------- Chat */

  // X Chat renders inside open shadow roots, out of reach of glass.css. The
  // injected stylesheet themes only the interface; messages are never read.
  const CHAT_HOSTS = '[data-testid="xchatEmbedRoute"], [data-testid="xchatEmbedOverlays"]';
  const CHAT_STYLE = 'style[data-xlg-chat-style]';
  const CHAT_CSS = `
    :host([data-xlg-chat]) [data-xchat-root] { background: transparent !important; }
    :host([data-xlg-chat]) [data-testid="dm-container"] { height: 100% !important; position: relative; isolation: isolate; }
    /* The blur lives on a pseudo-element: a backdrop-filter on the container
       would become the containing block of Chat's fixed menus. */
    :host([data-xlg-chat]) [data-testid="dm-container"]::before {
      content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
      background: var(--xlg-surface); border: 1px solid var(--xlg-border); border-radius: 24px;
      box-shadow: inset 0 1px 0 var(--xlg-glint), 0 12px 40px var(--xlg-shadow);
      backdrop-filter: blur(var(--xlg-blur)) saturate(155%);
    }
    :host([data-xlg-chat]) [data-testid="dm-inbox-panel"] { min-width: min(400px, 100%) !important; border-color: var(--xlg-border) !important; }
    :host([data-xlg-chat]) [data-testid="dm-conversation-panel"] { min-width: 0; }
    :host([data-xlg-chat]) [data-testid="dm-conversation-header"] {
      background: rgba(var(--xlg-base), .94) !important;
      border-radius: 24px 24px 0 0; box-shadow: 0 1px 0 var(--xlg-border);
    }
    :host([data-xlg-chat]) [data-testid="dm-search-input"],
    :host([data-xlg-chat]) [data-testid="dm-composer-input-container"] {
      background: rgba(var(--xlg-base), .9) !important;
      box-shadow: inset 0 0 0 1px var(--xlg-border), inset 0 1px 0 var(--xlg-glint);
    }
    :host([data-xlg-chat]) [data-testid="dm-search-input"]:focus,
    :host([data-xlg-chat]) [data-testid="dm-composer-input-container"]:focus-within {
      box-shadow: inset 0 0 0 1px rgba(var(--xlg-ui-accent-rgb), .8), 0 0 0 3px rgba(var(--xlg-ui-accent-rgb), .12);
    }
    :host([data-xlg-chat]) [data-testid="dm-composer-container"]::before {
      content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
      background: linear-gradient(transparent, rgba(var(--xlg-base), .96) 45%); border-radius: 0 0 24px 24px;
    }
    :host([data-xlg-chat]) [data-testid^="dm-conversation-item-"]:hover { background: var(--xlg-hover); }
    :host([data-xlg-chat]) :is([role="menu"], [role="dialog"], [data-slot="popover-content"]) {
      background: rgba(var(--xlg-base), .96) !important;
      box-shadow: inset 0 0 0 1px var(--xlg-border), 0 12px 40px var(--xlg-shadow);
    }
    :host([data-xlg-chat][data-xlg-chat-lite]) [data-testid="dm-container"]::before { backdrop-filter: none; }
    /* From 918px Chat shows the inbox beside the conversation (its own container
       query), so the conversation's left corners meet the inbox. */
    @container (width >= 918px) {
      :host([data-xlg-chat]) [data-testid="dm-conversation-header"] { border-top-left-radius: 0; }
      :host([data-xlg-chat]) [data-testid="dm-composer-container"]::before { border-bottom-left-radius: 0; }
    }
  `;
  const chatHosts = new Map();

  function injectChatStyle(shadow) {
    if (shadow.querySelector(CHAT_STYLE)) return;
    const style = document.createElement('style');
    style.setAttribute('data-xlg-chat-style', '');
    style.textContent = CHAT_CSS;
    shadow.append(style);
  }

  function syncChat() {
    for (const [host, state] of chatHosts) {
      if (host.isConnected) continue;
      state.observer?.disconnect();
      clearTimeout(state.retry);
      chatHosts.delete(host);
    }
    for (const host of document.querySelectorAll(CHAT_HOSTS)) {
      host.toggleAttribute('data-xlg-chat', settings.enabled);
      host.toggleAttribute('data-xlg-chat-lite', settings.lite);
      let state = chatHosts.get(host);
      if (!state) chatHosts.set(host, state = { attempts: 0 });
      const shadow = host.shadowRoot;
      if (!shadow) {
        // The host element is mounted before X attaches its shadow root.
        if (!state.retry && state.attempts++ < 30) state.retry = setTimeout(() => { state.retry = 0; syncChat(); }, 100);
        continue;
      }
      injectChatStyle(shadow);
      if (!state.observer) {
        // Remounting Chat replaces the shadow root's children, style included.
        state.observer = new MutationObserver(() => {
          if (!shadow.querySelector(CHAT_STYLE)) syncChat();
        });
        state.observer.observe(shadow, { childList: true });
      }
    }
  }

  /* ------------------------------------------------------ Navigation rail */

  let observedNav;
  const navObserver = new ResizeObserver(() => syncNavWidth());

  // The banner reserves more width than the rail. Publishing the rail's real
  // width lets glass.css center rail + feed when the sidebar is hidden.
  function syncNavWidth() {
    const header = observedNav?.closest('header[role="banner"]');
    const width = observedNav?.getBoundingClientRect().width;
    if (!header || !(width > 0)) return;
    observedNav.toggleAttribute('data-xlg-nav-compact', width <= COMPACT_NAV_MAX_WIDTH);
    const value = `${width}px`;
    if (header.style.getPropertyValue('--xlg-nav-width') !== value) header.style.setProperty('--xlg-nav-width', value);
  }

  // The glass frame belongs on the rail's fixed (or sticky) shell.
  function discoverNav(header) {
    if (observedNav?.isConnected) return;
    const nav = header?.querySelector('nav');
    for (let shell = nav?.parentElement; shell && shell !== header; shell = shell.parentElement) {
      const position = getComputedStyle(shell).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      mark(shell, 'data-xlg-nav');
      navObserver.disconnect();
      observedNav = shell;
      navObserver.observe(shell);
      syncNavWidth();
      break;
    }
  }

  // X does not set aria-current on every section (Chat, nested routes).
  function isCurrentSection(url, path) {
    if (url.hash || url.origin !== location.origin) return false;
    return url.pathname === path ||
      (url.pathname === '/explore' && path === '/search') ||
      (!/\/status\//.test(path) && path.startsWith(`${url.pathname}/`));
  }

  function syncNavCurrent() {
    const path = location.pathname;
    for (const link of document.querySelectorAll('header[role="banner"] nav a[href]')) {
      const url = new URL(link.getAttribute('href'), location.href);
      link.toggleAttribute('data-xlg-nav-current', isCurrentSection(url, path));
    }
  }

  /* ---------------------------------------------------------- Page layout */

  // Mark the containers that keep reserving width for the hidden sidebar.
  function syncLayout(header, main) {
    if (!main || !header || main.parentElement !== header.parentElement) return;
    mark(main.parentElement, 'data-xlg-layout');
    mark(main, 'data-xlg-main');
    const primary = main.querySelector('[data-testid="primaryColumn"]');
    for (let shell = primary?.parentElement; shell && shell !== main; shell = shell.parentElement) mark(shell, 'data-xlg-column-shell');
  }

  // Runs synchronously in the mutation callback, before the browser paints a
  // route change: X briefly replaces the main column with a loading spinner,
  // and the layout must stay centered on that frame too.
  function syncStructure() {
    root.toggleAttribute('data-xlg-messages', MESSAGES_ROUTE.test(location.pathname));
    syncChat();
    syncNavCurrent();
    if (!settings.enabled) {
      syncConversations(document);
      return;
    }
    root.toggleAttribute('data-xlg-thread', THREAD_ROUTE.test(location.pathname));
    const header = document.querySelector('header[role="banner"]');
    syncLayout(header, document.querySelector('main[role="main"]'));
    discoverNav(header);
  }

  /* -------------------------------------------------- Native backgrounds */

  // Glass surfaces and elements that are already cleared.
  const CLEAR_EXEMPT = '[data-xlg-composer], [data-xlg-toolbar], [data-xlg-reply-notice], [data-xlg-search], [data-xlg-search-popup], [data-xlg-clear]';
  // Backdrops of avatars and media are content, not interface.
  const MEDIA_CONTENT = '[data-testid^="UserAvatar-Container-"], [data-testid="Tweet-User-Avatar"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [role="img"]';

  // X paints its opaque theme color on many inner wrappers, hiding the glass.
  function clearBackground(element) {
    if (element.matches(CLEAR_EXEMPT)) return;
    const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g);
    if (!channels || !NATIVE_SURFACES.has(channels.slice(0, 3).join(','))) return;
    if (channels.length === 4 && Number(channels[3]) === 0) return;
    mark(element, 'data-xlg-clear');
  }

  function clearControls(container) {
    for (const element of container.querySelectorAll('div')) {
      if (element.closest(MEDIA_CONTENT)) continue;
      // A composer wrapper can hold both the avatar and the editor: keep
      // media-only backdrops, but clear the surface around the input.
      const containsMedia = element.querySelector('img, video, canvas, [data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
      const containsInput = element.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]');
      if (containsMedia && !containsInput) continue;
      clearBackground(element);
    }
  }

  /* --------------------------------------------------------------- Search */

  // X renders the rounded input shell and the absolutely positioned
  // suggestions inside the same form. Outside the sidebar the shell is styled
  // instead of the form, so the form's geometry stays native.
  function findSearchField(input, form) {
    if (form.closest('[data-testid="sidebarColumn"]')) return form;
    for (let shell = input.parentElement; shell && shell !== form; shell = shell.parentElement) {
      if (parseFloat(getComputedStyle(shell).borderTopLeftRadius) >= 20) return shell;
    }
    return form;
  }

  function discoverSearches() {
    for (const input of document.querySelectorAll('[data-testid="SearchBox_Search_Input"]')) {
      const form = input.closest('form') || input.closest('[role="search"]');
      if (!form) continue;
      mark(form, 'data-xlg-search-form');
      const field = findSearchField(input, form);
      mark(field, 'data-xlg-search');
      if (field !== form) mark(field, 'data-xlg-search-field');
      field.removeAttribute('data-xlg-clear');
      for (const popup of form.querySelectorAll('[role="listbox"]')) {
        mark(popup, 'data-xlg-search-popup');
        popup.removeAttribute('data-xlg-clear');
      }
      clearControls(form);
      const sidebar = form.closest('[data-testid="sidebarColumn"]');
      if (sidebar) for (let shell = form.parentElement; shell && shell !== sidebar; shell = shell.parentElement) clearBackground(shell);
    }
  }

  /* ------------------------------------------- Connected timeline posts */

  const conversationObserver = new ResizeObserver(() => schedule());
  let conversationCells = new Set();

  // Connector segments tell whether a post continues from the previous cell
  // (up) and into the next one (down).
  function readConnectors(cell) {
    const article = cell.querySelector('article[data-testid="tweet"]');
    const lines = article ? [...article.querySelectorAll(CONNECTOR)] : [];
    const pointsUp = line => line.classList.contains(CONNECTOR_UP) || getComputedStyle(line).position === 'absolute';
    return { cell, up: lines.some(pointsUp), down: lines.some(line => !pointsUp(line)) };
  }

  // Consecutive sibling cells joined by connectors form one conversation.
  function groupConnectedCells(container) {
    const lists = new Map();
    for (const cell of container.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (!lists.has(cell.parentElement)) lists.set(cell.parentElement, []);
      lists.get(cell.parentElement).push(readConnectors(cell));
    }
    const groups = [];
    for (const items of lists.values()) {
      let group = [];
      for (const item of items) {
        const last = group[group.length - 1];
        if (last && !(last.down && item.up)) {
          groups.push(group);
          group = [];
        }
        if (item.up || item.down) group.push(item);
      }
      if (group.length) groups.push(group);
    }
    return groups;
  }

  // The first mounted cell paints one pseudo-element spanning the whole group.
  // An "open" edge continues into cells that X has virtualized out of view.
  function paintConversation(group) {
    const first = group[0], last = group[group.length - 1];
    for (const item of group) {
      mark(item.cell, 'data-xlg-connected');
      item.cell.toggleAttribute('data-xlg-group-start', item === first && !first.up);
      item.cell.toggleAttribute('data-xlg-group-end', item === last && !last.down);
    }
    const shape = `${first.up ? 'open' : 'round'}-${last.down ? 'open' : 'round'}`;
    if (first.cell.getAttribute('data-xlg-conversation') !== shape) first.cell.setAttribute('data-xlg-conversation', shape);
    // Measured after the markers above, which change the cells' padding.
    const height = `${last.cell.getBoundingClientRect().bottom - first.cell.getBoundingClientRect().top}px`;
    if (first.cell.style.getPropertyValue('--xlg-conversation-height') !== height) first.cell.style.setProperty('--xlg-conversation-height', height);
  }

  function syncConversations(container) {
    const groups = settings.enabled && settings.cards && !isThread() ? groupConnectedCells(container) : [];
    for (const group of groups) paintConversation(group);
    const active = new Set(groups.flat().map(item => item.cell));
    const starts = new Set(groups.map(group => group[0].cell));
    // Recycled cells may now hold unrelated posts.
    for (const cell of conversationCells) {
      if (!active.has(cell)) {
        for (const name of ['data-xlg-connected', 'data-xlg-group-start', 'data-xlg-group-end']) cell.removeAttribute(name);
        conversationObserver.unobserve(cell);
      }
      if (!starts.has(cell)) {
        cell.removeAttribute('data-xlg-conversation');
        cell.style.removeProperty('--xlg-conversation-height');
      }
    }
    for (const cell of active) if (!conversationCells.has(cell)) conversationObserver.observe(cell);
    conversationCells = active;
  }

  /* --------------------------------------------------------- Opened post */

  // Opening a post, X anchors it right under the sticky header and can clip
  // the author. Correct only that automatic anchor, for a short time, and stop
  // at the first user scroll.
  let focusEntry;

  function watchInitialFocus(article, toolbar) {
    if (focusEntry?.article === article && focusEntry.path === location.pathname) return;
    const entry = focusEntry = { article, path: location.pathname, cancelled: false };
    const revealAuthor = () => {
      if (focusEntry !== entry || entry.cancelled || !settings.enabled || location.pathname !== entry.path) return;
      if (!article.isConnected || !toolbar.isConnected) return;
      const author = article.querySelector('[data-testid="User-Name"]') || article.querySelector('[data-testid="Tweet-User-Avatar"]');
      if (!author) return;
      const top = author.getBoundingClientRect().top;
      const bar = toolbar.getBoundingClientRect();
      // Only while the author is near the header: when the page starts at
      // the top, the natural flow already leaves room for it.
      if (top > -bar.height && top < bar.bottom + 12) window.scrollBy(0, top - bar.bottom - 12);
    };
    requestAnimationFrame(() => requestAnimationFrame(revealAuthor));
    for (const delay of [100, 350, 750]) setTimeout(revealAuthor, delay);
  }

  const cancelInitialFocus = () => {
    if (focusEntry) focusEntry.cancelled = true;
  };
  const SCROLL_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];
  for (const type of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(type, cancelInitialFocus, { passive: true, capture: true });
  window.addEventListener('keydown', event => {
    if (SCROLL_KEYS.includes(event.key)) cancelInitialFocus();
  }, true);

  function markFocusedPost(primary) {
    const focused = primary.querySelector('article[data-testid="tweet"][tabindex="-1"]');
    const toolbar = primary.querySelector('[data-xlg-toolbar]');
    if (!focused || !toolbar) return;
    mark(focused, 'data-xlg-focused');
    // Reply-permission notices inside the post are identified by role and
    // icon, not localized text. Global toasts are outside the article.
    for (const notice of focused.querySelectorAll('[role="status"][aria-live="polite"]:has(svg[data-testid="icon"])')) {
      mark(notice, 'data-xlg-reply-notice');
      notice.removeAttribute('data-xlg-clear');
    }
    watchInitialFocus(focused, toolbar);
  }

  /* ------------------------------------------------------ Primary column */

  // Sticky children of the column are its headers: title bar, tabs, search.
  function markToolbars(primary) {
    for (const element of primary.querySelectorAll(':scope > div > div')) {
      if (getComputedStyle(element).position !== 'sticky') continue;
      mark(element, 'data-xlg-toolbar');
      clearControls(element);
    }
  }

  function markComposer(primary) {
    const editor = primary.querySelector('[data-testid="tweetTextarea_0"]');
    // The closest ancestor that also holds the Post button.
    let composer = editor?.parentElement;
    while (composer && composer !== primary && !composer.querySelector('[data-testid="tweetButtonInline"]')) composer = composer.parentElement;
    if (!composer || composer === primary) return;
    // A composer inside a post keeps the post's surface.
    const article = editor.closest('article');
    if (article) {
      clearControls(article);
      return;
    }
    // Widen to the outermost wrapper holding nothing but the composer, so its
    // native padding (and the reply context) sit inside the glass surface.
    const isComposerOnly = parent => parent && parent !== primary && !parent.querySelector('article, [data-xlg-toolbar], [role="region"]');
    while (isComposerOnly(composer.parentElement)) composer = composer.parentElement;
    mark(composer, 'data-xlg-composer');
    composer.toggleAttribute('data-xlg-reply-composer', isThread());
    clearControls(composer);
  }

  // Aggregated notifications (likes, follows) use their own article test id.
  function markCellShells(primary) {
    for (const article of primary.querySelectorAll('article:is([data-testid="tweet"], [data-testid="notification"])')) {
      const cell = article.closest('[data-testid="cellInnerDiv"]');
      if (!cell) continue;
      for (let shell = article.parentElement; shell && shell !== cell; shell = shell.parentElement) mark(shell, 'data-xlg-cell-shell');
    }
  }

  // The inline "Show N posts" row is a timeline cell whose only content is a
  // single text button: no posts, links, icons, media or account suggestions.
  function markNewPostsRows(primary) {
    const rows = new Set();
    if (!isThread()) {
      for (const cell of primary.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        if (cell.querySelector('article, a, svg, img, video, [role="heading"], h2, [data-testid="UserCell"]')) continue;
        const buttons = cell.querySelectorAll('button, [role="button"]');
        if (buttons.length === 1 && buttons[0].textContent.trim()) rows.add(buttons[0]);
      }
    }
    for (const button of primary.querySelectorAll('[data-xlg-new-posts]')) {
      if (!rows.has(button)) button.removeAttribute('data-xlg-new-posts');
    }
    for (const button of rows) mark(button, 'data-xlg-new-posts');
  }

  // Search relevance feedback is a standalone two-button group, unlike the
  // action groups inside posts.
  function markSearchFeedback(primary) {
    const onSearch = location.pathname === '/search';
    for (const group of primary.querySelectorAll('[data-testid="cellInnerDiv"] [role="group"]')) {
      const isFeedback = onSearch && !group.closest('article') && !group.querySelector('article') &&
        group.querySelectorAll('button, [role="button"]').length === 2;
      group.toggleAttribute('data-xlg-search-feedback', isFeedback);
    }
  }

  function discoverPrimary(primary) {
    markToolbars(primary);
    markComposer(primary);
    markCellShells(primary);
    markNewPostsRows(primary);
    markSearchFeedback(primary);
    syncConversations(primary);
    if (isThread()) markFocusedPost(primary);
  }

  /* -------------------------------------------------------------- Sidebar */

  function markSidebarPanels() {
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    if (!sidebar) return;
    for (const panel of sidebar.querySelectorAll('div:has(> aside), div:has(> section), div:has(> [data-testid="news_sidebar"]), .r-1phboty.r-1ifxtd0')) {
      // Skip wrappers without real content, such as the footer links.
      if (!panel.querySelector('aside, section, h2, [data-testid="UserCell"], [data-testid="news_sidebar"]')) continue;
      if (!panel.closest('[data-xlg-panel]')) mark(panel, 'data-xlg-panel');
    }
  }

  /* ------------------------------------------------------ Theme settings */

  const PALETTE_PROPERTIES = Object.entries({
    '--xlg-accent-rgb': 'accent',
    '--xlg-ui-accent-rgb': 'interfaceAccent',
    '--xlg-control-start-rgb': 'controlStart',
    '--xlg-control-end-rgb': 'controlEnd',
    '--xlg-base': 'base',
    '--xlg-bg': 'background',
    '--xlg-border': 'border',
    '--xlg-glow-secondary-rgb': 'glowSecondary',
    '--xlg-glow-tertiary-rgb': 'glowTertiary',
    '--xlg-glow-opacity': 'glowOpacity',
    '--xlg-glow-secondary-opacity': 'glowSecondaryOpacity',
    '--xlg-glow-tertiary-opacity': 'glowTertiaryOpacity'
  });

  function apply() {
    root.toggleAttribute('data-xlg', settings.enabled);
    root.setAttribute('data-xlg-tone', nativeTone);
    root.setAttribute('data-xlg-style', settings.style);
    root.toggleAttribute('data-xlg-cards', settings.cards);
    root.toggleAttribute('data-xlg-lite', settings.lite);
    root.toggleAttribute('data-xlg-hide-sidebar', !settings.sidebar);
    const palette = XGlow.palette(settings, nativeTone);
    for (const [property, key] of PALETTE_PROPERTIES) root.style.setProperty(property, palette[key]);
    root.style.setProperty('--xlg-blur', `${settings.blur}px`);
    root.style.setProperty('--xlg-opacity', String(settings.opacity / 100));
    // The feed width is read by glass.css as a length, so publish it there
    // rather than duplicating the value in a second place.
    root.style.setProperty('--xlg-feed-width', `${settings.feedWidth}px`);
    syncChat();
  }

  // X sets its theme color (light, dim, lights out) as the body's inline
  // background. glass.css hides it with !important; the inline value remains.
  function syncTone() {
    const color = document.body?.style.backgroundColor || '';
    const channels = color.match(/[\d.]+/g)?.map(Number);
    if (channels?.length >= 3 && !(channels.length > 3 && channels[3] === 0)) {
      nativeTone = (channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722) > 150 ? 'light' : 'dark';
    }
    apply();
  }

  let observedBody, bodyObserver;

  function observeBody() {
    if (!document.body || observedBody === document.body) return;
    bodyObserver?.disconnect();
    observedBody = document.body;
    bodyObserver = new MutationObserver(syncTone);
    bodyObserver.observe(observedBody, { attributes: true, attributeFilter: ['style'] });
    syncTone();
  }

  /* ------------------------------------------------------------ Discovery */

  function discover() {
    frame = 0;
    observeBody();
    if (!settings.enabled) return;
    syncStructure();
    // Search surfaces are marked first, so toolbar cleanup leaves them intact.
    discoverSearches();
    const primary = document.querySelector('[data-testid="primaryColumn"]');
    if (primary) discoverPrimary(primary);
    markSidebarPanels();
  }

  // Structure is synced immediately; the full discovery runs once per frame.
  function schedule() {
    syncStructure();
    if (!frame) frame = requestAnimationFrame(discover);
  }

  function updateSettings(value) {
    settings = XGlow.normalize(value);
    apply();
    schedule();
  }

  apply();
  chrome.storage.local.get(XGlow.storageKey)
    .then(stored => updateSettings(stored[XGlow.storageKey]))
    .catch(() => { apply(); schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[XGlow.storageKey]) updateSettings(changes[XGlow.storageKey].newValue);
  });

  // Besides added and removed nodes, X updates virtualized cells in place:
  // translateY styles on cells and connector classes on recycled posts.
  const isRelevantMutation = record => record.addedNodes.length || record.removedNodes.length ||
    (record.type === 'attributes' && record.target.matches(`[data-testid="cellInnerDiv"], ${CONNECTOR}`));
  new MutationObserver(records => {
    if (records.some(isRelevantMutation)) schedule();
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  schedule();
})();
