/*
 * Sora View media layer
 *
 * This file intentionally does not depend on Svelte hydration. SvelteKit owns
 * page routing/data; this small client controller owns fast video-modal state.
 */
(function () {
  'use strict';

  var state = {
    open: false,
    video: null,
    videos: [],
    index: -1,
    remixes: [],
    similar: [],
    collections: [],
    collectionMemberships: [],
    remixesLoading: false,
    remixesForId: null,
    comments: [],
    commentsLoading: false,
    commentsForId: null,
    commentReplies: {},
    muted: true,
    lastFocus: null
  };

  var overlay = null;
  var videoEl = null;

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function attr(value) {
    return esc(value).replace(/`/g, '&#096;');
  }

  function parseVideoFromCard(card) {
    try {
      var raw = card.getAttribute('data-video-json') || '{}';
      var video = JSON.parse(raw);
      if (!video || !video.id) return null;
      return video;
    } catch (e) {
      return null;
    }
  }

  function videosFromCards() {
    var seen = Object.create(null);
    return qsa('[data-sora-video-card]')
      .map(parseVideoFromCard)
      .filter(function (video) {
        if (!video || seen[video.id]) return false;
        seen[video.id] = true;
        return true;
      });
  }

  function findIndex(videos, id) {
    id = String(id);
    for (var i = 0; i < videos.length; i++) {
      if (String(videos[i].id) === id) return i;
    }
    return -1;
  }

  function withVideoParam(id) {
    var url = new URL(window.location.href);
    url.searchParams.set('video', String(id));
    return url.pathname + url.search + url.hash;
  }

  function withoutVideoParam() {
    var url = new URL(window.location.href);
    url.searchParams.delete('video');
    return url.pathname + url.search + url.hash;
  }

  function setUrlVideo(id, mode) {
    try {
      var href = id == null ? withoutVideoParam() : withVideoParam(id);
      if (mode === 'replace') history.replaceState({ soraVideo: id || null }, '', href);
      else history.pushState({ soraVideo: id || null }, '', href);
    } catch (e) {}
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return String(d); }
  }

  function fmtDuration(s) {
    if (!s) return '';
    var n = Number(s);
    if (!Number.isFinite(n)) return '';
    return n >= 60 ? (Math.floor(n / 60) + 'm ' + Math.round(n % 60) + 's') : (n.toFixed(1) + 's');
  }

  function cameoList(video) {
    if (!video) return [];
    if (Array.isArray(video.cameos)) return video.cameos.filter(Boolean);
    if (video.cameo_list) return String(video.cameo_list).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return [];
  }

  function sourceLabel(sourceDir) {
    if (sourceDir === 'remix_parent') return 'Remix parent';
    if (sourceDir === 'remix_downstream') return 'Downstream remix';
    if (!sourceDir) return '';
    return String(sourceDir).replace(/_/g, ' ');
  }

  function valueOrEmpty(value) {
    return value == null || value === '' ? '' : String(value);
  }

  function isLiked(value) {
    return value === 1 || value === true || value === '1';
  }

  function isMobileViewport() {
    try {
      return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    } catch (e) {
      return window.innerWidth <= 760;
    }
  }

  function hasVideoParam() {
    try { return new URL(window.location.href).searchParams.has('video'); } catch (e) { return false; }
  }

  function videoSrc(id) {
    return '/api/video/' + attr(id);
  }

  function posterAttr(video) {
    return video && video.thumbnail_path ? ' poster="/api/asset/' + attr(video.id) + '/thumb"' : '';
  }

  function compactStat(value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function mobileStats(video) {
    var bits = [];
    var views = compactStat(video && video.view_count);
    var likes = compactStat(video && video.like_count);
    var remixes = compactStat(video && video.remix_count);
    if (views) bits.push('👁 ' + esc(views));
    if (likes) bits.push('♥ ' + esc(likes));
    if (remixes) bits.push('↻ ' + esc(remixes));
    return bits.length ? '<div class="sv-mobile-reel-stats">' + bits.join('<span>·</span>') + '</div>' : '';
  }

  function pauseNonMobileVideos(active) {
    if (!overlay) return;
    qsa('.sv-mobile-lightbox-item video', overlay).forEach(function (video) {
      if (video === active) return;
      try { video.pause(); } catch (e) {}
    });
  }

  function playMobileVideo(video) {
    if (!video) return;
    pauseNonMobileVideos(video);
    try {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.removeAttribute('controls');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.play().catch(function () {});
    } catch (e) {}
  }

  function activeMobileVideo() {
    if (!overlay) return null;
    return qs('[data-sv-mobile-reel-item].is-active video', overlay) || qs('.sv-mobile-lightbox-item video', overlay);
  }

  function setMobileControlsVisible(visible) {
    if (!overlay) return;
    overlay.classList.toggle('sv-mobile-controls-visible', !!visible);
  }

  function toggleMobileControls() {
    if (!overlay) return;
    setMobileControlsVisible(!overlay.classList.contains('sv-mobile-controls-visible'));
  }

  function playMostVisibleMobileVideo() {
    if (!overlay) return;
    var reel = qs('[data-sv-mobile-reel]', overlay);
    if (!reel) return;
    var rootRect = reel.getBoundingClientRect();
    var bestItem = null;
    var bestVisible = 0;
    qsa('[data-sv-mobile-reel-item]', reel).forEach(function (item) {
      var rect = item.getBoundingClientRect();
      var visible = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
      if (visible > bestVisible) {
        bestVisible = visible;
        bestItem = item;
      }
    });
    if (!bestItem) return;
    qsa('[data-sv-mobile-reel-item]', reel).forEach(function (item) {
      item.classList.toggle('is-active', item === bestItem);
    });
    var activeId = bestItem.getAttribute('data-video-id');
    var activeIndex = Number(bestItem.getAttribute('data-video-index') || -1);
    var activeVideo = qs('video', bestItem);
    if (activeVideo) playMobileVideo(activeVideo);

    // Important: mobile swipe navigation is purely client-side. Do not update
    // ?video=, do not fetch remixes, and do not re-render the reel while the
    // user is swiping. Re-rendering here was causing the view to jump back to
    // the originally tapped card.
    if (activeId && String(state.video && state.video.id) !== String(activeId)) {
      var found = findIndex(state.videos, activeId);
      if (found >= 0) {
        state.index = found;
        state.video = state.videos[found];
      } else if (Number.isFinite(activeIndex) && activeIndex >= 0 && state.videos[activeIndex]) {
        state.index = activeIndex;
        state.video = state.videos[activeIndex];
      }
    }
  }

  function renderMobileReel() {
    var videos = Array.isArray(state.videos) && state.videos.length ? state.videos : [state.video];
    var index = state.index >= 0 ? state.index : findIndex(videos, state.video && state.video.id);
    if (index < 0) index = 0;
    ensureOverlay();
    overlay.classList.add('sv-mobile-reel-mode');
    overlay.innerHTML = '' +
      '<div class="sv-mobile-lightbox-shell">' +
        '<button class="sv-close sv-icon-button" type="button" data-sv-close aria-label="Close video">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="sv-mobile-lightbox-reel" data-sv-mobile-reel aria-label="Swipe video feed">' +
          videos.map(function (item, i) {
            return '<section class="sv-mobile-lightbox-item" data-sv-mobile-reel-item data-video-id="' + attr(item.id) + '" data-video-index="' + i + '">' +
              '<video src="' + videoSrc(item.id) + '"' + posterAttr(item) + ' muted loop playsinline preload="' + (Math.abs(i - index) <= 1 ? 'auto' : 'none') + '"></video>' +
              '<div class="sv-mobile-reel-gradient"></div>' +
              '<div class="sv-mobile-reel-actions" aria-label="Mobile video controls">' +
                '<button type="button" data-sv-mobile-action="play" aria-label="Play or pause">⏯</button>' +
                '<button type="button" data-sv-mobile-action="mute" aria-label="Mute or unmute">🔇</button>' +
              '</div>' +
              '<div class="sv-mobile-reel-copy">' +
                (item.author ? '<a href="/creators/' + encodeURIComponent(item.author) + '" data-sv-close-before-nav>@' + esc(item.author) + '</a>' : '') +
                (item.prompt ? '<p>' + esc(item.prompt) + '</p>' : '') +
                mobileStats(item) +
              '</div>' +
            '</section>';
          }).join('') +
        '</div>' +
      '</div>';
    document.body.classList.add('sora-lightbox-open');
    var reel = qs('[data-sv-mobile-reel]', overlay);
    if (reel) {
      var scrollTimer = null;
      var touchStartX = 0;
      var touchStartY = 0;
      var touchStartAt = 0;
      setMobileControlsVisible(false);

      reel.addEventListener('touchstart', function (event) {
        if (!event.touches || !event.touches.length) return;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
        touchStartAt = Date.now();
      }, { passive: true });

      reel.addEventListener('touchend', function (event) {
        if (!event.changedTouches || !event.changedTouches.length) return;
        var dx = Math.abs(event.changedTouches[0].clientX - touchStartX);
        var dy = Math.abs(event.changedTouches[0].clientY - touchStartY);
        var elapsed = Date.now() - touchStartAt;
        if (dx < 14 && dy < 14 && elapsed < 650) {
          toggleMobileControls();
        } else {
          setMobileControlsVisible(false);
        }
      }, { passive: true });

      reel.addEventListener('click', function (event) {
        var action = event.target && event.target.closest ? event.target.closest('[data-sv-mobile-action]') : null;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        var video = activeMobileVideo();
        if (!video) return;
        var kind = action.getAttribute('data-sv-mobile-action');
        if (kind === 'play') {
          if (video.paused) video.play().catch(function () {});
          else video.pause();
        } else if (kind === 'mute') {
          video.muted = !video.muted;
          action.textContent = video.muted ? '🔇' : '🔊';
        }
      }, true);

      reel.addEventListener('scroll', function () {
        setMobileControlsVisible(false);
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(playMostVisibleMobileVideo, 90);
      }, { passive: true });
      window.setTimeout(function () {
        var item = qsa('[data-sv-mobile-reel-item]', reel)[index];
        if (item) item.scrollIntoView({ block: 'start', inline: 'nearest' });
        playMostVisibleMobileVideo();
      }, 30);
      window.setTimeout(playMostVisibleMobileVideo, 250);
    }
  }

  function countChip(label, value, icon, hideZero) {
    if (value == null || value === '') return '';
    var n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (hideZero && n <= 0) return '';
    return '<span class="sv-stat-chip" aria-label="' + esc(n.toLocaleString() + ' ' + label) + '">' +
      (icon ? '<span class="sv-stat-icon" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon + '</span>' : '') +
      '<strong>' + esc(n.toLocaleString()) + '</strong></span>';
  }

  function videoStats(video) {
    var chips = [
      countChip('views', video.view_count, '👁', true),
      countChip('likes', video.like_count, '♥', true),
      countChip('remixes', video.remix_count, '↻', true),
      countChip('shares', video.share_count, '↗', true),
      countChip('replies', video.reply_count, '💬', true)
    ].filter(Boolean);
    if (!chips.length) return '';
    return '<div class="sv-section sv-stats-section"><h4>Stats</h4><div class="sv-meta sv-stats">' + chips.join('') + '</div></div>';
  }

  function metadataLabel(source) {
    if (source === 'extracted_json') return 'Extracted JSON';
    if (source === 'soravault_manifest') return 'SoraVault manifest';
    if (source === 'soravault_remix_manifest') return 'Remix manifest';
    if (source === 'sidecar_txt') return 'Sidecar text';
    if (source === 'filename_path') return 'Filename/path fallback';
    return source ? String(source).replace(/_/g, ' ') : '';
  }

  function technicalDetails(video) {
    var rows = [];
    function add(label, value) { if (value != null && value !== '') rows.push('<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>'); }
    add('Post ID', video.post_id);
    add('Generation ID', video.generation_id);
    add('Task ID', video.task_id);
    if (video.width && video.height) add('Resolution', video.width + '×' + video.height);
    add('Duration', fmtDuration(video.duration_s));
    add('Aspect ratio', video.aspect_ratio);
    add('Parent remix', video.parent_post_id || video.parent_generation_id || video.parent_task_id);
    add('Root remix', video.root_post_id);
    if (!window.SORA_VIEW_SETTINGS || window.SORA_VIEW_SETTINGS.showFullPaths !== false) add('Full path', video.full_path || video.file_path);
    add('Metadata source', metadataLabel(video.metadata_source));
    if (!rows.length) return '';
    return '<details class="sv-details"><summary>Technical details</summary><dl>' + rows.join('') + '</dl></details>';
  }


  function localActions(video) {
    var fav = video.local_favorite == 1 || video.local_favorite === true;
    var hidden = video.hidden == 1 || video.hidden === true;
    var reviewed = video.reviewed == 1 || video.reviewed === true;
    var collections = state.collections || [];
    var memberships = state.collectionMemberships || [];
    var memberIds = {};
    for (var i = 0; i < memberships.length; i++) memberIds[String(memberships[i].id)] = true;
    var pickerOptions = collections.filter(function (c) { return !memberIds[String(c.id)]; });

    var membershipsHtml = memberships.length
      ? '<div class="sv-collection-members" aria-label="Collections containing this video">' +
          memberships.map(function (m) {
            return '<span class="sv-collection-chip">' +
              '<a href="/collections/' + encodeURIComponent(m.id) + '" data-sv-close-before-nav>' + esc(m.name) + '</a>' +
              '<button type="button" class="sv-chip-remove" data-sv-remove-collection="' + attr(m.id) + '" aria-label="Remove from ' + attr(m.name) + '" title="Remove from this collection">×</button>' +
            '</span>';
          }).join('') +
        '</div>'
      : '<p class="sv-collection-empty">Not in any collection yet.</p>';

    return '<details class="sv-details sv-local-actions"><summary>Local library</summary>' +
      '<div class="sv-action-row">' +
        '<button type="button" class="sv-action" data-sv-toggle="local_favorite" data-value="' + (fav ? '0' : '1') + '">' + (fav ? '★ Favorited' : '☆ Favorite') + '</button>' +
        '<button type="button" class="sv-action" data-sv-toggle="reviewed" data-value="' + (reviewed ? '0' : '1') + '">' + (reviewed ? '✓ Reviewed' : 'Mark reviewed') + '</button>' +
        '<button type="button" class="sv-action sv-danger-action" data-sv-toggle="hidden" data-value="' + (hidden ? '0' : '1') + '">' + (hidden ? 'Unhide' : 'Hide') + '</button>' +
      '</div>' +
      '<div class="sv-action-row">' +
        '<button type="button" class="sv-action" data-sv-copy="prompt">Copy prompt</button>' +
        '<button type="button" class="sv-action" data-sv-copy="path">Copy path</button>' +
        '<button type="button" class="sv-action" data-sv-open-folder>Open folder</button>' +
      '</div>' +
      '<div class="sv-collection-row">' +
        '<select data-sv-collection-select><option value="">Add to collection…</option>' + pickerOptions.map(function (c) { return '<option value="' + attr(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="sv-action" data-sv-add-collection>Add</button>' +
      '</div>' +
      '<div class="sv-collection-row">' +
        '<input type="text" data-sv-new-collection placeholder="New collection name" />' +
        '<button type="button" class="sv-action" data-sv-create-collection>Create + add</button>' +
      '</div>' +
      '<div class="sv-collection-membership">' +
        '<span class="sv-collection-label">In collections</span>' +
        membershipsHtml +
      '</div>' +
    '</details>';
  }

  function similarVideos() {
    if (!state.similar || !state.similar.length) return '';
    return '<section class="sv-remixes"><div class="sv-remix-heading"><h3>More like this</h3><span>' + state.similar.length + '</span></div><div class="sv-remix-list">' +
      state.similar.slice(0, 12).map(function (item) {
        return '<button class="sv-remix-row" type="button" data-sv-similar-id="' + attr(item.id) + '">' +
          '<video class="sv-remix-thumb" src="/api/video/' + attr(item.id) + '" muted playsinline preload="metadata"></video>' +
          '<span class="sv-remix-copy"><strong>' + esc(item.author || 'Unknown creator') + '</strong>' +
          (item.prompt ? '<em>' + esc(item.prompt) + '</em>' : '') +
          '<small>' + esc((item.duration_s ? fmtDuration(item.duration_s) + ' · ' : '') + (item.date ? fmtDate(item.date) : 'No date')) + '</small></span>' +
        '</button>';
      }).join('') + '</div></section>';
  }

  function authorInitial(video) {
    var name = video && video.author ? String(video.author) : '?';
    return esc(name.slice(0, 1).toUpperCase());
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var diff = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + 'mo ago';
    return Math.floor(diff / (86400 * 365)) + 'y ago';
  }

  function commentAttachments(json) {
    if (!json) return [];
    try { var arr = JSON.parse(json); return Array.isArray(arr) ? arr : []; }
    catch (e) { return []; }
  }

  function renderCommentRow(c, isReply) {
    if (!c) return '';
    var displayName = c.author_display_name || c.author_username || 'unknown';
    var initialChar = (c.author_display_name || c.author_username || '?').trim().charAt(0).toUpperCase() || '?';
    var avatarUrl = c.author_username ? '/api/avatar/' + encodeURIComponent(c.author_username) : null;
    var creatorHref = c.author_username ? '/creators/' + encodeURIComponent(c.author_username) : null;
    var attachments = commentAttachments(c.attachments_json);
    var attachmentsHtml = attachments.length
      ? '<div class="sv-comment-attachments">' + attachments.map(function (att) {
          var src = att.url_thumbnail || att.thumbnail_url || att.url_md || att.url_source;
          return src ? '<img class="sv-comment-attachment" src="' + attr(src) + '" alt="" loading="lazy" />' : '';
        }).join('') + '</div>'
      : '';
    var replyCount = Number(c.reply_count || 0);
    var entry = state.commentReplies[c.comment_id] || {};
    var expanded = !!entry.expanded;
    var loading = !!entry.loading;
    var loaded = !!entry.loaded;
    var replyToggle = (replyCount > 0 && !isReply)
      ? '<button class="sv-comment-toggle" type="button" data-sv-toggle-replies="' + attr(c.comment_id) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
          '<span class="sv-comment-dash"></span>' +
          '<span>' + (expanded ? 'Hide' : 'View') + ' ' + replyCount + ' ' + (replyCount === 1 ? 'reply' : 'replies') + '</span>' +
          '<span class="sv-comment-chev' + (expanded ? ' open' : '') + '">⌄</span>' +
        '</button>'
      : '';
    var replyList = '';
    if (expanded) {
      if (loading) {
        replyList = '<div class="sv-comment-replies"><p class="sv-comment-status">Loading replies…</p></div>';
      } else if (loaded && entry.replies && entry.replies.length) {
        replyList = '<div class="sv-comment-replies">' + entry.replies.map(function (r) { return renderCommentRow(r, true); }).join('') + '</div>';
      } else if (loaded) {
        replyList = '<div class="sv-comment-replies"><p class="sv-comment-status">No replies stored locally.</p></div>';
      }
    }
    var verifiedBadge = c.author_verified ? '<span class="sv-comment-verified" title="Verified">✓</span>' : '';
    var avatarHtml = (avatarUrl
      ? '<img src="' + attr(avatarUrl) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />'
      : '') +
      '<span class="sv-comment-initial">' + esc(initialChar) + '</span>';
    var avatarWrap = creatorHref
      ? '<a class="sv-comment-avatar" href="' + attr(creatorHref) + '" data-sv-close-before-nav aria-label="' + attr(c.author_username || '') + '">' + avatarHtml + '</a>'
      : '<span class="sv-comment-avatar">' + avatarHtml + '</span>';
    var authorWrap = creatorHref
      ? '<a class="sv-comment-author" href="' + attr(creatorHref) + '" data-sv-close-before-nav>' + esc(displayName) + '</a>' + verifiedBadge
      : '<span class="sv-comment-author">' + esc(displayName) + '</span>';
    var likeStr = Number(c.like_count || 0) > 0 ? '<span>♥ ' + Number(c.like_count) + '</span>' : '';
    var timeStr = c.posted_at ? '<span>' + esc(relativeTime(c.posted_at)) + '</span>' : '';

    return '<article class="sv-comment-row' + (isReply ? ' sv-comment-reply' : '') + '">' +
      avatarWrap +
      '<div class="sv-comment-body">' +
        '<div class="sv-comment-head">' + authorWrap + '</div>' +
        (c.text ? '<p class="sv-comment-text">' + esc(c.text) + '</p>' : '') +
        attachmentsHtml +
        '<div class="sv-comment-foot">' + timeStr + likeStr + '</div>' +
        replyToggle +
        replyList +
      '</div>' +
    '</article>';
  }

  function renderComments() {
    if (state.commentsLoading) {
      return '<section class="sv-comments"><div class="sv-comments-heading"><h3>Comments</h3><span>…</span></div><p class="sv-comment-status">Loading comments…</p></section>';
    }
    if (!state.comments || !state.comments.length) return '';
    return '<section class="sv-comments">' +
      '<div class="sv-comments-heading"><h3>Comments</h3><span>' + state.comments.length + '</span></div>' +
      '<div class="sv-comments-list">' +
        state.comments.map(function (c) { return renderCommentRow(c, false); }).join('') +
      '</div>' +
    '</section>';
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sv-lightbox';
    overlay.setAttribute('data-lightbox-root', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Video lightbox');
    overlay.addEventListener('click', onOverlayClick);
    document.body.appendChild(overlay);
    return overlay;
  }

  function render() {
    if (!state.open || !state.video) return close({ updateHistory: false });
    if (isMobileViewport()) return renderMobileReel();
    if (overlay) overlay.classList.remove('sv-mobile-reel-mode');
    var video = state.video;
    var cameos = cameoList(video);
    var hasPrev = state.index > 0;
    var hasNext = state.index >= 0 && state.index < state.videos.length - 1;
    var remixesTitle = video.source_dir === 'remix_downstream' ? 'Related remixes' : 'Remixes';
    var remixesHtml = renderRemixes(remixesTitle);
    var source = sourceLabel(video.source_dir);

    ensureOverlay();
    overlay.innerHTML = '' +
      '<div class="sv-backdrop" data-sv-close></div>' +
      '<button class="sv-close sv-icon-button" type="button" data-sv-close aria-label="Close video">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      (hasPrev ? '<button class="sv-nav sv-prev sv-icon-button" type="button" data-sv-prev aria-label="Previous video"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg></button>' : '') +
      (hasNext ? '<button class="sv-nav sv-next sv-icon-button" type="button" data-sv-next aria-label="Next video"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button>' : '') +
      '<div class="sv-modal">' +
        '<section class="sv-player-wrap">' +
          '<button class="sv-mute sv-icon-button" type="button" data-sv-mute aria-label="' + (state.muted ? 'Unmute' : 'Mute') + '">' + muteIcon() + '</button>' +
          '<video class="sv-player" src="/api/video/' + attr(video.id) + '" autoplay loop playsinline controls ' + (state.muted ? 'muted' : '') + '></video>' +
        '</section>' +
        '<aside class="sv-info-panel">' +
          '<div class="sv-author">' +
            '<div class="sv-avatar">' + authorInitial(video) + '</div>' +
            '<div class="sv-author-meta">' +
              (video.author ? '<a class="sv-author-name" href="/creators/' + encodeURIComponent(video.author) + '" data-sv-close-before-nav>' + esc(video.author) + '</a>' : '<span class="sv-author-name">Unknown</span>') +
              (video.date || isLiked(video.liked) ? '<span class="sv-date">' + (video.date ? esc(fmtDate(video.date)) : '') + (isLiked(video.liked) ? ' <span class="sv-liked-mark" title="You liked this video" aria-label="Liked">👍</span>' : '') + '</span>' : '') +
            '</div>' +
          '</div>' +
          (video.prompt ? '<div class="sv-section"><h4>Prompt</h4><p class="sv-prompt">' + esc(video.prompt) + '</p></div>' : '') +
          '<div class="sv-meta">' +
            (video.date ? '<span>Posted ' + esc(fmtDate(video.date)) + '</span>' : '') +
            (source ? '<span>' + esc(source) + '</span>' : '') +
          '</div>' +
          videoStats(video) +
          (cameos.length ? '<div class="sv-section"><h4>Characters</h4><div class="sv-chips">' + cameos.map(function (name) {
            return '<a class="sv-chip" href="/characters/' + encodeURIComponent(name) + '" data-sv-close-before-nav>@' + esc(name) + '</a>';
          }).join('') + '</div></div>' : '') +
          technicalDetails(video) +
          localActions(video) +
          renderComments() +
          remixesHtml +
          similarVideos() +
        '</aside>' +
      '</div>';

    document.body.classList.add('sora-lightbox-open');
    videoEl = qs('.sv-player', overlay);
    if (videoEl) {
      videoEl.muted = state.muted;
      videoEl.play().catch(function () {});
    }
    var closeButton = qs('[data-sv-close]', overlay);
    if (closeButton && closeButton.focus) closeButton.focus({ preventScroll: true });
  }

  function muteIcon() {
    if (state.muted) {
      return '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3.63 3.63a1 1 0 0 0-1.41 1.41L7.29 10.1 7 10H4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h3l5 5v-6.59l4.18 4.18A5.97 5.97 0 0 1 15 17.83v1.76a7.97 7.97 0 0 0 2.23-1.77l2.14 2.14a1 1 0 0 0 1.41-1.41L3.63 3.63zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53A7.96 7.96 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM12 4L9.91 6.09 12 8.18V4zm4.5 8c0-1.77-1-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/></svg>';
    }
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }

  function renderRemixes(title) {
    if (state.remixesLoading) {
      return '<section class="sv-remixes"><div class="sv-remix-heading"><h3>' + esc(title) + '</h3><span>Loading…</span></div><div class="sv-remix-loading">Loading remix list…</div></section>';
    }
    if (!state.remixes.length) {
      if (state.video && state.video.source_dir === 'remix_parent') {
        return '<section class="sv-remixes sv-remix-empty"><div class="sv-remix-heading"><h3>Remixes</h3><span>0</span></div><p>No downstream remixes were matched for this parent yet.</p></section>';
      }
      return '';
    }
    return '<section class="sv-remixes"><div class="sv-remix-heading"><h3>' + esc(title) + '</h3><span>' + state.remixes.length + '</span></div><div class="sv-remix-list">' +
      state.remixes.map(function (remix) {
        return '<button class="sv-remix-row" type="button" data-sv-remix-id="' + attr(remix.id) + '">' +
          '<video class="sv-remix-thumb" src="/api/video/' + attr(remix.id) + '" muted playsinline preload="metadata"></video>' +
          '<span class="sv-remix-copy"><strong>' + esc(remix.author || 'Unknown creator') + '</strong>' +
          (remix.prompt ? '<em>' + esc(remix.prompt) + '</em>' : '') +
          '<small>' + esc((remix.duration_s ? fmtDuration(remix.duration_s) + ' · ' : '') + (remix.date ? fmtDate(remix.date) : 'No date')) + '</small></span>' +
        '</button>';
      }).join('') + '</div></section>';
  }

  function onOverlayClick(event) {
    var target = event.target;
    var closeEl = target.closest && target.closest('[data-sv-close]');
    if (closeEl) {
      event.preventDefault();
      close({ updateHistory: true });
      return;
    }

    var beforeNav = target.closest && target.closest('[data-sv-close-before-nav]');
    if (beforeNav) {
      close({ updateHistory: false });
      return;
    }

    var muteEl = target.closest && target.closest('[data-sv-mute]');
    if (muteEl) {
      event.preventDefault();
      state.muted = !state.muted;
      if (videoEl) videoEl.muted = state.muted;
      render();
      return;
    }

    if (target.closest && target.closest('[data-sv-prev]')) {
      event.preventDefault();
      previous();
      return;
    }

    if (target.closest && target.closest('[data-sv-next]')) {
      event.preventDefault();
      next();
      return;
    }

    var replyToggleEl = target.closest && target.closest('[data-sv-toggle-replies]');
    if (replyToggleEl) {
      event.preventDefault();
      toggleReplies(replyToggleEl.getAttribute('data-sv-toggle-replies'));
      return;
    }

    var toggleEl = target.closest && target.closest('[data-sv-toggle]');
    if (toggleEl) {
      event.preventDefault();
      var key = toggleEl.getAttribute('data-sv-toggle');
      var val = toggleEl.getAttribute('data-value') === '1';
      var body = {}; body[key] = val;
      updateLocalState(body);
      return;
    }

    var copyEl = target.closest && target.closest('[data-sv-copy]');
    if (copyEl) {
      event.preventDefault();
      var kind = copyEl.getAttribute('data-sv-copy');
      var text = kind === 'path' ? (state.video.full_path || state.video.file_path || '') : (state.video.prompt || '');
      if (navigator.clipboard && text) navigator.clipboard.writeText(text).catch(function () {});
      return;
    }

    if (target.closest && target.closest('[data-sv-open-folder]')) {
      event.preventDefault();
      fetch('/api/videos/' + encodeURIComponent(state.video.id) + '/folder', { method: 'POST' }).catch(function () {});
      return;
    }

    if (target.closest && target.closest('[data-sv-add-collection]')) {
      event.preventDefault();
      var sel = qs('[data-sv-collection-select]', overlay);
      if (sel && sel.value) addToCollection({ collectionId: sel.value });
      return;
    }

    if (target.closest && target.closest('[data-sv-create-collection]')) {
      event.preventDefault();
      var input = qs('[data-sv-new-collection]', overlay);
      if (input && input.value.trim()) addToCollection({ name: input.value.trim() });
      return;
    }

    var removeColEl = target.closest && target.closest('[data-sv-remove-collection]');
    if (removeColEl) {
      event.preventDefault();
      removeFromCollection(removeColEl.getAttribute('data-sv-remove-collection'));
      return;
    }

    var similarEl = target.closest && target.closest('[data-sv-similar-id]');
    if (similarEl) {
      event.preventDefault();
      var sid = similarEl.getAttribute('data-sv-similar-id');
      var si = findIndex(state.similar, sid);
      var sv = si >= 0 ? state.similar[si] : null;
      if (sv) openVideo(sv, [state.video].concat(state.similar), si + 1, { updateHistory: true });
      return;
    }

    var remixEl = target.closest && target.closest('[data-sv-remix-id]');
    if (remixEl) {
      event.preventDefault();
      var id = remixEl.getAttribute('data-sv-remix-id');
      var remixIndex = findIndex(state.remixes, id);
      var remix = remixIndex >= 0 ? state.remixes[remixIndex] : null;
      if (remix) openVideo(remix, [state.video].concat(state.remixes), remixIndex + 1, { updateHistory: true });
    }
  }


  function updateLocalState(body) {
    if (!state.video || !state.video.id) return;
    fetch('/api/videos/' + encodeURIComponent(state.video.id) + '/local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (payload && payload.video) {
          state.video = Object.assign({}, state.video, payload.video);
        if (Array.isArray(payload.similar)) state.similar = payload.similar;
          render();
        }
      }).catch(function () {});
  }

  function loadCollections() {
    var id = state.video && state.video.id;
    var url = id ? '/api/collections?video=' + encodeURIComponent(id) : '/api/collections';
    fetch(url).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        state.collections = payload && Array.isArray(payload.collections) ? payload.collections : [];
        state.collectionMemberships = payload && Array.isArray(payload.memberships) ? payload.memberships : [];
        render();
      })
      .catch(function () {});
  }

  function addToCollection(payload) {
    payload = Object.assign({}, payload, { videoId: state.video.id });
    fetch('/api/collections/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function () { loadCollections(); }).catch(function () {});
  }

  function removeFromCollection(collectionId) {
    if (!state.video || !collectionId) return;
    fetch('/api/collections/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collectionId: collectionId, videoId: state.video.id })
    }).then(function () { loadCollections(); }).catch(function () {});
  }

  function loadRemixes(id) {
    state.remixesForId = id;
    state.remixes = [];
    state.similar = [];
    state.remixesLoading = true;
    render();

    fetch('/api/videos/' + encodeURIComponent(id) + '/remixes')
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (json) {
        if (String(state.remixesForId) !== String(id)) return;
        state.remixes = Array.isArray(json) ? json : [];
      })
      .catch(function () {
        if (String(state.remixesForId) === String(id)) state.remixes = [];
      })
      .finally(function () {
        if (String(state.remixesForId) === String(id)) {
          state.remixesLoading = false;
          render();
        }
      });
  }

  function loadComments(id) {
    state.commentsForId = id;
    state.comments = [];
    state.commentReplies = {};
    state.commentsLoading = true;
    render();

    fetch('/api/videos/' + encodeURIComponent(id) + '/comments')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (String(state.commentsForId) !== String(id)) return;
        state.comments = (payload && Array.isArray(payload.comments)) ? payload.comments : [];
      })
      .catch(function () {
        if (String(state.commentsForId) === String(id)) state.comments = [];
      })
      .finally(function () {
        if (String(state.commentsForId) === String(id)) {
          state.commentsLoading = false;
          render();
        }
      });
  }

  function toggleReplies(commentId) {
    if (!commentId) return;
    if (!state.commentReplies[commentId]) {
      state.commentReplies[commentId] = { loading: false, loaded: false, expanded: false, replies: [] };
    }
    var entry = state.commentReplies[commentId];
    if (entry.loaded) {
      entry.expanded = !entry.expanded;
      render();
      return;
    }
    entry.expanded = true;
    entry.loading = true;
    render();

    fetch('/api/comments/' + encodeURIComponent(commentId) + '/replies')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        entry.replies = (payload && Array.isArray(payload.replies)) ? payload.replies : [];
        entry.loaded = true;
      })
      .catch(function () { entry.replies = []; entry.loaded = true; })
      .finally(function () { entry.loading = false; render(); });
  }

  function openVideo(video, videos, index, options) {
    options = options || {};
    if (!video || !video.id) return;
    state.lastFocus = document.activeElement;
    state.video = video;
    state.videos = Array.isArray(videos) && videos.length ? videos : [video];
    state.index = typeof index === 'number' ? index : findIndex(state.videos, video.id);
    if (state.index < 0) state.index = 0;
    state.open = true;
    state.remixes = [];
    state.similar = [];
    state.remixesLoading = false;
    state.comments = [];
    state.commentsLoading = false;
    state.commentsForId = null;
    state.commentReplies = {};
    state.collectionMemberships = [];
    var mobileMode = isMobileViewport();
    if (mobileMode) {
      // Mobile card grids use a self-contained vertical reel. Keep it off the
      // SvelteKit URL/router path so swiping cannot trigger page data reloads
      // or jump back to the originally tapped video.
      options.updateHistory = false;
      render();
      return;
    }

    render();
    loadCollections();
    loadRemixes(video.id);
    loadComments(video.id);
    if (options.updateHistory) setUrlVideo(video.id, options.replaceHistory ? 'replace' : 'push');
    if (options.hydrate !== false) {
      window.setTimeout(function () { hydrateVideoDetails(video.id); }, 0);
    }
  }

  function hydrateVideoDetails(id) {
    if (!id) return;
    fetch('/api/videos/' + encodeURIComponent(id))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (!payload || !payload.video) return;
        if (!state.open || !state.video || String(state.video.id) !== String(id)) return;
        state.video = Object.assign({}, state.video, payload.video);
        if (Array.isArray(payload.similar)) state.similar = payload.similar;
        if (Array.isArray(state.videos)) {
          state.videos = state.videos.map(function (v) {
            return String(v.id) === String(id) ? Object.assign({}, v, payload.video) : v;
          });
        }
        render();
      })
      .catch(function () {});
  }

  function openFromCard(card, options) {
    var video = parseVideoFromCard(card);
    if (!video) return false;
    var videos = videosFromCards();
    var index = findIndex(videos, video.id);
    options = options || { updateHistory: true };
    if (isMobileViewport()) options = Object.assign({}, options, { updateHistory: false });
    openVideo(video, videos, index, options);
    // openVideo hydrates full details after opening. Card payloads are intentionally
    // compact and may not include absolute file paths or newly indexed metadata.
    return true;
  }

  function openById(id, options) {
    var videos = videosFromCards();
    var index = findIndex(videos, id);
    if (index >= 0) {
      openVideo(videos[index], videos, index, options);
      return;
    }

    fetch('/api/videos/' + encodeURIComponent(id))
      .then(function (res) { if (!res.ok) throw new Error('not found'); return res.json(); })
      .then(function (payload) {
        if (!payload || !payload.video) return;
        openVideo(payload.video, [payload.video].concat(payload.remixes || []), 0, Object.assign({}, options || {}, { hydrate: false }));
        if (Array.isArray(payload.similar)) state.similar = payload.similar;
        if (Array.isArray(payload.remixes)) {
          state.remixes = payload.remixes;
          state.remixesLoading = false;
          state.remixesForId = payload.video.id;
          render();
        }
      })
      .catch(function () {});
  }

  function close(options) {
    options = options || {};
    if (videoEl) {
      try { videoEl.pause(); } catch (e) {}
      videoEl = null;
    }
    state.open = false;
    state.video = null;
    state.remixes = [];
    state.similar = [];
    state.remixesLoading = false;
    state.remixesForId = null;
    state.comments = [];
    state.commentsLoading = false;
    state.commentsForId = null;
    state.commentReplies = {};
    state.collectionMemberships = [];
    document.body.classList.remove('sora-lightbox-open');
    if (overlay) overlay.remove();
    overlay = null;
    if (options.updateHistory && hasVideoParam()) setUrlVideo(null, options.replaceHistory ? 'replace' : 'push');
    if (state.lastFocus && state.lastFocus.focus) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function previous() {
    if (state.index <= 0) return;
    var nextIndex = state.index - 1;
    openVideo(state.videos[nextIndex], state.videos, nextIndex, { updateHistory: true });
  }

  function next() {
    if (state.index < 0 || state.index >= state.videos.length - 1) return;
    var nextIndex = state.index + 1;
    openVideo(state.videos[nextIndex], state.videos, nextIndex, { updateHistory: true });
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var card = target && target.closest ? target.closest('[data-sora-video-card]') : null;
    if (!card) return;

    // Only hijack normal left-click/keyboard activation. Preserve open-in-new-tab,
    // copy-link, downloads, and other browser/native behaviors.
    if (event.defaultPrevented) return;
    if (event.button && event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    // Critical: SvelteKit also delegates clicks. Stop the click before it can
    // become a route navigation. Cards are buttons now, but this also protects
    // older cached markup or any fallback anchors.
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    openFromCard(card, { updateHistory: !isMobileViewport() });
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ updateHistory: true });
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    }
  });

  window.addEventListener('popstate', function () {
    var id = new URL(window.location.href).searchParams.get('video');
    if (id) openById(id, { updateHistory: false });
    else close({ updateHistory: false });
  });

  function bootFromUrl() {
    var id = new URL(window.location.href).searchParams.get('video');
    if (id) openById(id, { updateHistory: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootFromUrl);
  else bootFromUrl();

  window.SoraViewLightbox = {
    openById: openById,
    openFromCard: openFromCard,
    close: function () { close({ updateHistory: true }); }
  };
}());
