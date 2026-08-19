/*
 * Portail communal — fiche territoriale par commune.
 * Sources : geo.api.gouv.fr (contours/population), RNE data.gouv.fr (élus, synchronisation août 2026),
 * Géorisques GASPAR (risques), data.geopf.fr (QPV), RNB beta.gouv.fr (bâtiments),
 * APICarto IGN (cadastre), data.education.gouv.fr (établissements scolaires).
 */
'use strict';

const CFG = {
  communesApi: 'https://geo.api.gouv.fr',
  georisquesApi: 'https://www.georisques.gouv.fr/api/v1/gaspar/risques',
  rnbApi: 'https://rnb-api.beta.gouv.fr/api/alpha/ogc/collections/buildings/items',
  cadastreApi: 'https://apicarto.ign.fr/api/cadastre/parcelle',
  educationApi: 'https://data.education.gouv.fr/api/records/1.0/search/',
  qpvFile: 'data/qpv_95.geojson',
  elusFile: 'data/elus_95.json',
  pdfBase: 'https://piece-jointe-carto.developpement-durable.gouv.fr/DEPT095A/DONNEE_GENERIQUE/N_BASE_COMMUNALE/OCTE/Fiches',
  minZoomDetail: 15
};

const state = {
  code: null, nom: null, contour: null, contourLayer: null,
  elus: null, qpv: [],
  layers: {}, layerDefs: [],
  batimentsLayer: null, cadastreLayer: null, ecolesLayer: null, qpvLayer: null,
  loadingDetail: false
};

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '—').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const formatNumber = n => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);

const map = L.map('map', { zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 1, minZoom: 10, maxZoom: 19 });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
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
    if (commune.code !== code && !commune.nom) throw new Error('Commune introuvable');
    state.nom = commune.nom || nomHint || code;
    state.contour = commune.contour;
    document.title = `${state.nom} · Portail communal · DDT 95`;
    $('communeTitle').textContent = state.nom;
    $('communeSub').textContent = `Fiche territoriale · code INSEE ${code}`;
    $('pageTitle').innerHTML = `${escapeHtml(state.nom)}.<br><span>Sa fiche territoriale.</span>`;
    $('communeSelect').value = state.nom;

    $('kpiPopulation').textContent = commune.population ? formatNumber(commune.population) : '—';
    $('kpiSurface').textContent = commune.surface ? `${formatNumber(Math.round(commune.surface / 100) / 10)} km²` : '—';
    $('kpiCode').textContent = code;
    $('kpiEpci').textContent = '…';
    $('kpiStrip').hidden = false;

    if (commune.codeEpci) {
      fetch(`${CFG.communesApi}/epcis/${commune.codeEpci}?fields=nom`).then(r => r.json()).then(e => { $('kpiEpci').textContent = e.nom || '—'; }).catch(() => { $('kpiEpci').textContent = '—'; });
    } else {
      $('kpiEpci').textContent = '—';
    }

    $('pdfLink').hidden = false;
    $('pdfLink').onclick = () => window.open(`${CFG.pdfBase}/${encodeURIComponent(state.nom)}.pdf`, '_blank', 'noopener,noreferrer');

    drawContour(commune.contour);
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (state.contourLayer) map.fitBounds(state.contourLayer.getBounds(), { padding: [28, 28], animate: false });
    });

    renderElus(code);
    renderRisques(code);
    await renderQpv(commune.contour);
    setupDynamicLayers();
    renderControls();

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

// ---------- Élus ----------
function renderElus(code) {
  const root = $('elusRows');
  fetch(CFG.elusFile).then(r => r.json()).then(all => {
    const e = all[code];
    state.elus = e;
    if (!e) { $('elusBlock').hidden = true; return; }
    const rows = [];
    if (e.maire) rows.push(['Maire', `${e.maire.prenom} ${e.maire.nom}`]);
    if (e.canton) rows.push(['Canton', e.canton.nom]);
    if (e.canton?.conseillers?.length) rows.push(['Conseillers départementaux', e.canton.conseillers.map(c => `${c.prenom} ${c.nom}`).join(' · ')]);
    if (e.circonscription?.depute) rows.push([`Député (${e.circonscription.label || 'circonscription'})`, `${e.circonscription.depute.prenom} ${e.circonscription.depute.nom}`]);
    if (e.senateurs?.length) rows.push(['Sénateurs du Val-d’Oise', e.senateurs.map(s => `${s.prenom} ${s.nom}`).join(' · ')]);
    root.innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    $('elusBlock').hidden = rows.length === 0;
  }).catch(() => { $('elusBlock').hidden = true; });
}

// ---------- Risques ----------
function renderRisques(code) {
  const root = $('risquesRows');
  fetch(`${CFG.georisquesApi}?code_insee=${code}`).then(r => r.json()).then(d => {
    const risques = d?.data?.[0]?.risques_detail || [];
    if (!risques.length) { root.innerHTML = '<span class="risque-pill none">Aucun risque référencé à ce jour</span>'; $('risquesBlock').hidden = false; return; }
    root.innerHTML = risques.map(r => `<span class="risque-pill">${escapeHtml(r.libelle_risque_long)}</span>`).join('');
    $('risquesBlock').hidden = false;
  }).catch(() => { $('risquesBlock').hidden = true; });
}

// ---------- QPV (statique, filtré spatialement) ----------
async function renderQpv(contour) {
  state.qpv = [];
  if (!contour) return;
  try {
    const all = await fetch(CFG.qpvFile).then(r => r.json());
    const communePoly = contour;
    state.qpv = all.features.filter(f => {
      try { return turf.booleanIntersects(f, communePoly); } catch { return false; }
    });
  } catch (error) { console.warn('QPV indisponible', error); }
}

// ---------- Couches dynamiques (bâti, cadastre, écoles, QPV) ----------
function setupDynamicLayers() {
  state.layerDefs = [
    { id: 'qpv', group: 'Politique de la ville', label: 'Quartiers prioritaires (QPV)', description: `${state.qpv.length ? state.qpv.length + ' quartier(s) recensé(s)' : 'Aucun QPV recensé dans cette commune'} · ANCT`, color: '#c1443c', active: state.qpv.length > 0, disabled: state.qpv.length === 0 },
    { id: 'ecoles', group: 'Services publics', label: 'Établissements scolaires', description: 'Écoles, collèges, lycées publics et privés sous contrat.', color: '#c76524', active: true },
    { id: 'batiments', group: 'Bâti et parcellaire', label: 'Bâtiments (RNB)', description: 'Référentiel National des Bâtiments · zoomez pour afficher.', color: '#18753c', active: false },
    { id: 'cadastre', group: 'Bâti et parcellaire', label: 'Parcelles cadastrales', description: 'APICarto IGN · zoomez pour afficher.', color: '#6a4c93', active: false }
  ];

  buildQpvLayer();
  buildEcolesLayer();

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
  const url = `${CFG.educationApi}?dataset=fr-en-annuaire-education&refine.code_commune=${state.code}&rows=200`;
  fetch(url).then(r => r.json()).then(d => {
    const records = (d.records || []).filter(r => r.fields.etat === 'OUVERT' && r.fields.latitude && r.fields.longitude);
    state.ecolesLayer = L.layerGroup(records.map(r => {
      const f = r.fields;
      const isPriv = f.statut_public_prive === 'Privé';
      const icon = L.divIcon({ className: '', html: `<div class="school-marker${isPriv ? ' priv' : ''}">${(f.type_etablissement || 'É')[0]}</div>`, iconSize: [22, 22] });
      return L.marker([f.latitude, f.longitude], { icon }).bindPopup(`<strong>${escapeHtml(f.nom_etablissement)}</strong><br>${escapeHtml(f.type_etablissement)} · ${escapeHtml(f.statut_public_prive)}<br>${escapeHtml(f.adresse_1 || '')}`);
    }));
    if (state.layerDefs.find(l => l.id === 'ecoles')?.active) state.ecolesLayer.addTo(map);
    updateLegend();
  }).catch(() => {});
}

function refreshDetailLayers() {
  map.invalidateSize();
  if (map.getZoom() < CFG.minZoomDetail) return;
  const batDef = state.layerDefs.find(l => l.id === 'batiments');
  const cadDef = state.layerDefs.find(l => l.id === 'cadastre');
  if (batDef?.active) loadBatiments();
  if (cadDef?.active) loadCadastre();
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

function openBuildingDrawer(feature) {
  const p = feature.properties || {};
  const addr = (p.addresses || [])[0];
  $('drawer-title').textContent = addr ? `${addr.street_number || ''} ${addr.street || ''}`.trim() : 'Bâtiment';
  $('drawer-sub').textContent = feature.id ? `RNB ${feature.id}` : 'Référentiel National des Bâtiments';
  const rows = [
    ['Statut', p.status],
    ['Adresse', addr ? `${addr.street_number || ''} ${addr.street || ''}, ${addr.city_zipcode || ''} ${addr.city_name || ''}` : null],
    ['Identifiant RNB', feature.id]
  ].filter(([, v]) => v);
  $('drawer-body').innerHTML = `<dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Pour le DPE, le RPLS et le détail énergétique : ouvrez ce bâtiment dans la lecture <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a>.</p>`;
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}
$('drawer-close').addEventListener('click', () => { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); });

// ---------- Panneau de couches ----------
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

function toggleLayer(id) {
  const def = state.layerDefs.find(x => x.id === id);
  if (!def || def.disabled) return;
  def.active = !def.active;
  const button = document.querySelector(`[data-layer="${id}"]`);
  if (button) button.setAttribute('aria-pressed', String(def.active));
  const map_ = { qpv: state.qpvLayer, ecoles: state.ecolesLayer, batiments: state.batimentsLayer, cadastre: state.cadastreLayer };
  const layer = map_[id];
  if (def.active) {
    if (layer) layer.addTo(map);
    if ((id === 'batiments' || id === 'cadastre') && map.getZoom() >= CFG.minZoomDetail) { if (id === 'batiments') loadBatiments(); else loadCadastre(); }
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
  document.body.classList.add('exporting');
  const name = (state.nom || 'commune').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  try {
    await html2pdf().set({
      margin: 8,
      filename: `fiche-communale-${name}.pdf`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(document.querySelector('.left-panel')).save();
  } finally {
    document.body.classList.remove('exporting');
  }
});
