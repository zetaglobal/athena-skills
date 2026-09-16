/* Athena chart library — shared helpers
 * ---------------------------------------------------------------------------
 * These are the primitives every Athena briefing chart is built from. They are
 * intentionally dependency-free (no D3, no Recharts) so a chart can be pasted
 * into a single self-contained HTML deliverable that prints and renders offline.
 *
 * Copy `chartHelpers()` (or its members) into a template's inline <script>, then
 * copy the builder you need from donut.js / bar.js / line.js. The builders take
 * a `h` (helpers) object so the same source stays in sync across templates.
 *
 * Token contract — the host page MUST define these CSS custom properties (the
 * Athena templates already do, in both light and `.dark` / prefers-dark forms):
 *   --foreground, --muted-foreground, --border, --primary
 *   --ramp-1, --ramp-2, --ramp-3   (sequential ramp; lightness falls across it
 *                                    so series survive greyscale + colour-blind)
 * Categorical series use the SHARE palette below (part-to-whole) or SEG palette
 * (one audience vs another). Both are HSL triplets, consumed as `hsl(<triplet>)`.
 */
function chartHelpers(){
  var NS = 'http://www.w3.org/2000/svg';
  // Read a CSS custom property off :root and wrap it as an hsl() colour.
  var css = function(name){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
  return {
    NS: NS,
    // Categorical palettes (HSL triplets). SHARE = shares of one whole; SEG =
    // one audience compared against another.
    SHARE_HSL: ['221 83% 53%', '174 62% 33%', '262 60% 55%', '215 16% 47%'],
    SEG_HSL:   ['221 83% 53%', '32 95% 44%', '262 83% 58%', '174 72% 34%'],
    // Create an SVG element with attributes + optional text.
    el: function(tag, attrs, text){
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      return n;
    },
    // hsl('--muted-foreground') -> 'hsl(215 16% 47%)'
    hsl: function(name){ return 'hsl(' + css(name) + ')'; },
    // Number formatting used on axes and value labels.
    fmt: function(n){ return Number(n).toLocaleString('en-US'); },
    pct: function(n){ return (Math.round(Number(n) * 10) / 10) + '%'; },
    // Truncate a label to `max` chars with an ellipsis, trimming trailing punctuation.
    fit: function(s, max){ return s.length <= max ? s : s.slice(0, max - 1).replace(/[\s,\-]+$/, '') + '…'; }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { chartHelpers: chartHelpers };
