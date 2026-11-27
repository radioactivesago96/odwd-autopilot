'use strict';
// The built-in browser may only open the diary site, plus the style and script hosts it uses.
const SITE = 'misocc-hrmis.net';
const ASSET_HOSTS = new Set([
  'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'code.jquery.com', 'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com',
  'cdn.datatables.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com', 'ajax.googleapis.com'
]);
const ASSET_TYPES = new Set(['stylesheet', 'script', 'font', 'image']);

function isAllowed({ url, resourceType }, siteHost = SITE) {
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    return false;
  }
  const isFrame = resourceType === 'mainFrame' || resourceType === 'subFrame';
  if (target.protocol === 'data:' || target.protocol === 'blob:') return !isFrame;
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (target.hostname === siteHost || target.hostname.endsWith('.' + siteHost)) return true;
  return ASSET_TYPES.has(resourceType) && ASSET_HOSTS.has(target.hostname);
}

module.exports = { isAllowed, SITE };
