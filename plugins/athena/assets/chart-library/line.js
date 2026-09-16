/* Athena chart library — area / line (time series)
 * ---------------------------------------------------------------------------
 * USE WHEN: a single measure moves over time (a metric by day/week). The axis
 * is scaled to the OBSERVED range, not anchored at zero, so day-to-day movement
 * stays visible. Missing points are left as gaps, never plotted as zero.
 *
 * data = {
 *   points: [{ t, v }],            // t = label seed (date), v = value (null = gap)
 *   unit:   'rate' | 'count' | ... // controls axis/value formatting
 *   aria:   'Metric by day'
 * }
 * opts = { svg, valueFmt(v,unit), axisFmt(v,unit), labelFmt(t), color, helpers:h }
 *   color defaults to --ramp-2 (the mid ramp). The fill is the same ink at .14.
 *   Returns the count of gap points so the caller can annotate a caption.
 */
function areaLineChart(data, opts){
  opts = opts || {};
  var h = opts.helpers || chartHelpers();
  var svg = opts.svg;
  var points = data.points || [];
  var unit = data.unit;
  var valueFmt = opts.valueFmt || function(v){ return h.fmt(v); };
  var axisFmt  = opts.axisFmt || function(v){ return unit === 'rate' ? (Math.round(v * 10) / 10) + '%' : h.fmt(v); };
  var labelFmt = opts.labelFmt || function(t){ return String(t); };
  var scale = opts.scale || function(v){ return v == null ? null : Number(v); };

  var L = 52, R = 20, T = 22, B = 42, PW = 820, PH = 260;
  var w = L + PW + R, hh = T + PH + B, n = points.length;
  svg.textContent = '';
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh);
  svg.setAttribute('style', 'max-width:' + w + 'px');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', data.aria || 'Metric over time');

  var muted = h.hsl('--muted-foreground'), border = h.hsl('--border');
  var ink = opts.color || h.hsl('--ramp-2');
  var vals = points.map(function(p){ return scale(p.v, unit); });
  var known = vals.filter(function(v){ return v != null; });
  if (!known.length){ return 0; }
  var lo = Math.min.apply(null, known), hi = Math.max.apply(null, known);
  var pad = (hi - lo) * 0.15 || (Math.abs(hi) * 0.1) || 1;
  var min = lo - pad, max = hi + pad;
  var x = function(i){ return n < 2 ? L + PW / 2 : L + i * PW / (n - 1); };
  var y = function(v){ return T + (1 - (v - min) / (max - min)) * PH; };

  for (var g = 0; g <= 4; g++){
    var gy = T + g * PH / 4, gv = max - g * (max - min) / 4;
    svg.appendChild(h.el('line', { x1: L, y1: gy, x2: L + PW, y2: gy, stroke: border }));
    svg.appendChild(h.el('text', { x: L - 10, y: gy + 4, 'text-anchor': 'end', 'font-size': 11,
      fill: muted, style: 'font-variant-numeric:tabular-nums' }, axisFmt(gv, unit)));
  }

  // Split into contiguous runs of known values so gaps stay gaps.
  var runs = [], run = [];
  vals.forEach(function(v, i){ if (v == null){ if (run.length) runs.push(run); run = []; } else run.push({ i: i, v: v }); });
  if (run.length) runs.push(run);
  runs.forEach(function(r){
    if (r.length > 1){
      var d = r.map(function(p, k){ return (k ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
      svg.appendChild(h.el('path', { d: d + ' L' + x(r[r.length - 1].i).toFixed(1) + ' ' + (T + PH) +
        ' L' + x(r[0].i).toFixed(1) + ' ' + (T + PH) + ' Z', fill: ink, 'fill-opacity': '.14' }));
      svg.appendChild(h.el('path', { d: d, fill: 'none', stroke: ink, 'stroke-width': 2.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
  });

  var step = Math.max(1, Math.ceil(n / 10));
  points.forEach(function(p, i){
    if (i % step === 0){
      svg.appendChild(h.el('text', { x: x(i), y: T + PH + 20, 'text-anchor': 'middle',
        'font-size': 11, fill: muted }, labelFmt(p.t)));
    }
    var v = vals[i];
    if (v == null) return;
    var c = h.el('circle', { cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: 3.5, fill: ink });
    c.appendChild(h.el('title', {}, labelFmt(p.t) + ': ' + valueFmt(p.v, unit)));
    svg.appendChild(c);
  });

  return vals.filter(function(v){ return v == null; }).length;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { areaLineChart: areaLineChart };
