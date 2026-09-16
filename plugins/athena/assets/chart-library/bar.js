/* Athena chart library — horizontal bar (ranked magnitudes)
 * ---------------------------------------------------------------------------
 * USE WHEN: many labels are compared against each other by magnitude
 * (customers by market, reach by channel, over-index by interest). Sort the
 * data before calling — the builder draws rows top-to-bottom as given.
 *
 * data = [{ label, v }]                       already sorted, largest first
 * opts = { svg, aria, valueFmt, color, helpers:h, emptyText }
 *   valueFmt(v) -> string  (defaults to h.fmt); color defaults to --primary.
 * Renders into the provided `svg` element (an empty <svg> in the page).
 *
 * For a value measured AGAINST a network baseline (relative over/under-index)
 * use `baselineBars` below, not this one.
 */
function barChart(svg, data, opts){
  opts = opts || {};
  var h = opts.helpers || chartHelpers();
  if (!data || !data.length){
    if (opts.emptyText && svg.parentNode) svg.parentNode.textContent = opts.emptyText;
    return;
  }
  var valueFmt = opts.valueFmt || h.fmt;
  var LABEL_W = 210, AREA_W = 470, ROW_H = 32, BAR_H = 18, TOP = 8, PAD = 90;
  var w = LABEL_W + AREA_W + PAD, h2 = TOP + data.length * ROW_H + 8;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h2);
  svg.setAttribute('style', 'max-width:' + w + 'px');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.aria || 'Ranked bar chart, largest first');

  var max = Math.max.apply(null, data.map(function(x){ return Math.abs(Number(x.v)) || 0; })) || 1;
  var muted = h.hsl('--muted-foreground');
  var color = opts.color || h.hsl('--primary');
  data.forEach(function(row, i){
    var cy = TOP + i * ROW_H + ROW_H / 2;
    var len = Math.max(2, (Math.abs(Number(row.v)) || 0) / max * AREA_W);
    var t = h.el('text', { x: LABEL_W - 14, y: cy, 'text-anchor': 'end',
      'dominant-baseline': 'middle', 'font-size': 12, fill: muted }, h.fit(row.label, 26));
    t.appendChild(h.el('title', {}, row.label));
    svg.appendChild(t);
    svg.appendChild(h.el('rect', { x: LABEL_W, y: cy - BAR_H / 2, width: len, height: BAR_H,
      rx: 3, fill: (typeof color === 'function' ? color(row) : color) }));
    svg.appendChild(h.el('text', { x: LABEL_W + len + 10, y: cy, 'dominant-baseline': 'middle',
      'font-size': 12, 'font-weight': 600, fill: muted,
      style: 'font-variant-numeric:tabular-nums' }, valueFmt(row.v)));
  });
}

/* Athena chart library — baseline bar (relative over/under-index)
 * ---------------------------------------------------------------------------
 * USE WHEN: each value is a RELATIVE DIFFERENCE from a network baseline
 * (over-index by brand, by interest, by platform). A vertical dotted line marks
 * the baseline (0%); bars extend RIGHT when above it and LEFT when below it, so
 * a below-baseline value is drawn honestly instead of falling off the axis.
 *
 * This replaces the older "baseline on the y-axis" design: with the baseline as
 * the left edge, any negative value had nowhere to go. Here the zero line floats
 * to wherever the data needs it.
 *
 * data = [{ label, v, color }]   v = signed % difference from baseline; already
 *                                sorted (largest first reads top-to-bottom).
 * opts = { svg, aria, helpers:h, baselineLabel, color, emptyText }
 *   color: a string, or fn(row)->hsl string (screenshot colours bars by category).
 * The disclaimer ("Percentages shown inside the bars represent relative
 * differences from the Network Baseline") belongs in the section caption, not here.
 */
function baselineBars(svg, data, opts){
  opts = opts || {};
  var h = opts.helpers || chartHelpers();
  if (!data || !data.length){
    if (opts.emptyText && svg.parentNode) svg.parentNode.textContent = opts.emptyText;
    return;
  }
  // Keep malformed or unexpectedly unbounded payloads from creating an enormous SVG in
  // embedded Chromium hosts. Customer Pulse intentionally charts at most 20 ranked rows.
  data = data.slice(0, 20);
  var LABEL_W = 150, AREA_W = 560, ROW_H = 30, BAR_H = 18, TOP = 26, PAD = 16;
  var w = LABEL_W + AREA_W + PAD, hh = TOP + data.length * ROW_H + 10;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh);
  svg.setAttribute('style', 'max-width:' + w + 'px');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.aria || 'Relative difference from network baseline');

  // Domain spans zero so above- and below-baseline values share one scale.
  var vals = data.map(function(x){ return Number(x.v) || 0; });
  var lo = Math.min(0, Math.min.apply(null, vals));
  var hi = Math.max(0, Math.max.apply(null, vals));
  var span = (hi - lo) || 1;
  var pad = span * 0.08;
  var min = lo - (lo < 0 ? pad : 0), max = hi + (hi > 0 ? pad : 0);
  // An all-zero series has no natural extent. Give it a small symmetric domain instead of
  // dividing by zero and emitting NaN SVG coordinates, which can crash embedded renderers.
  if (min === max){ min = -1; max = 1; }
  var x = function(v){ return LABEL_W + (v - min) / (max - min) * AREA_W; };
  var zeroX = x(0);
  var muted = h.hsl('--muted-foreground'), ink = h.hsl('--foreground');
  var defColor = h.hsl('--primary');

  // Baseline: dotted vertical line the full height, labelled at the top.
  svg.appendChild(h.el('line', { x1: zeroX, y1: TOP - 8, x2: zeroX, y2: hh - 6,
    stroke: muted, 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  var baselineAtRight = zeroX > w - 72, baselineAtLeft = zeroX < 72;
  svg.appendChild(h.el('text', {
    x: baselineAtRight ? zeroX - 5 : (baselineAtLeft ? zeroX + 5 : zeroX),
    y: TOP - 14,
    'text-anchor': baselineAtRight ? 'end' : (baselineAtLeft ? 'start' : 'middle'),
    'font-size': 11, 'font-weight': 600, fill: muted
  }, opts.baselineLabel || 'Network Baseline'));

  data.forEach(function(row, i){
    var v = Number(row.v) || 0, cy = TOP + i * ROW_H + ROW_H / 2;
    var xv = x(v), left = Math.min(zeroX, xv), width = Math.max(2, Math.abs(xv - zeroX));
    var col = row.color || (typeof opts.color === 'function' ? opts.color(row) : opts.color) || defColor;
    var t = h.el('text', { x: LABEL_W - 12, y: cy, 'text-anchor': 'end', 'dominant-baseline': 'middle',
      'font-size': 12, fill: muted }, h.fit(row.label, 20));
    t.appendChild(h.el('title', {}, row.label));
    svg.appendChild(t);
    svg.appendChild(h.el('rect', { x: left, y: cy - BAR_H / 2, width: width, height: BAR_H, rx: 3, fill: col }));
    // Signed % label: inside the bar end when it fits, just outside when the bar is short.
    var lbl = (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + '%';
    var inside = width > 42;
    svg.appendChild(h.el('text', {
      x: v >= 0 ? (inside ? xv - 6 : xv + 6) : (inside ? xv + 6 : xv - 6),
      y: cy, 'dominant-baseline': 'middle', 'text-anchor': v >= 0 ? (inside ? 'end' : 'start') : (inside ? 'start' : 'end'),
      'font-size': 11, 'font-weight': 600, fill: inside ? '#fff' : ink,
      style: 'font-variant-numeric:tabular-nums' }, lbl));
  });
}

/* Comparison companion for baselineBars. Each row carries `values[]`, in the
 * same order as `opts.segments`; every supplied series is rendered beside the
 * shared zero line. Use this instead of silently selecting values[0]. */
function groupedBaselineBars(svg, rows, opts){
  opts = opts || {};
  var h = opts.helpers || chartHelpers();
  if (!rows || !rows.length) { if (opts.emptyText && svg.parentNode) svg.parentNode.textContent = opts.emptyText; return; }
  var series = Math.max(1, (opts.segments || []).length);
  rows = rows.slice(0, 20);
  var vals = [];
  rows.forEach(function(r){ for (var si = 0; si < series; si++) vals.push(Number((r.values || [])[si]) || 0); });
  var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
  var span = (hi - lo) || 1, pad = span * 0.08, min = lo - (lo < 0 ? pad : 0), max = hi + (hi > 0 ? pad : 0);
  if (min === max) { min = -1; max = 1; }
  var LABEL_W = 170, AREA_W = 470, ROW_H = 30 + (series - 1) * 10, BAR_H = 9, TOP = 38, PAD = 16;
  var w = LABEL_W + AREA_W + PAD, hh = TOP + rows.length * ROW_H + 10;
  var x = function(v){ return LABEL_W + (v - min) / (max - min) * AREA_W; }, zeroX = x(0);
  var muted = h.hsl('--muted-foreground'), ink = h.hsl('--foreground');
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh); svg.setAttribute('style', 'max-width:' + w + 'px');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', opts.aria || 'Relative difference from network baseline');
  svg.appendChild(h.el('line', {x1:zeroX,y1:TOP-8,x2:zeroX,y2:hh-6,stroke:muted,'stroke-width':1,'stroke-dasharray':'3 3'}));
  svg.appendChild(h.el('text', {x:zeroX,y:TOP-22,'text-anchor':'middle','font-size':11,'font-weight':600,fill:muted}, opts.baselineLabel || 'Network Baseline'));
  rows.forEach(function(row, ri){
    var cy = TOP + ri * ROW_H + ROW_H / 2;
    var t = h.el('text', {x:LABEL_W-12,y:cy,'text-anchor':'end','dominant-baseline':'middle','font-size':12,fill:muted}, h.fit(row.label, 20)); t.appendChild(h.el('title', {}, row.label)); svg.appendChild(t);
    for (var si = 0; si < series; si++) { var v = Number((row.values || [])[si]); if (!isFinite(v)) continue; var xv = x(v), width = Math.max(2, Math.abs(xv-zeroX)), inside = width > 42, gap = (si-(series-1)/2)*10;
      svg.appendChild(h.el('rect',{x:Math.min(zeroX,xv),y:cy-BAR_H/2+gap,width:width,height:BAR_H,rx:2,fill:opts.color ? opts.color(si) : h.hsl('--primary')}));
      svg.appendChild(h.el('text',{x:v>=0?(inside?xv-6:xv+6):(inside?xv+6:xv-6),y:cy+gap,'dominant-baseline':'middle','text-anchor':v>=0?(inside?'end':'start'):(inside?'start':'end'),'font-size':10,'font-weight':600,fill:inside?'#fff':ink},(v>0?'+':'')+(Math.round(v*10)/10)+'%'));
    }
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { barChart: barChart, baselineBars: baselineBars, groupedBaselineBars: groupedBaselineBars };
