import { QuartzComponent, QuartzComponentConstructor } from "./types"

const ExplorerTooltip: QuartzComponent = () => {
  return <script dangerouslySetInnerHTML={{
    __html: `
(function() {
  function setTitles() {
    var links = document.querySelectorAll(".explorer-content ul li > a");
    for (var i = 0; i < links.length; i++) {
      var el = links[i];
      if (!el.hasAttribute("title") && el.textContent) {
        el.setAttribute("title", el.textContent.trim());
      }
    }
    var spans = document.querySelectorAll(".explorer-content .folder-container div > button span");
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      if (!el.hasAttribute("title") && el.textContent) {
        el.setAttribute("title", el.textContent.trim());
      }
    }
  }
  var attempts = 0;
  function poll() {
    setTitles();
    var count = document.querySelectorAll(".explorer-content ul li > a").length;
    if (count === 0 && attempts < 30) {
      attempts++;
      setTimeout(poll, 200);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", poll);
  } else {
    poll();
  }
})();
    `.trim()
  }} />
}

export default (() => ExplorerTooltip) satisfies QuartzComponentConstructor
