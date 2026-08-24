(function () {
  const opener = window.opener;
  let app = opener && opener.pcApp;
  let snapshot = null;
  try { snapshot = JSON.parse(localStorage.getItem('pc-export-snapshot') || 'null'); } catch {}
  if (!app && snapshot) app = { state: snapshot.state, escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), formatNumber: value => Number(value).toLocaleString('fr-FR'), octeUrl: () => snapshot.octeUrl };
  if (!app) {
    document.body.innerHTML = '<p style="padding:40px;font:16px Marianne,Arial,sans-serif">Cette page s’ouvre depuis le bouton d’export de la fiche communale.</p>';
    return;
  }
  const { state, MOS_LABELS, mosColor, PUBLIC_LAND_COLORS, roadStyle, escapeHtml, formatNumber } = app;
  const requestedMode = new URLSearchParams(location.search).get('mode');
  const mode = ['complete', 'synthese'].includes(requestedMode) ? requestedMode : 'carte';
  const statusEl = document.getElementById('pdfStatus');
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('printPage').hidden = mode !== 'carte';

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
      } else if (def.id === 'routes') {
        L.geoJSON(data, { style: roadStyle }).addTo(map);
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
      }, { pane: 'maskPane', interactive: false, style: { stroke: false, fillColor: '#ffffff', fillOpacity: 0.55, fillRule: 'evenodd' } }).addTo(map);
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

  // ---------- Fiches communales A4 ----------
  function portalSections() {
    const srcHost = document.getElementById('drawer-body-src');
    srcHost.innerHTML = opener?.document.getElementById('drawer-body')?.innerHTML || snapshot?.drawerHtml || '';
    return Array.from(srcHost.children);
  }

  function pageHtml(title, content, index, total, className = '') {
    return `<div class="data-page ${className}" id="dataPage-${index}">
      <header class="data-page-head"><img src="prefet-val-doise.svg" alt=""><div><span>PORTAIL COMMUNAL · VAL-D’OISE</span><strong>${escapeHtml(title)}</strong></div></header>
      <div class="data-body">${content}</div>
      <footer class="data-foot"><span>${escapeHtml(state.nom)} · code INSEE ${escapeHtml(state.code || '')}</span><span>${index + 1}/${total} · ${today}</span></footer>
    </div>`;
  }

  function buildSynthese() {
    const sections = portalSections();
    const wanted = ['Chiffres clés', 'Démographie, revenus et emploi', 'Logement', 'Occupation du sol (MOS 2025)', 'Risques majeurs recensés', 'Artificialisation, eau et énergie'];
    const selected = sections.filter(s => wanted.includes(s.querySelector('h3')?.textContent || '')).map(s => {
      const clone = s.cloneNode(true);
      clone.querySelectorAll('.source-note').forEach(n => n.remove());
      return clone.outerHTML;
    });
    const content = `<section class="summary-hero"><p>FICHE SYNTHÉTIQUE</p><h1>${escapeHtml(state.nom)}</h1><span>Portrait territorial en un coup d’œil</span></section><div class="summary-grid">${selected.join('')}</div><p class="summary-source">Sources : Insee, Institut Paris Region, Géorisques, Cerema, Hub’Eau, Agence ORE, ANCT et DDT 95. Données disponibles au ${today}.</p>`;
    document.getElementById('dataPages').innerHTML = pageHtml('Synthèse communale', content, 0, 1, 'summary-page');
  }

  async function readOcteThemes() {
    if (!window.pdfjsLib || !app.octeUrl) throw new Error('Lecteur OCTE indisponible');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ url: app.octeUrl(), withCredentials: false }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const text = await (await pdf.getPage(p)).getTextContent();
      const rows = new Map();
      text.items.forEach(item => {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: item.transform[4], text: item.str });
      });
      pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.text).join('  ').trim()).filter(Boolean));
    }
    const headings = ['Données générales', 'Occupation du sol communal', 'Indicateurs socio-démographiques', 'Déclinaison du SDRIF-E', 'Développement économique', 'Espaces Naturels Agricoles et forestiers', 'Habitat logements', 'Transports / déplacements et Aménagement', 'Gestion de l’eau', 'Transition énergétique', 'Patrimoine écologique, paysager et bâtis protégés', 'Risques naturels et technologiques / Nuisances sonores', 'Démarches territoriales'];
    const themes = [];
    pages.flat().forEach(line => {
      const heading = headings.find(h => line.toLocaleLowerCase('fr').includes(h.toLocaleLowerCase('fr')));
      if (heading) themes.push({ title: heading, lines: [] });
      else if (themes.length && !/Outil de connaissance territoriale|Édition du|DDT du Val-d’Oise|secret statistique|Pour la CARPF/.test(line)) themes.at(-1).lines.push(line);
    });
    return themes.filter(t => t.lines.length);
  }

  async function buildComplete() {
    statusEl.textContent = 'Vérification des données OCTE à la source…';
    let themes = [];
    let warning = '';
    try { themes = await readOcteThemes(); } catch (error) { console.warn(error); warning = '<p class="data-warning">La source OCTE n’a pas pu être relue. Les données du portail restent présentes ci-dessous.</p>'; }
    const cleanOcteLine = line => line.replace(/_{2,}/g, ' ').replace(/\.{4,}/g, '  ·  ').replace(/\s{3,}/g, '  ·  ').replace(/\s+([,;:])/g, '$1').trim();
    const groups = [
      ['Données générales', 'Déclinaison du SDRIF-E'],
      ['Indicateurs socio-démographiques', 'Habitat logements'],
      ['Occupation du sol communal', 'Développement économique', 'Espaces Naturels Agricoles et forestiers'],
      ['Transports / déplacements et Aménagement', 'Gestion de l’eau', 'Transition énergétique'],
      ['Patrimoine écologique, paysager et bâtis protégés', 'Risques naturels et technologiques / Nuisances sonores'],
      ['Démarches territoriales']
    ];
    const contents = groups.flatMap(octeNames => {
      const officialPages = octeNames.map(name => themes.find(t => t.title === name)).filter(Boolean).map(t => ({
        title: t.title,
        html: `${warning}<section class="octe-theme"><div class="octe-badge">SOURCE OFFICIELLE OCTE · DDT 95</div><div class="octe-lines">${t.lines.map(l => `<p>${escapeHtml(cleanOcteLine(l))}</p>`).join('')}</div></section>`
      }));
      return officialPages;
    });
    const cover = { title: 'Dossier communal complet', html: `<section class="complete-cover"><p>OUTIL DE CONNAISSANCE TERRITORIALE</p><h1>${escapeHtml(state.nom)}</h1><strong>Code INSEE ${escapeHtml(state.code || '')}</strong><span>Données officielles OCTE relues directement à la source.</span></section><section class="method-box"><h2>Lecture du document</h2><p>Chaque page est consacrée à une rubrique OCTE officielle, sans ajout des contenus détaillés du portail communal.</p><p>Source OCTE : DDT du Val-d’Oise, fiche consultée le ${today}. Les millésimes propres à chaque indicateur sont indiqués dans les contenus.</p></section>` };
    const pages = [cover, ...contents];
    document.getElementById('dataPages').innerHTML = pages.map((p, i) => pageHtml(p.title, p.html, i, pages.length, i === 0 ? 'cover-page' : '')).join('');
  }

  async function buildPdf() {
    const { jsPDF } = window.jspdf;
    let doc;
    if (mode === 'carte') {
      const mapCanvas = await html2canvas(document.getElementById('printPage'), { scale: 2.2, useCORS: true, backgroundColor: '#ffffff' });
      doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      doc.addImage(mapCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 420, 297, undefined, 'FAST');
    } else {
      // Chaque page a déjà été composée à la bonne hauteur (voir buildFiche,
      // qui répartit les sections sans jamais en couper une en deux) : on
      // capture donc une image par page plutôt que de découper un long
      // canevas au pixel près.
      const dataPages = Array.from(document.querySelectorAll('#dataPages .data-page'));
      doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let i = 0; i < dataPages.length; i++) {
        const canvas = await html2canvas(dataPages[i], { scale: 1.65, useCORS: true, backgroundColor: '#ffffff' });
        if (i > 0) doc.addPage('a4', 'portrait');
        doc.addImage(canvas.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
    }
    const blobUrl = URL.createObjectURL(doc.output('blob'));
    window.location.replace(blobUrl);
  }

  const ready = mode === 'carte' ? buildCarte() : (mode === 'synthese' ? Promise.resolve(buildSynthese()) : buildComplete()).then(() => new Promise(r => setTimeout(r, 500)));
  ready.then(() => buildPdf()).catch(err => { console.error(err); statusEl.textContent = 'La génération du PDF a échoué. Réessayez depuis la fiche.'; });
})();
