/* Shown in the login tab after OAuth succeeds: tell the tool tab, then close this one. */
(function () {
  'use strict';
  try { if (window.opener) window.opener.postMessage('dw-login-done', location.origin); } catch (e) { /* opener severed: the tool tab polls instead */ }
  setTimeout(function () { window.close(); }, 600);
})();
