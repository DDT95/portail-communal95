(function () {
  const opener = window.opener;
  const app = opener && opener.pcApp;
  if (!app) {
    document.body.innerHTML = '<p style="padding:40px;font:16px Marianne,Arial,sans-serif">Cette page s’ouvre depuis le bouton d’export de la fiche communale.</p>';
    return;
  }
  const { state, MOS_LABELS, mosColor, PUBLIC_LAND_COLORS, escapeHtml, formatNumber } = app;
  const mode = new URLSearchParams(location.search).get('mode') === 'fiche' ? 'fiche' : 'carte';
  const statusEl = document.getElementById('pdfStatus');
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('printPage').hidden = mode !== 'carte';
  document.getElementById('dataPage').hidden = mode !== 'fiche';

  // ---------- Carte DDT (page A3) ----------
  function buildCarte() {
    const activeDefs = (state.layerDefs || []).filter(d => d.active);
    const vectorDefs = activeDefs.filter(d => d.kind !== 'wms' && d.kind !== 'raster');
    const skippedDefs = activeDefs.filter(d => d.kind === 'wms' || d.kind === 'raster');

    document.getElementById('printTitle').textContent = state.nom || 'Commune';
    document.getElementById('printSubtitle').textContent = `Fiche territoriale · code INSEE ${state.code || ''}`;
    document.getElementById('printSources').innerHTML = `
      <span class="src-line">Sources : DDT 95 · IGN · Île-de-France Mobilités · Géorisques</span>
      <span class="src-line">Auteur : DDT 95 - Pôle géomatique</span>
      <span class="src-line">Date : ${today}</span>
    `;
    document.getElementById('printLegend').innerHTML = vectorDefs.length
      ? vectorDefs.map(d => `<div class="legend-block"><span><i style="background:${d.color}"></i>${escapeHtml(d.label)}</span></div>`).join('')
        + (skippedDefs.length ? `<div class="legend-block"><strong>Non capturées (fond raster)</strong>${skippedDefs.map(d => `<span>${escapeHtml(d.label)}</span>`).join('')}</div>` : '')
      : '<div class="legend-empty">Aucune couche affichée</div>';

    const map = L.map('printMapCanvas', {
      zoomControl: false, attributionControl: false, preferCanvas: true,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false
    });
    map.createPane('maskPane'); map.getPane('maskPane').style.zIndex = 420; map.getPane('maskPane').style.pointerEvents = 'none';
    map.createPane('boundaryPane'); map.getPane('boundaryPane').style.zIndex = 430; map.getPane('boundaryPane').style.pointerEvents = 'none';

    const NeutralTileLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x; tile.height = size.y;
        const ctx = tile.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, 0, 0, size.x, size.y);
          const data = ctx.getImageData(0, 0, size.x, size.y);
          const d = data.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const gray1 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let r2 = r + (gray1 - r) * 0.85, g2 = g + (gray1 - g) * 0.85, b2 = b + (gray1 - b) * 0.85;
            const gray2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
            r2 = gray2 + (r2 - gray2) * 0.35; g2 = gray2 + (g2 - gray2) * 0.35; b2 = gray2 + (b2 - gray2) * 0.35;
            d[i] = Math.min(255, r2 * 1.06); d[i + 1] = Math.min(255, g2 * 1.06); d[i + 2] = Math.min(255, b2 * 1.06);
          }
          ctx.putImageData(data, 0, 0);
          done(null, tile);
        };
        img.onerror = e => done(e, tile);
        img.src = this.getTileUrl(coords);
        return tile;
      }
    });
    new NeutralTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    vectorDefs.forEach(def => {
      const liveLayer = state.layers?.[def.id];
      if (!liveLayer || typeof liveLayer.toGeoJSON !== 'function') return;
      let data;
      try { data = liveLayer.toGeoJSON(); } catch { return; }
      if (!data || !(data.features || []).length) return;
      if (def.id === 'mos') {
        L.geoJSON(data, { style: f => { const c = mosColor(f.properties?.mos2025); return { color: c, weight: 0.4, opacity: 0.5, fillColor: c, fillOpacity: 0.6 }; } }).addTo(map);
      } else if (def.id === 'foncierPublic') {
        L.geoJSON(data, { style: f => { const c = PUBLIC_LAND_COLORS[f.properties?.info0] || def.color; return { color: c, weight: 1.5, opacity: 1, fillColor: c, fillOpacity: 0.5 }; } }).addTo(map);
      } else {
        L.geoJSON(data, {
          style: { color: def.color, weight: 1.5, opacity: 0.9, fillColor: def.color, fillOpacity: 0.35 },
          pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1.5, fillColor: def.color, fillOpacity: 1 })
        }).addTo(map);
      }
    });

    let territoryLayer = null;
    if (state.contour) {
      const g = state.contour;
      const holes = g.type === 'Polygon' ? [g.coordinates[0]] : (g.coordinates || []).map(p => p[0]);
      L.geoJSON({
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] }
      }, { pane: 'maskPane', interactive: false, style: { stroke: false, fillColor: '#ffffff', fillOpacity: 1, fillRule: 'evenodd' } }).addTo(map);
      territoryLayer = L.geoJSON(state.contour, { pane: 'boundaryPane', interactive: false, style: { color: '#000091', weight: 2, opacity: 0.9, fillOpacity: 0 } }).addTo(map);
    }

    map.invalidateSize();
    if (territoryLayer) map.fitBounds(territoryLayer.getBounds(), { padding: [24, 24] });

    function niceScaleNumber(n) {
      const pow10 = Math.pow(10, String(Math.floor(n)).length - 1);
      const d = n / pow10;
      return pow10 * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1);
    }
    function renderScaleBar() {
      const targetPx = 160;
      const size = map.getSize();
      const y = size.y / 2;
      const maxMeters = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([targetPx, y]));
      const meters = niceScaleNumber(maxMeters);
      const fullPx = targetPx * (meters / maxMeters);
      const segments = 4;
      const segPx = fullPx / segments;
      const unit = meters >= 1000 ? meters / 1000 : meters;
      const unitLabel = meters >= 1000 ? 'km' : 'm';
      const bars = Array.from({ length: segments }).map((_, i) => `<div class="scale-seg ${i % 2 === 0 ? 'on' : 'off'}" style="width:${segPx}px"></div>`).join('');
      const ticks = Array.from({ length: segments + 1 }).map((_, i) => `<span style="left:${i * segPx}px">${((unit / segments) * i).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span>`).join('');
      document.getElementById('printScale').innerHTML = `<div class="scale-frame" style="width:${fullPx}px"><div class="scale-bar-row">${bars}</div><div class="scale-ticks" style="width:${fullPx}px">${ticks}<span class="scale-unit" style="left:${fullPx}px">${unitLabel}</span></div></div>`;
    }

    return new Promise(resolve => {
      map.whenReady(() => setTimeout(() => {
        map.invalidateSize();
        if (territoryLayer) map.fitBounds(territoryLayer.getBounds(), { padding: [24, 24] });
        renderScaleBar();
        setTimeout(resolve, 700);
      }, 600));
    });
  }

  // ---------- Fiche communale (page(s) A4) ----------
  function buildFiche() {
    document.getElementById('dataTitle').textContent = state.nom || 'Commune';
    document.getElementById('dataBody').innerHTML = opener.document.getElementById('drawer-body').innerHTML;
    if (app.octeUrl) {
      const octeBlock = document.createElement('div');
      octeBlock.className = 'data-octe';
      octeBlock.innerHTML = `<strong>Fiche officielle complète (OCTE)</strong> — pour l’ensemble des indicateurs réglementaires et fonciers (SRHH, PLH, SDRIF-E, gestion de l’eau, démarches territoriales…), consultez la fiche OCTE éditée par la DDT du Val-d’Oise : <a href="${app.octeUrl()}" target="_blank" rel="noreferrer">${escapeHtml(state.nom)}.pdf ↗</a>`;
      document.getElementById('dataBody').appendChild(octeBlock);
    }
    document.getElementById('dataFoot').textContent = `Fiche générée le ${today} · Portail communal · DDT du Val-d’Oise`;
  }

  async function buildPdf() {
    const { jsPDF } = window.jspdf;
    let doc;
    if (mode === 'carte') {
      const mapCanvas = await html2canvas(document.getElementById('printPage'), { scale: 2.2, useCORS: true, backgroundColor: '#ffffff' });
      doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      doc.addImage(mapCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 420, 297, undefined, 'FAST');
    } else {
      // La synthèse peut dépasser une page A4 : on découpe le long canevas
      // capturé en tranches de 297mm plutôt que de l'écraser dans une seule
      // page (ce qui rendait le texte illisible).
      const dataNode = document.getElementById('dataPage');
      const dataCanvas = await html2canvas(dataNode, { scale: 2.2, useCORS: true, backgroundColor: '#ffffff', windowWidth: dataNode.scrollWidth, windowHeight: dataNode.scrollHeight });
      const pxPerMm = dataCanvas.width / 210;
      const pageHeightPx = Math.round(297 * pxPerMm);
      const pageCount = Math.max(1, Math.ceil(dataCanvas.height / pageHeightPx));
      const slice = document.createElement('canvas');
      slice.width = dataCanvas.width;
      const sliceCtx = slice.getContext('2d');
      doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let i = 0; i < pageCount; i++) {
        const sliceHeightPx = Math.min(pageHeightPx, dataCanvas.height - i * pageHeightPx);
        slice.height = sliceHeightPx;
        sliceCtx.clearRect(0, 0, slice.width, slice.height);
        sliceCtx.drawImage(dataCanvas, 0, i * pageHeightPx, dataCanvas.width, sliceHeightPx, 0, 0, dataCanvas.width, sliceHeightPx);
        if (i > 0) doc.addPage('a4', 'portrait');
        doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, sliceHeightPx / pxPerMm, undefined, 'FAST');
      }
    }
    const blobUrl = URL.createObjectURL(doc.output('blob'));
    window.location.replace(blobUrl);
  }

  const ready = mode === 'carte' ? buildCarte() : (buildFiche(), new Promise(r => setTimeout(r, 300)));
  ready.then(() => buildPdf()).catch(err => { console.error(err); statusEl.textContent = 'La génération du PDF a échoué. Réessayez depuis la fiche.'; });
})();
