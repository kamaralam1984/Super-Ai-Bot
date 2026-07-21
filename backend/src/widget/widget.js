/*
 * KVL Super AI Chatbot — embeddable widget loader.
 *
 * Dropped onto a client's website as:
 *   <script src="https://<this-server>/widget.js"></script>
 * Optional attributes: data-position ("bottom-right" | "bottom-left"),
 * data-color (any CSS color, defaults to the product's amber accent),
 * data-greeting (overrides the default first bot message).
 *
 * Deliberately dependency-free vanilla JS (no bundler, no framework) —
 * this file is served byte-for-byte to arbitrary third-party sites, so it
 * has to work standalone with zero build step and zero risk of colliding
 * with whatever the host page already loaded. All actual chat logic lives
 * in the isolated same-origin iframe at /widget (widget.html), not here —
 * this file only ever injects a launcher button and toggles that iframe.
 */
(function () {
  "use strict";
  if (window.__kvlWidgetLoaded) return;
  window.__kvlWidgetLoaded = true;

  var scriptEl =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();
  var origin = new URL(scriptEl.src, window.location.href).origin;
  var position = (scriptEl.getAttribute("data-position") || "bottom-right").toLowerCase();
  var color = scriptEl.getAttribute("data-color") || "#e8a838";
  var greeting = scriptEl.getAttribute("data-greeting") || "";
  var isLeft = position.indexOf("left") !== -1;
  var side = isLeft ? "left" : "right";

  var LAUNCHER_SIZE = 60;
  var PANEL_WIDTH = 380;
  var PANEL_HEIGHT = 620;
  var MARGIN = 20;
  var Z_INDEX = 2147483000;

  var style = document.createElement("style");
  style.textContent =
    "#kvl-widget-launcher{position:fixed;" + side + ":" + MARGIN + "px;bottom:" + MARGIN + "px;" +
    "width:" + LAUNCHER_SIZE + "px;height:" + LAUNCHER_SIZE + "px;border-radius:50%;background:" + color + ";" +
    "box-shadow:0 4px 18px rgba(0,0,0,.25);cursor:pointer;z-index:" + Z_INDEX + ";border:none;" +
    "display:flex;align-items:center;justify-content:center;transition:transform .15s ease;padding:0;}" +
    "#kvl-widget-launcher:hover{transform:scale(1.06);}" +
    "#kvl-widget-launcher svg{width:26px;height:26px;fill:#fff;}" +
    "#kvl-widget-frame-wrap{position:fixed;" + side + ":" + MARGIN + "px;bottom:" + (MARGIN + LAUNCHER_SIZE + 12) + "px;" +
    "width:" + PANEL_WIDTH + "px;height:" + PANEL_HEIGHT + "px;max-width:calc(100vw - " + MARGIN * 2 + "px);" +
    "max-height:calc(100vh - " + (MARGIN * 2 + LAUNCHER_SIZE + 12) + "px);border-radius:16px;overflow:hidden;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:" + Z_INDEX + ";display:none;background:#fff;}" +
    "#kvl-widget-frame-wrap.kvl-open{display:block;}" +
    "#kvl-widget-frame-wrap iframe{width:100%;height:100%;border:0;display:block;}" +
    "@media (max-width:480px){#kvl-widget-frame-wrap{width:100vw;height:100vh;max-width:100vw;" +
    "max-height:100vh;right:0;left:0;bottom:0;border-radius:0;}}";
  document.head.appendChild(style);

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.03 2 11c0 2.4 1.05 4.57 2.77 6.17-.13 1.28-.5 2.63-1.4 3.83 1.6-.14 3.24-.62 4.62-1.4C9.16 19.87 10.55 20 12 20c5.52 0 10-4.03 10-9s-4.48-9-10-9z"/></svg>';
  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.29-6.3-1.42 1.42 6.3 6.29-6.3 6.29 1.42 1.42 6.29-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.29z"/></svg>';

  var launcher = document.createElement("button");
  launcher.id = "kvl-widget-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.innerHTML = CHAT_ICON;
  document.body.appendChild(launcher);

  var frameWrap = document.createElement("div");
  frameWrap.id = "kvl-widget-frame-wrap";
  document.body.appendChild(frameWrap);

  var isOpen = false;
  var iframeCreated = false;

  function setOpen(next) {
    isOpen = next;
    launcher.innerHTML = isOpen ? CLOSE_ICON : CHAT_ICON;
    launcher.setAttribute("aria-label", isOpen ? "Close chat" : "Open chat");
    frameWrap.classList.toggle("kvl-open", isOpen);
    if (isOpen && !iframeCreated) {
      iframeCreated = true;
      var iframe = document.createElement("iframe");
      var params = new URLSearchParams();
      params.set("color", color);
      if (greeting) params.set("greeting", greeting);
      iframe.src = origin + "/widget?" + params.toString();
      iframe.title = "Chat";
      iframe.setAttribute("allow", "clipboard-write");
      frameWrap.appendChild(iframe);
    }
  }

  launcher.addEventListener("click", function () {
    setOpen(!isOpen);
  });

  // Lets the chat page's own in-panel close button (widget.html) close the
  // launcher from inside the iframe, without needing any cross-origin API
  // beyond postMessage.
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "kvl-widget-close") {
      setOpen(false);
    }
  });
})();
