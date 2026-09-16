/* Athena chart library — donut (part-to-whole)
 * ---------------------------------------------------------------------------
 * USE WHEN: a set of categories are shares of ONE whole and sum to ~100%
 * (channel mix, device split, share of reach). Do NOT use a donut for a
 * ranking of independent magnitudes — that is a bar (see bar.js).
 *
 * The builder guards its own fit: if the values do not sum to 90–110 it returns
 * false so the caller can fall back to bars. No in-slice numbers — at this ring
 * thickness they crowd the centre; the centre reports the leading share and the
 * legend carries the rest.
 *
 * data = {
 *   series: [{ name }],                      // one donut per series (>=1)
 *   rows:   [{ label, values:[num,...] }],   // one value per series, in order
 * }
 * opts = { palette:[hsl...], aria, helpers:h }   palette defaults to h.SHARE_HSL
 * Renders into `host` (a block element); writes a key into `legendNode` if given.
 * Requires host CSS: .donuts{display:flex;gap:24px;flex-wrap:wrap;justify-content:center}
 *                    .donut{display:flex;flex-direction:column;align-items:center;gap:6px}
 */
function donutChart(host, data, opts){
  opts = opts || {};
  var h = opts.helpers || chartHelpers();
  var PAL = opts.palette || h.SHARE_HSL;
  var rows = data.rows, series = (data.series && data.series.length) || 1;
  if (!rows || !rows.length) return false;

  var sums = [];
  for (var si = 0; si < series; si++){
    var t = 0, seen = 0;
    rows.forEach(function(r){ var v = Number(r.values[si]); if (isFinite(v)){ t += v; seen++; } });
    if (!seen) return false;
    sums.push(t);
  }
  // Part-to-whole only: bail if the values are not shares of 100.
  if (!sums.every(function(t){ return t >= 90 && t <= 110; })) return false;

  var arcPt = function(cx, cy, r, a){ return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  host.innerHTML = '';
  host.className = 'donuts';
  for (var s = 0; s < series; s++){
    var seg = (data.series && data.series[s]) || {}, total = sums[s];
    var R = 54, RI = 33, cx = 70, cy = 70, a = -Math.PI / 2;
    var svg = h.el('svg', { viewBox: '0 0 140 140', style: 'width:150px;height:150px', role: 'img' });
    var parts = rows.map(function(r){ return r.label + ' ' + h.pct(Number(r.values[s]) || 0); }).join(', ');
    svg.setAttribute('aria-label', (opts.aria || 'Distribution') +
      (series > 1 ? ' — ' + (seg.name || '') : '') + ': ' + parts);
    var lead = null;
    rows.forEach(function(r, ri){
      var v = Number(r.values[s]);
      if (!isFinite(v) || v <= 0) return;
      if (!lead || v > lead.v) lead = { v: v, label: r.label };
      var sweep = (v / total) * Math.PI * 2, a2 = a + sweep;
      var large = sweep > Math.PI ? 1 : 0;
      var o0 = arcPt(cx, cy, R, a), o1 = arcPt(cx, cy, R, a2);
      var i1 = arcPt(cx, cy, RI, a2), i0 = arcPt(cx, cy, RI, a);
      svg.appendChild(h.el('path', {
        d: 'M' + o0[0] + ' ' + o0[1] + 'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + o1[0] + ' ' + o1[1] +
           'L' + i1[0] + ' ' + i1[1] + 'A' + RI + ' ' + RI + ' 0 ' + large + ' 0 ' + i0[0] + ' ' + i0[1] + 'Z',
        fill: 'hsl(' + PAL[ri % PAL.length] + ')'
      }));
      a = a2;
    });
    if (lead){
      svg.appendChild(h.el('text', { x: cx, y: cy - 6, 'text-anchor': 'middle',
        'dominant-baseline': 'middle', 'font-size': 17, 'font-weight': 700,
        fill: h.hsl('--foreground'), style: 'font-variant-numeric:tabular-nums' }, h.pct(lead.v)));
      svg.appendChild(h.el('text', { x: cx, y: cy + 12, 'text-anchor': 'middle',
        'dominant-baseline': 'middle', 'font-size': 10, 'font-weight': 600,
        fill: h.hsl('--muted-foreground') }, h.fit(lead.label, 14)));
    }
    var wrap = document.createElement('div');
    wrap.className = 'donut';
    wrap.appendChild(svg);
    if (series > 1 && seg.name){
      var nm = document.createElement('span'); nm.textContent = seg.name;
      nm.style.cssText = 'font-size:12px;font-weight:600'; wrap.appendChild(nm);
    }
    host.appendChild(wrap);
  }
  if (opts.legendNode){
    opts.legendNode.innerHTML = rows.map(function(r, ri){
      var v = Number(r.values[0]);
      var val = (series === 1 && isFinite(v)) ? ' ' + h.pct(v) : '';
      return '<span><i class="swatch" style="background:hsl(' + PAL[ri % PAL.length] + ')"></i>' + r.label + val + '</span>';
    }).join('');
  }
  return true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { donutChart: donutChart };
