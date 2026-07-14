import { QuartzComponent, QuartzComponentConstructor } from "./types"

const ExplorerTooltip: QuartzComponent = () => {
  return <script>{`
document.addEventListener("readystatechange", () => {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    var feed = function() {
      var links = document.querySelectorAll(".explorer-content ul li > a, .explorer-content .folder-container div > button span");
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (!el.hasAttribute("title")) {
          el.setAttribute("title", el.textContent.trim());
        }
      }
    };
    feed();
    var obs = new MutationObserver(feed);
    var container = document.querySelector(".explorer-content") || document.body;
    obs.observe(container, { childList: true, subtree: true });
  }
});
  `.trim()}</script>
}

export default (() => ExplorerTooltip) satisfies QuartzComponentConstructor
