/*
 * Portail communal — fiche territoriale par commune.
 * Sources : geo.api.gouv.fr (contours/population), RNE data.gouv.fr (élus, synchronisation août 2026),
 * Géorisques GASPAR + WMS PPRN/argiles (risques), data.geopf.fr (QPV), RNB beta.gouv.fr (bâtiments),
 * APICarto IGN (cadastre), data.education.gouv.fr (établissements scolaires), OpenStreetMap/Overpass (transports).
 */
'use strict';

const CFG = {
  communesApi: 'https://geo.api.gouv.fr',
  georisquesApi: 'https://www.georisques.gouv.fr/api/v1/gaspar/risques',
  georisquesWms: 'https://www.georisques.gouv.fr/services',
  rnbApi: 'https://rnb-api.beta.gouv.fr/api/alpha/ogc/collections/buildings/items',
  cadastreApi: 'https://apicarto.ign.fr/api/cadastre/parcelle',
  educationApi: 'https://data.education.gouv.fr/api/records/1.0/search/',
  overpassApi: 'https://overpass-api.de/api/interpreter',
  qpvFile: 'data/qpv_95.geojson',
  elusFile: 'data/elus_95.json',
  pdfBase: 'https://piece-jointe-carto.developpement-durable.gouv.fr/DEPT095A/DONNEE_GENERIQUE/N_BASE_COMMUNALE/OCTE/Fiches',
  minZoomDetail: 15
};

const state = {
  code: null, nom: null, contour: null, contourLayer: null,
  elus: null, risques: [], qpv: [], kpi: {},
  layers: {}, layerDefs: [],
  batimentsLayer: null, cadastreLayer: null, ecolesLayer: null, qpvLayer: null, busLayer: null, garesLayer: null,
  drawerMode: 'commune'
};

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '—').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
const formatNumber = n => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);

const map = L.map('map', { zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 1, minZoom: 10, maxZoom: 19 });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
map.createPane('riskTiles'); map.getPane('riskTiles').style.zIndex = 350; map.getPane('riskTiles').style.pointerEvents = 'none';
map.attributionControl.setPrefix('Leaflet');
map.setView([49.075, 2.105], 10);

function setLoading(on, detail) {
  const loader = $('map-loader');
  if (detail) $('loader-detail').textContent = detail;
  loader.classList.toggle('hidden', !on);
}

// ---------- Commune picker ----------
let communesIndex = [];
fetch(`${CFG.communesApi}/departements/95/communes?fields=nom,code`)
  .then(r => r.json())
  .then(list => {
    communesIndex = list.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    $('communes-list').innerHTML = communesIndex.map(c => `<option value="${escapeHtml(c.nom)}">`).join('');
  });

$('communeForm').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('communeSelect').value.trim().toLocaleLowerCase('fr');
  const match = communesIndex.find(c => c.nom.toLocaleLowerCase('fr') === query) || communesIndex.find(c => c.nom.toLocaleLowerCase('fr').startsWith(query));
  if (!match) return;
  const next = new URL(location.href);
  next.search = new URLSearchParams({ code: match.code, nom: match.nom }).toString();
  location.href = next.toString();
});

// ---------- Boot ----------
const params = new URLSearchParams(location.search);
const initialCode = params.get('code');
const initialNom = params.get('nom');
if (initialCode) {
  loadCommune(initialCode, initialNom);
} else {
  setLoading(false);
  $('communeSub').textContent = 'Choisissez une commune pour ouvrir sa fiche territoriale';
}

async function loadCommune(code, nomHint) {
  state.code = code;
  setLoading(true, 'Chargement du territoire');
  try {
    const commune = await fetch(`${CFG.communesApi}/communes/${code}?fields=nom,code,codeEpci,centre,contour,population,surface`).then(r => r.json());
    if (!commune.nom) throw new Error('Commune introuvable');
    state.nom = commune.nom || nomHint || code;
    state.contour = commune.contour;
    document.title = `${state.nom} · Portail communal · DDT 95`;
    $('communeTitle').textContent = state.nom;
    $('communeSub').textContent = `Fiche territoriale · code INSEE ${code}`;
    $('pageTitle').innerHTML = `${escapeHtml(state.nom)}.<br><span>Sa fiche territoriale.</span>`;
    $('communeSelect').value = state.nom;

    state.kpi = {
      population: commune.population || null,
      surface: commune.surface || null,
      epci: '…',
      code
    };
    if (commune.codeEpci) {
      fetch(`${CFG.communesApi}/epcis/${commune.codeEpci}?fields=nom`).then(r => r.json()).then(e => { state.kpi.epci = e.nom || '—'; renderFicheDrawer(); }).catch(() => { state.kpi.epci = '—'; renderFicheDrawer(); });
    } else {
      state.kpi.epci = '—';
    }

    $('showFiche').hidden = false;
    $('showFiche').onclick = () => renderFicheDrawer(true);

    drawContour(commune.contour);
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (state.contourLayer) map.fitBounds(state.contourLayer.getBounds(), { padding: [28, 28], animate: false });
    });

    await Promise.all([loadElus(code), loadRisques(code), renderQpv(commune.contour)]);
    setupDynamicLayers();
    renderControls();
    renderFicheDrawer(true);

    setLoading(false);
  } catch (error) {
    console.error(error);
    setLoading(false);
    $('communeSub').textContent = 'Commune introuvable — vérifiez la sélection.';
  }
}

function drawContour(contour) {
  if (state.contourLayer) { map.removeLayer(state.contourLayer); state.contourLayer = null; }
  if (!contour) return;
  state.contourLayer = L.geoJSON(contour, { style: { color: '#000091', weight: 2.5, opacity: 0.9, fillColor: '#000091', fillOpacity: 0.04 } }).addTo(map);
}

// ---------- Élus & risques (chargés, affichés dans le volet) ----------
function loadElus(code) {
  return fetch(CFG.elusFile).then(r => r.json()).then(all => { state.elus = all[code] || null; }).catch(() => { state.elus = null; });
}
function loadRisques(code) {
  return fetch(`${CFG.georisquesApi}?code_insee=${code}`).then(r => r.json()).then(d => { state.risques = d?.data?.[0]?.risques_detail || []; }).catch(() => { state.risques = []; });
}

// ---------- Volet droit : fiche commune / fiche bâtiment ----------
function renderFicheDrawer(open) {
  if (state.drawerMode === 'batiment' && !open) return;
  state.drawerMode = 'commune';
  $('drawer-kicker').textContent = 'FICHE COMMUNALE';
  $('drawer-title').textContent = state.nom || 'Commune';
  $('drawer-sub').textContent = `Code INSEE ${state.code}`;

  const kpiRows = [
    ['Population', state.kpi.population ? `${formatNumber(state.kpi.population)} habitants` : null],
    ['Superficie', state.kpi.surface ? `${formatNumber(Math.round(state.kpi.surface / 100) / 10)} km²` : null],
    ['Intercommunalité', state.kpi.epci && state.kpi.epci !== '…' ? state.kpi.epci : null],
    ['Code INSEE', state.kpi.code]
  ].filter(([, v]) => v);

  const e = state.elus;
  const elusRows = e ? [
    ['Maire', e.maire ? `${e.maire.prenom} ${e.maire.nom}` : null],
    ['Canton', e.canton?.nom],
    ['Conseillers départementaux', e.canton?.conseillers?.length ? e.canton.conseillers.map(c => `${c.prenom} ${c.nom}`).join(' · ') : null],
    [`Député${e.circonscription?.label ? ' (' + e.circonscription.label + ')' : ''}`, e.circonscription?.depute ? `${e.circonscription.depute.prenom} ${e.circonscription.depute.nom}` : null],
    ['Sénateurs du Val-d’Oise', e.senateurs?.length ? e.senateurs.map(s => `${s.prenom} ${s.nom}`).join(' · ') : null]
  ].filter(([, v]) => v) : [];

  const risquesHtml = state.risques.length
    ? state.risques.map(r => `<span class="risque-pill">${escapeHtml(r.libelle_risque_long)}</span>`).join('')
    : '<span class="risque-pill none">Aucun risque référencé à ce jour</span>';

  $('drawer-body').innerHTML = `
    <section class="result-section"><h3>Chiffres clés</h3><dl class="data-grid">${kpiRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
    ${elusRows.length ? `<section class="result-section"><h3>Élus et gouvernance</h3><dl class="data-grid">${elusRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>` : ''}
    <section class="result-section"><h3>Risques majeurs recensés</h3><div class="risque-pills">${risquesHtml}</div><p class="source-note">Géorisques · GASPAR — consulter <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noreferrer">georisques.gouv.fr</a> pour le détail réglementaire.</p></section>
  `;
  $('drawer-actions').innerHTML = `<button id="drawer-pdf" type="button">Fiche officielle PDF (OCTE)</button>`;
  $('drawer-pdf').onclick = () => window.open(`${CFG.pdfBase}/${encodeURIComponent(state.nom)}.pdf`, '_blank', 'noopener,noreferrer');

  if (open) { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); }
}
$('drawer-close').addEventListener('click', () => { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); });

// ---------- QPV (statique, filtré spatialement) ----------
async function renderQpv(contour) {
  state.qpv = [];
  if (!contour) return;
  try {
    const all = await fetch(CFG.qpvFile).then(r => r.json());
    state.qpv = all.features.filter(f => { try { return turf.booleanIntersects(f, contour); } catch { return false; } });
  } catch (error) { console.warn('QPV indisponible', error); }
}

// ---------- Couches dynamiques, regroupées par thème ----------
function setupDynamicLayers() {
  state.layerDefs = [
    { id: 'qpv', group: 'Politique de la ville', label: 'Quartiers prioritaires (QPV)', description: `${state.qpv.length ? state.qpv.length + ' quartier(s) recensé(s)' : 'Aucun QPV recensé dans cette commune'} · ANCT`, color: '#c1443c', active: state.qpv.length > 0, disabled: state.qpv.length === 0 },
    { id: 'ecoles', group: 'Services publics', label: 'Établissements scolaires', description: 'Écoles, collèges, lycées publics et privés sous contrat.', color: '#c76524', active: true },
    { id: 'batiments', group: 'Bâti et parcellaire', label: 'Bâtiments (RNB)', description: 'Référentiel National des Bâtiments · zoomez pour afficher.', color: '#18753c', active: false },
    { id: 'cadastre', group: 'Bâti et parcellaire', label: 'Parcelles cadastrales', description: 'APICarto IGN · zoomez pour afficher.', color: '#6a4c93', active: false },
    { id: 'bus', group: 'Transports', label: 'Arrêts de bus', description: 'OpenStreetMap · zoomez pour afficher.', color: '#0063cb', active: false },
    { id: 'gares', group: 'Transports', label: 'Gares et stations', description: 'OpenStreetMap · zoomez pour afficher.', color: '#0063cb', active: true },
    { id: 'inondation', group: 'Risques naturels', label: 'Zonage inondation (PPRI)', description: 'Géorisques · plans de prévention approuvés.', color: '#1479c9', active: false, wms: 'PPRN_ZONE_INOND' },
    { id: 'argiles', group: 'Risques naturels', label: 'Retrait-gonflement des argiles', description: 'Géorisques · aléa cartographié.', color: '#e76f00', active: false, wms: 'ALEARG_REALISE' }
  ];

  buildQpvLayer();
  buildEcolesLayer();
  buildWmsLayers();
  buildGaresLayer();

  map.off('moveend', refreshDetailLayers);
  map.on('moveend', refreshDetailLayers);
  refreshDetailLayers();
}

function buildQpvLayer() {
  if (state.qpvLayer) { map.removeLayer(state.qpvLayer); state.qpvLayer = null; }
  if (!state.qpv.length) return;
  state.qpvLayer = L.geoJSON({ type: 'FeatureCollection', features: state.qpv }, {
    style: { color: '#c1443c', weight: 2, opacity: 0.9, fillColor: '#c1443c', fillOpacity: 0.22 },
    onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.libelle || 'Quartier prioritaire', { sticky: true })
  });
  if (state.layerDefs.find(l => l.id === 'qpv')?.active) state.qpvLayer.addTo(map);
}

function buildEcolesLayer() {
  if (state.ecolesLayer) { map.removeLayer(state.ecolesLayer); state.ecolesLayer = null; }
  fetch(`${CFG.educationApi}?dataset=fr-en-annuaire-education&refine.code_commune=${state.code}&rows=200`).then(r => r.json()).then(d => {
    const records = (d.records || []).filter(r => r.fields.etat === 'OUVERT' && r.fields.latitude && r.fields.longitude);
    state.ecolesLayer = L.layerGroup(records.map(r => {
      const f = r.fields;
      const isPriv = f.statut_public_prive === 'Privé';
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker school${isPriv ? ' alt' : ''}">${(f.type_etablissement || 'É')[0]}</div>`, iconSize: [22, 22] });
      return L.marker([f.latitude, f.longitude], { icon }).bindPopup(`<strong>${escapeHtml(f.nom_etablissement)}</strong><br>${escapeHtml(f.type_etablissement)} · ${escapeHtml(f.statut_public_prive)}<br>${escapeHtml(f.adresse_1 || '')}`);
    }));
    if (state.layerDefs.find(l => l.id === 'ecoles')?.active) state.ecolesLayer.addTo(map);
    updateLegend();
  }).catch(() => {});
}

function buildGaresLayer() {
  if (state.garesLayer) { map.removeLayer(state.garesLayer); state.garesLayer = null; }
  if (!state.contour) return;
  const bounds = L.geoJSON(state.contour).getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  fetch(CFG.overpassApi, { method: 'POST', body: `data=[out:json][timeout:20];node["railway"="station"](${bbox});out;` }).then(r => r.json()).then(d => {
    state.garesLayer = L.layerGroup((d.elements || []).map(el => {
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker gare">G</div>', iconSize: [22, 22] });
      return L.marker([el.lat, el.lon], { icon }).bindPopup(`<strong>${escapeHtml(el.tags?.name || 'Gare')}</strong><br>Gare / station`);
    }));
    if (state.layerDefs.find(l => l.id === 'gares')?.active) state.garesLayer.addTo(map);
    updateLegend();
  }).catch(() => {});
}

function buildWmsLayers() {
  state.layerDefs.filter(l => l.wms).forEach(def => {
    const layer = L.tileLayer.wms(CFG.georisquesWms, { layers: def.wms, format: 'image/png', transparent: true, opacity: 0.75, version: '1.3.0', pane: 'riskTiles', attribution: 'Géorisques' });
    state.layers[def.id] = layer;
    if (def.active) layer.addTo(map);
  });
}

function refreshDetailLayers() {
  map.invalidateSize();
  if (map.getZoom() < CFG.minZoomDetail) return;
  if (state.layerDefs.find(l => l.id === 'batiments')?.active) loadBatiments();
  if (state.layerDefs.find(l => l.id === 'cadastre')?.active) loadCadastre();
  if (state.layerDefs.find(l => l.id === 'bus')?.active) loadBusStops();
}

async function loadBatiments() {
  map.invalidateSize();
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try {
    const data = await fetch(`${CFG.rnbApi}?bbox=${bbox}&limit=100`).then(r => r.json());
    if (state.batimentsLayer) map.removeLayer(state.batimentsLayer);
    state.batimentsLayer = L.geoJSON(data, {
      style: { color: '#18753c', weight: 1, opacity: 0.9, fillColor: '#18753c', fillOpacity: 0.35 },
      onEachFeature: (f, layer) => layer.on('click', e => { L.DomEvent.stopPropagation(e); openBuildingDrawer(f); })
    });
    if (state.layerDefs.find(l => l.id === 'batiments')?.active) state.batimentsLayer.addTo(map);
  } catch (error) { console.warn('RNB indisponible', error); }
}

async function loadCadastre() {
  map.invalidateSize();
  const b = map.getBounds();
  const geom = { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] };
  try {
    let response;
    try {
      response = await fetch(`${CFG.cadastreApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    } catch {
      response = await fetch(CFG.cadastreApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.json());
    }
    const features = response?.features || [];
    if (state.cadastreLayer) map.removeLayer(state.cadastreLayer);
    state.cadastreLayer = L.geoJSON(features, {
      style: { color: '#6a4c93', weight: 1, opacity: 0.85, fillOpacity: 0 },
      onEachFeature: (f, layer) => layer.bindTooltip(`Parcelle ${f.properties?.section || ''}${f.properties?.numero || ''}`, { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'cadastre')?.active) state.cadastreLayer.addTo(map);
  } catch (error) { console.warn('Cadastre indisponible', error); }
}

async function loadBusStops() {
  const b = map.getBounds();
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  try {
    const data = await fetch(CFG.overpassApi, { method: 'POST', body: `data=[out:json][timeout:20];node["highway"="bus_stop"](${bbox});out;` }).then(r => r.json());
    if (state.busLayer) map.removeLayer(state.busLayer);
    state.busLayer = L.layerGroup((data.elements || []).map(el => {
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker bus">B</div>', iconSize: [20, 20] });
      return L.marker([el.lat, el.lon], { icon }).bindPopup(`<strong>${escapeHtml(el.tags?.name || 'Arrêt de bus')}</strong>`);
    }));
    if (state.layerDefs.find(l => l.id === 'bus')?.active) state.busLayer.addTo(map);
  } catch (error) { console.warn('Overpass indisponible', error); }
}

function openBuildingDrawer(feature) {
  state.drawerMode = 'batiment';
  const p = feature.properties || {};
  const addr = (p.addresses || [])[0];
  $('drawer-kicker').textContent = 'FICHE BÂTIMENT';
  $('drawer-title').textContent = addr ? `${addr.street_number || ''} ${addr.street || ''}`.trim() : 'Bâtiment';
  $('drawer-sub').textContent = feature.id ? `RNB ${feature.id}` : 'Référentiel National des Bâtiments';
  const rows = [
    ['Statut', p.status],
    ['Adresse', addr ? `${addr.street_number || ''} ${addr.street || ''}, ${addr.city_zipcode || ''} ${addr.city_name || ''}` : null],
    ['Identifiant RNB', feature.id]
  ].filter(([, v]) => v);
  $('drawer-body').innerHTML = `<section class="result-section"><h3>Bâtiment</h3><dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Pour le DPE, le RPLS et le détail énergétique : ouvrez ce bâtiment dans la lecture <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a>.</p></section>`;
  $('drawer-actions').innerHTML = `<button id="drawer-back" type="button">← Retour à la fiche commune</button>`;
  $('drawer-back').onclick = () => renderFicheDrawer(true);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}

// ---------- Panneau de couches, regroupé par thème ----------
function renderControls() {
  const root = $('layer-list');
  const groups = [...new Set(state.layerDefs.map(x => x.group))];
  root.innerHTML = groups.map(group => `<div class="layer-group"><strong>${group}</strong>${state.layerDefs.filter(x => x.group === group).map(x => `<div class="layer-row" data-layer-row="${x.id}" style="${x.disabled ? 'opacity:.5;pointer-events:none' : ''}"><button class="switch" type="button" data-layer="${x.id}" aria-label="Afficher ${x.label}" aria-pressed="${x.active}"></button><div class="layer-copy"><strong>${x.label}</strong><span>${x.description}</span></div><i class="swatch" style="background:${x.color}"></i></div>`).join('')}</div>`).join('');
  root.querySelectorAll('[data-layer-row]').forEach(row => row.addEventListener('click', () => toggleLayer(row.dataset.layerRow)));
  updateLegend();
}

function updateLegend() {
  const active = state.layerDefs.filter(x => x.active);
  $('legend-items').innerHTML = active.length ? active.map(x => `<div class="legend-row"><i style="background:${x.color}"></i><span>${x.label}</span></div>`).join('') : '<div class="legend-row">Aucune information affichée</div>';
}

function layerFor(id) {
  return { qpv: state.qpvLayer, ecoles: state.ecolesLayer, batiments: state.batimentsLayer, cadastre: state.cadastreLayer, bus: state.busLayer, gares: state.garesLayer, inondation: state.layers.inondation, argiles: state.layers.argiles }[id];
}

function toggleLayer(id) {
  const def = state.layerDefs.find(x => x.id === id);
  if (!def || def.disabled) return;
  def.active = !def.active;
  const button = document.querySelector(`[data-layer="${id}"]`);
  if (button) button.setAttribute('aria-pressed', String(def.active));
  const layer = layerFor(id);
  if (def.active) {
    if (layer) layer.addTo(map);
    if ((id === 'batiments' || id === 'cadastre' || id === 'bus') && map.getZoom() >= CFG.minZoomDetail) {
      if (id === 'batiments') loadBatiments(); else if (id === 'cadastre') loadCadastre(); else loadBusStops();
    }
  } else if (layer) {
    map.removeLayer(layer);
  }
  updateLegend();
}

$('hide-all').addEventListener('click', () => { state.layerDefs.forEach(d => { if (d.active && !d.disabled) toggleLayer(d.id); }); });
$('mobile-panel').addEventListener('click', () => {
  const panel = $('panel');
  panel.classList.toggle('open');
  $('mobile-panel').setAttribute('aria-expanded', String(panel.classList.contains('open')));
});

// ---------- Export / impression ----------
const exportDialog = $('exportDialog');
$('openExport').addEventListener('click', () => exportDialog.showModal());
$('closeExport').addEventListener('click', () => exportDialog.close());
exportDialog.addEventListener('click', e => { if (e.target === exportDialog) exportDialog.close(); });
$('printProfile').addEventListener('click', () => { exportDialog.close(); window.print(); });
$('makePdf').addEventListener('click', async () => {
  exportDialog.close();
  renderFicheDrawer(true);
  document.body.classList.add('exporting');
  const pdfWindow = window.open('', '_blank');
  if (pdfWindow) pdfWindow.document.write('<title>Génération du PDF…</title><body style="font-family:sans-serif;padding:60px;color:#10104b">Génération de la fiche PDF en cours…</body>');
  try {
    const blob = await html2pdf().set({
      margin: 8,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(document.querySelector('.drawer')).outputPdf('blob');
    const url = URL.createObjectURL(blob);
    if (pdfWindow && !pdfWindow.closed) pdfWindow.location.href = url; else window.open(url, '_blank', 'noopener');
  } finally {
    document.body.classList.remove('exporting');
  }
});
