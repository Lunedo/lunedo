window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;
window.NOTIFICATIONS_URL = null;
window.RT_WEBSOCKET_URL = null;
window.REALTIME_URL = null;
window.PROXY_URL = null;
window.SAVE_URL = null;
window.OPEN_URL = null;

(() => {
  const GLIFFY = /"contentType"\s*:\s*"application\/gliffy\+json"/;
  const loader = {};

  function reply(message) {
    window.parent.postMessage(JSON.stringify(message), "*");
  }

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window.parent || typeof event.data !== "string" || event.lunedoConverted) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.action !== "load" || typeof message.xml !== "string" || !GLIFFY.test(message.xml)) return;
      event.stopImmediatePropagation();
      EditorUi.prototype.loadGliffy.call(
        loader,
        () => {
          let xml = null;
          try {
            xml = mxGliffyToDrawio.convert(message.xml);
          } catch {
            xml = null;
          }
          if (!xml) {
            reply({ event: "lunedo-gliffy-failed" });
            return;
          }
          const converted = new MessageEvent("message", {
            data: JSON.stringify({ ...message, xml }),
            origin: event.origin,
            source: window.parent,
          });
          converted.lunedoConverted = true;
          window.dispatchEvent(converted);
          reply({ event: "lunedo-gliffy-converted" });
        },
        () => reply({ event: "lunedo-gliffy-failed" }),
      );
    },
    true,
  );
})();
