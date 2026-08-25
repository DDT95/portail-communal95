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
  function decoratePortalSection(section) {
    const title = section.querySelector('h3')?.textContent || '';
    const themes = {
      'Chiffres clés': ['key', '◆'], 'Élus et gouvernance': ['governance', '◎'], 'Sécurité': ['security', '◈'],
      'Démographie, revenus et emploi': ['demography', '●'], 'Logement': ['housing', '⌂'],
      'Occupation du sol (MOS 2025)': ['land', '◒'], 'Risques majeurs recensés': ['risks', '△'],
      'Artificialisation, eau et énergie': ['resources', '≈'], 'Politique de la ville': ['city', '◇']
    };
    const [theme] = themes[title] || ['default'];
    section.dataset.sectionTitle = title;
    section.classList.add('viz-section', `viz-${theme}`);
    section.querySelectorAll('.data-grid>div').forEach((row, index) => {
      row.style.setProperty('--row-index', index);
      const value = row.querySelector('dd')?.textContent || '';
      const match = value.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (match && !row.querySelector('.value-meter')) {
        const pct = Math.max(0, Math.min(100, Number(match[1].replace(',', '.'))));
        row.insertAdjacentHTML('beforeend', `<i class="value-meter" aria-hidden="true"><span style="width:${pct}%"></span></i>`);
      }
    });
    if (title === 'Occupation du sol (MOS 2025)') {
      const rows = [...section.querySelectorAll('.data-grid>div')].map(row => {
        const label = row.querySelector('dt')?.textContent.trim() || '';
        const value = row.querySelector('dd')?.textContent.trim() || '';
        const pct = value.match(/(\d+(?:[.,]\d+)?)\s*%/);
        return { label, value, pct: pct ? Number(pct[1].replace(',', '.')) : null };
      });
      const surface = rows.find(row => /superficie communale/i.test(row.label));
      const parts = rows.filter(row => row.pct != null).slice(0, 5);
      const colors = ['#d05a3f', '#e2a33a', '#26875a', '#4a78b8', '#7b4ab5'];
      if (parts.length) {
        section.querySelector('.donut-wrap')?.remove();
        section.querySelector('.data-grid')?.remove();
        section.querySelector('h3')?.insertAdjacentHTML('afterend', `<div class="land-overview">${surface ? `<div class="land-total"><b>${escapeHtml(surface.value)}</b><span>surface communale</span></div>` : ''}<div class="land-composition"><div class="land-band">${parts.map((row, i) => `<i style="width:${row.pct}%;background:${colors[i % colors.length]}"></i>`).join('')}</div><div class="land-legend">${parts.map((row, i) => `<div><i style="background:${colors[i % colors.length]}"></i><span>${escapeHtml(row.label)}</span><b>${row.pct.toFixed(1)} %</b><small>${escapeHtml(row.value.replace(/\s*[·-]\s*\d+(?:[.,]\d+)?\s*%/, ''))}</small></div>`).join('')}</div></div></div>`);
      }
    }
    return section;
  }

  function portalSections() {
    const srcHost = document.getElementById('drawer-body-src');
    srcHost.innerHTML = opener?.document.getElementById('drawer-body')?.innerHTML || snapshot?.drawerHtml || '';
    return Array.from(srcHost.children).map(decoratePortalSection);
  }

  function pageHtml(title, content, index, total, className = '') {
    const isSummary = className.includes('summary-page');
    const isOpening = !isSummary && index === 0;
    return `<div class="data-page ${className}" id="dataPage-${index}">
      <header class="data-page-head"><img src="prefet-val-doise.svg" alt=""><div><span>PORTAIL COMMUNAL · VAL-D’OISE</span><strong>${escapeHtml(isSummary ? title : (isOpening ? state.nom : title))}</strong>${isSummary ? '' : (isOpening ? `<em>${escapeHtml(title)}</em>` : '')}</div></header>
      <div class="data-body">${content}</div>
      <footer class="data-foot"><span>${escapeHtml(state.nom)} · code INSEE ${escapeHtml(state.code || '')}</span><span>${index + 1}/${total} · ${today}</span></footer>
    </div>`;
  }

  function miniMapHtml() {
    return `<figure class="commune-map-card"><div class="commune-mini-map" aria-label="Emprise cartographique de ${escapeHtml(state.nom)}"></div><figcaption><b>Emprise communale</b><span>Fond cartographique gris · © OpenStreetMap</span></figcaption></figure>`;
  }

  async function initMiniMaps() {
    const hosts = [...document.querySelectorAll('.commune-mini-map')];
    if (!hosts.length || !state.contour || !window.L) return;
    await Promise.all(hosts.map(host => new Promise(resolve => {
      const map = L.map(host, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false });
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, crossOrigin: true }).addTo(map);
      const boundary = L.geoJSON(state.contour, { style: { color: '#000091', weight: 3, opacity: 1, fillColor: '#6f78c8', fillOpacity: .16 } }).addTo(map);
      map.fitBounds(boundary.getBounds(), { padding: [12, 12] });
      map.invalidateSize();
      let settled = false;
      const done = () => { if (!settled) { settled = true; setTimeout(resolve, 250); } };
      tiles.once('load', done);
      setTimeout(done, 1400);
    })));
  }

  function buildSynthese() {
    const sections = portalSections();
    const wanted = ['Chiffres clés', 'Démographie, revenus et emploi', 'Logement', 'Occupation du sol (MOS 2025)', 'Risques majeurs recensés', 'Artificialisation, eau et énergie'];
    const findPercentage = (sectionTitle, label) => {
      const section = sections.find(s => s.dataset.sectionTitle === sectionTitle);
      const row = section ? [...section.querySelectorAll('.data-grid>div')].find(r => r.querySelector('dt')?.textContent.includes(label)) : null;
      const match = row?.querySelector('dd')?.textContent.match(/(\d+(?:[.,]\d+)?)\s*%/);
      return match ? Number(match[1].replace(',', '.')) : null;
    };
    const profileValues = [
      ['Pauvreté', findPercentage('Démographie, revenus et emploi', 'pauvreté')],
      ['Chômage', findPercentage('Démographie, revenus et emploi', 'chômage')],
      ['Logement social', findPercentage('Logement', 'logement social')],
      ['Vacance', findPercentage('Logement', 'vacants')],
      ['Maisons', findPercentage('Logement', 'Maisons')],
      ['Appartements', findPercentage('Logement', 'Appartements')]
    ].filter(([, value]) => value != null);
    const selected = sections.filter(s => wanted.includes(s.dataset.sectionTitle || '')).map(s => {
      const clone = s.cloneNode(true);
      clone.querySelectorAll('.source-note').forEach(n => n.remove());
      if (s.dataset.sectionTitle === 'Chiffres clés') clone.insertAdjacentHTML('afterbegin', miniMapHtml());
      if (s.dataset.sectionTitle === 'Chiffres clés' && profileValues.length) clone.insertAdjacentHTML('beforeend', `<div class="profile-chart"><h4>Profil social et résidentiel</h4><div>${profileValues.map(([label, value]) => `<figure><div><i style="height:${value}%"></i></div><b>${value.toFixed(1)} %</b><figcaption>${escapeHtml(label)}</figcaption></figure>`).join('')}</div></div>`);
      return clone.outerHTML;
    });
    const governance = sections.find(s => s.dataset.sectionTitle === 'Élus et gouvernance');
    const governanceRows = governance ? [...governance.querySelectorAll('.data-grid>div')].slice(0, 3).map(row => `<div><span>${escapeHtml(row.querySelector('dt')?.textContent || '')}</span><b>${escapeHtml(row.querySelector('dd')?.textContent || '')}</b></div>`).join('') : '';
    const leftColumn = [selected[0], selected[2], selected[4]].filter(Boolean).join('');
    const rightColumn = [selected[1], selected[3], selected[5]].filter(Boolean).join('');
    const content = `<section class="summary-hero"><p>FICHE SYNTHÉTIQUE</p><h1>${escapeHtml(state.nom)}</h1></section>${governanceRows ? `<section class="summary-governance"><h2>Gouvernance</h2><div>${governanceRows}</div></section>` : ''}<div class="summary-grid"><div class="summary-column">${leftColumn}</div><div class="summary-column">${rightColumn}</div></div>`;
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
    const portal = portalSections();
    const completePct = (sectionTitle, label) => {
      const section = portal.find(s => s.dataset.sectionTitle === sectionTitle);
      const row = section ? [...section.querySelectorAll('.data-grid>div')].find(r => r.querySelector('dt')?.textContent.includes(label)) : null;
      const match = row?.querySelector('dd')?.textContent.match(/(\d+(?:[.,]\d+)?)\s*%/);
      return match ? Number(match[1].replace(',', '.')) : null;
    };
    const completeKey = portal.find(s => s.dataset.sectionTitle === 'Chiffres clés');
    if (completeKey && !completeKey.querySelector('.commune-map-card')) completeKey.insertAdjacentHTML('afterbegin', miniMapHtml());
    const portalByTheme = new Map(portal.map(s => [s.dataset.sectionTitle || '', s.outerHTML]));
    const cleanOcteLine = line => line.replace(/_{2,}/g, ' ').replace(/\.{4,}/g, '  ·  ').replace(/\s{3,}/g, '  ·  ').replace(/\s+([,;:])/g, '$1').trim();
    const octeThemeHtml = theme => {
      const entries = [];
      const statusItems = [];
      const complements = [];
      let pendingLabel = '';
      theme.lines.forEach(rawLine => {
        const leaderMatches = [...rawLine.matchAll(/([^:]{2,}?)\s*:\s*\.{2,}\s*(.*?)(?=\s{2,}[^:]{2,}?\s*:\s*\.{2,}|$)/g)];
        if (leaderMatches.length) {
          leaderMatches.forEach(match => {
            const label = match[1].trim();
            const value = (match[2].split(/\.{4,}/)[0].trim() || 'Non renseigné');
            if (label) entries.push({ label, value });
            if (/^(Oui|Non|Approuvé|Pas signée?|Carencée?)$/i.test(value)) statusItems.push({ label, value });
          });
          return;
        }
        const parts = cleanOcteLine(rawLine).split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
        parts.forEach(part => {
          const visualStatus = part.match(/^(.{4,}?)\s+(Oui|Non|Approuvé|Pas signée?|Carencée?)$/i);
          if (visualStatus) statusItems.push({ label: visualStatus[1].trim(), value: visualStatus[2] });
          const colon = part.indexOf(':');
          if (colon >= 0) {
            if (pendingLabel) entries.push({ label: pendingLabel, value: 'Non renseigné' });
            pendingLabel = '';
            const label = part.slice(0, colon).trim();
            const value = part.slice(colon + 1).trim();
            if (label && value) entries.push({ label, value });
            else pendingLabel = label || pendingLabel;
          } else if (pendingLabel) {
            entries.push({ label: pendingLabel, value: part });
            pendingLabel = '';
          } else {
            const statusMatch = part.match(/^(.{4,}?)\s+(Oui|Non|Approuvé|Pas signée?|Carencée?|\-)$/i);
            if (statusMatch) entries.push({ label: statusMatch[1].trim(), value: statusMatch[2] });
            else if (part.length > 3 && !/^[-#]+$/.test(part)) complements.push(part);
          }
        });
      });
      if (pendingLabel) entries.push({ label: pendingLabel, value: 'Non renseigné' });
      const schemaSource = theme.title === 'Indicateurs socio-démographiques'
        ? theme.lines.filter(line => /habitants|hab\/Km/i.test(line)).join(' ')
        : theme.title === 'Occupation du sol communal'
          ? theme.lines.filter(line => /\bHa\b/i.test(line)).join(' ')
          : theme.title === 'Espaces Naturels Agricoles et forestiers'
            ? theme.lines.filter(line => /\bha\b/i.test(line)).join(' ')
            : '';
      const numbers = schemaSource.match(/-?\d+(?:[.,]\d+)?(?:\s*hab\/Km²|\s*habitants|\s*hab\.?|\s*%|\s*Ha|\s*ha)?/g) || [];
      const schemaLabels = {
        'Occupation du sol communal': ['Superficie communale', 'Espaces construits', 'Espaces ouverts', 'Espaces agricoles, forestiers et naturels', 'Superficie intercommunale', 'Espaces construits - intercommunalité', 'Espaces ouverts - intercommunalité', 'Espaces agricoles, forestiers et naturels - intercommunalité'],
        'Indicateurs socio-démographiques': ['Population municipale', 'Croissance annuelle', 'Densité', 'Solde naturel', 'Solde migratoire', 'Taille moyenne des ménages', 'Population intercommunale', 'Croissance intercommunale', 'Densité intercommunale', 'Solde naturel intercommunal', 'Solde migratoire intercommunal', 'Taille moyenne des ménages - intercommunalité'],
        'Espaces Naturels Agricoles et forestiers': ['Surface agricole utile', 'Évolution des espaces agricoles', 'Surface forestière', 'Forêt de protection']
      }[theme.title];
      if (schemaLabels && !entries.length) {
        const schemaValues = theme.title === 'Occupation du sol communal' && numbers.length >= 14
          ? [numbers[0], `${numbers[1]} · ${numbers[2]}`, `${numbers[3]} · ${numbers[4]}`, `${numbers[5]} · ${numbers[6]}`, numbers[7], `${numbers[8]} · ${numbers[9]}`, `${numbers[10]} · ${numbers[11]}`, `${numbers[12]} · ${numbers[13]}`]
          : numbers;
        schemaLabels.forEach((label, index) => { if (schemaValues[index] != null) entries.push({ label, value: schemaValues[index] }); });
      }
      const statuses = statusItems.filter((item, index, all) => all.findIndex(other => other.label === item.label) === index).slice(0, 24);
      const themeText = theme.lines.join(' ');
      const positiveCount = (themeText.match(/\b(?:Oui|Approuvé|Signée?)\b/gi) || []).length;
      const negativeCount = (themeText.match(/\b(?:Non|Pas signée?)\b/gi) || []).length;
      const statusTotal = positiveCount + negativeCount;
      const meaningful = entries.filter(entry => entry.label && entry.label.length > 2 && entry.value && !/^[#]+$/.test(entry.value) && !/^(Oui|Non|Approuvé|Pas signée?|Carencée?)$/i.test(entry.value.trim()));
      if (!meaningful.length && !statuses.length && statusTotal < 2) return '';
      const contextFor = label => /SRHH/i.test(label) ? 'Objectif territorial de production de logements fixé par le schéma régional de l’habitat et de l’hébergement.' : /PLH/i.test(label) ? 'Cadre intercommunal de programmation de l’habitat.' : /SCoT/i.test(label) ? 'Document stratégique de planification à l’échelle intercommunale.' : '';
      return `<section class="octe-theme${meaningful.length === 1 && !statuses.length ? ' octe-theme-focus' : ''}"><div class="octe-theme-head"><h2>${escapeHtml(theme.title)}</h2><span>DONNÉES OCTE · DDT 95</span></div>${statusTotal >= 2 ? `<div class="octe-status-summary"><div><span style="width:${positiveCount / statusTotal * 100}%"></span><i style="width:${negativeCount / statusTotal * 100}%"></i></div><p><b>${positiveCount}</b> dispositifs actifs <b>${negativeCount}</b> statuts négatifs</p></div>` : ''}${statuses.length ? `<div class="octe-status-matrix">${statuses.map(item => `<div class="${/^(oui|approuvé|signée)/i.test(item.value) ? 'is-positive' : 'is-negative'}"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`).join('')}</div>` : ''}<div class="octe-data-grid">${meaningful.map(entry => {
        const pct = entry.value.match(/(\d+(?:[.,]\d+)?)\s*%/);
        const status = /^(oui|non|approuvé|signée?|carencée?)$/i.test(entry.value.trim());
        const context = contextFor(entry.label);
        return `<div class="octe-data-item"><dt>${escapeHtml(entry.label)}</dt><dd${status ? ' class="octe-status"' : ''}>${escapeHtml(entry.value)}</dd>${context ? `<p>${escapeHtml(context)}</p>` : ''}${pct ? `<i aria-hidden="true"><span style="width:${Math.min(100, Number(pct[1].replace(',', '.')))}%"></span></i>` : ''}</div>`;
      }).join('')}</div></section>`;
    };
    const officialHtml = names => names.map(name => themes.find(t => t.title === name)).filter(Boolean).map(octeThemeHtml).join('');
    const enrichedHtml = names => names.map(name => portalByTheme.get(name)).filter(Boolean).join('');
    const integratedGroups = [
      ['Repères territoriaux et gouvernance', ['Données générales'], ['Chiffres clés', 'Élus et gouvernance']],
      ['Population, revenus et emploi', ['Indicateurs socio-démographiques'], ['Démographie, revenus et emploi']],
      ['Habitat et statuts d’occupation', ['Habitat logements'], ['Logement']],
      ['Foncier, économie et occupation du sol', ['Occupation du sol communal', 'Développement économique', 'Espaces Naturels Agricoles et forestiers'], ['Occupation du sol (MOS 2025)']],
      ['Planification, démarches et sécurité', ['Déclinaison du SDRIF-E', 'Démarches territoriales'], ['Politique de la ville', 'Sécurité']],
      ['Mobilités, eau et transition énergétique', ['Transports / déplacements et Aménagement', 'Gestion de l’eau', 'Transition énergétique'], ['Artificialisation, eau et énergie']],
      ['Patrimoine, environnement et risques', ['Patrimoine écologique, paysager et bâtis protégés', 'Risques naturels et technologiques / Nuisances sonores'], ['Risques majeurs recensés']]
    ];
    const pages = integratedGroups.map(([title, octeNames, enrichedNames]) => ({ title, html: `${warning}${enrichedHtml(enrichedNames)}${officialHtml(octeNames)}` })).filter(page => page.html.replace(/<[^>]+>/g, '').trim());
    document.getElementById('dataPages').innerHTML = pages.map((p, i) => pageHtml(p.title, p.html, i, pages.length)).join('');
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

  const ready = mode === 'carte' ? buildCarte() : (mode === 'synthese' ? Promise.resolve(buildSynthese()) : buildComplete()).then(() => initMiniMaps()).then(() => new Promise(r => setTimeout(r, 350)));
  ready.then(() => buildPdf()).catch(err => { console.error(err); statusEl.textContent = 'La génération du PDF a échoué. Réessayez depuis la fiche.'; });
})();
