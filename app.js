/*
 * Portail communal — fiche territoriale par commune.
 * Sources réutilisées telles quelles depuis les lectures existantes de l'Atlas :
 * geo.api.gouv.fr (contours/population/EPCI), RNE data.gouv.fr (élus),
 * Géorisques GASPAR + WMS PPRN/argiles (observatoire_risques_95), data.geopf.fr (QPV, forêts publiques),
 * RNB beta.gouv.fr (observatoire_bati), APICarto IGN — cadastre, RPG (agriculture95), nature (biodiversite95), GPU (urbanisme95),
 * data.education.gouv.fr (écoles), acces-services95 (services publics : mairies, CCAS, France Services, santé, sécurité...),
 * data.iledefrance-mobilites.fr (bus-trains-95), Cerema apidf (artificialisation-zan95),
 * Hub'Eau (eau95), Agence ORE (transition-energetique95), data.iledefrance.fr (biodiversite95 — jardins remarquables).
 */
'use strict';

const CFG = {
  communesApi: 'https://geo.api.gouv.fr',
  georisquesApi: 'https://www.georisques.gouv.fr/api/v1/gaspar/risques',
  georisquesWms: 'https://www.georisques.gouv.fr/services',
  rnbApi: 'https://rnb-api.beta.gouv.fr/api/alpha/ogc/collections/buildings/items',
  cadastreApi: 'https://apicarto.ign.fr/api/cadastre/parcelle',
  rpgApi: 'https://apicarto.ign.fr/api/rpg/v2',
  natureApi: 'https://apicarto.ign.fr/api/nature',
  gpuApi: 'https://apicarto.ign.fr/api/gpu/zone-urba',
  geopfWfs: 'https://data.geopf.fr/wfs/ows',
  educationApi: 'https://data.education.gouv.fr/api/records/1.0/search/',
  servicesApi: 'https://ddt95.github.io/acces-services95/data/services-95.json',
  jardinsApi: 'https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/liste-des-jardins-remarquables/records',
  idfmArretsApi: 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records',
  ceremaApi: 'https://apidf-preprod.cerema.fr/indicateurs/conso_espace/communes',
  hubeauApi: 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/communes_udi',
  odreApi: 'https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets/consommation-annuelle-d-electricite-et-gaz-par-commune/records',
  bdnbApi: 'https://api.bdnb.io/v1/bdnb',
  eauCoursEau: 'https://ddt95.github.io/eau95/data/processed/cours_eau.geojson',
  eauStations: 'https://ddt95.github.io/eau95/data/processed/stations.geojson',
  roadsFile: 'https://ddt95.github.io/transport95/roads95.js',
  qpvFile: 'data/qpv_95.geojson',
  elusFile: 'data/elus_95.json',
  finessFile: 'data/finess_95.json',
  pdfBase: 'https://piece-jointe-carto.developpement-durable.gouv.fr/DEPT095A/DONNEE_GENERIQUE/N_BASE_COMMUNALE/OCTE/Fiches',
  zoomGated: 13
};

const SERVICE_CATS = {
  france_services: { label: 'Maisons France Services', color: '#000091' },
  administration: { label: 'Mairie, CCAS & administration', color: '#3153a4' },
  securite: { label: 'Sécurité & secours', color: '#d65b2b' },
  quotidien: { label: 'Services du quotidien', color: '#b07800' },
  culture: { label: 'Culture & sport', color: '#33845b' }
};

const FINESS_CATS = {
  hopitaux: { label: 'Hôpitaux & cliniques', color: '#c1443c' },
  medecins: { label: 'Médecins & laboratoires', color: '#d33b63' },
  pharmacies: { label: 'Pharmacies', color: '#18753c' },
  ehpad: { label: 'EHPAD & personnes âgées', color: '#8146a1' },
  handicap: { label: 'Accueil handicap & enfance', color: '#0078f3' }
};

const state = {
  code: null, nom: null, contour: null, contourLayer: null,
  elus: null, risques: [], qpv: [], kpi: {}, zan: null, eau: null, energie: null, services: [], finess: [],
  layers: {}, layerDefs: [],
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
  buildLandingMap();
}

function buildLandingMap() {
  map.dragging.disable(); map.scrollWheelZoom.disable(); map.doubleClickZoom.disable();
  fetch(`${CFG.communesApi}/departements/95/communes?fields=nom,code,contour&format=geojson&geometry=contour`).then(r => r.json()).then(fc => {
    const layer = L.geoJSON(fc, {
      style: { color: '#71839d', weight: 0.8, opacity: 0.75, fillColor: '#f4f7fb', fillOpacity: 0.5 },
      onEachFeature: (f, l) => {
        l.bindTooltip(f.properties.nom, { sticky: true, direction: 'top' });
        l.on({
          mouseover: () => l.setStyle({ color: '#000091', weight: 1.4, fillColor: '#e6e6fb', fillOpacity: 0.7 }),
          mouseout: () => layer.resetStyle(l),
          click: () => { location.href = `?${new URLSearchParams({ code: f.properties.code, nom: f.properties.nom })}`; }
        });
      }
    }).addTo(map);
    requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(layer.getBounds(), { padding: [24, 24], animate: false }); });
  });
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
    $('pageTitle').innerHTML = `${escapeHtml(state.nom)}<br><span>Fiche territoriale</span>`;
    $('communeSelect').value = state.nom;

    state.kpi = { population: commune.population || null, surface: commune.surface || null, epci: '…', code };
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

    await Promise.all([loadElus(code), loadRisques(code), loadZan(code), loadEau(code), loadEnergie(code), loadServices(state.nom), loadFiness(commune.contour), renderQpv(commune.contour)]);
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

// ---------- Données de synthèse (volet droit) ----------
function loadElus(code) {
  return fetch(CFG.elusFile).then(r => r.json()).then(all => { state.elus = all[code] || null; }).catch(() => { state.elus = null; });
}
function loadRisques(code) {
  return fetch(`${CFG.georisquesApi}?code_insee=${code}`).then(r => r.json()).then(d => { state.risques = d?.data?.[0]?.risques_detail || []; }).catch(() => { state.risques = []; });
}
function loadZan(code) {
  return fetch(`${CFG.ceremaApi}/${code}/`).then(r => r.json()).then(d => {
    const rows = (d.results || []).filter(r => r.annee >= 2011);
    const total = rows.reduce((sum, r) => sum + (r.naf_arti || 0), 0);
    const last = rows.sort((a, b) => b.annee - a.annee)[0];
    state.zan = rows.length ? { total, lastYear: last?.annee, lastValue: last?.naf_arti } : null;
  }).catch(() => { state.zan = null; });
}
function loadEau(code) {
  return fetch(`${CFG.hubeauApi}?code_commune=${code}&size=1`).then(r => r.json()).then(d => {
    state.eau = d.count ? { reseaux: d.count, reseau: d.data?.[0]?.nom_reseau } : null;
  }).catch(() => { state.eau = null; });
}
function loadEnergie(code) {
  const url = new URL(CFG.odreApi);
  url.searchParams.set('where', `code_commune="${code}" and filiere="Electricité" and code_grand_secteur="RESIDENTIEL"`);
  url.searchParams.set('order_by', 'annee desc');
  url.searchParams.set('limit', '1');
  return fetch(url).then(r => r.json()).then(d => {
    const row = d.results?.[0];
    state.energie = row ? { annee: row.annee, conso: row.conso_totale_mwh, sites: row.nb_sites } : null;
  }).catch(() => { state.energie = null; });
}
function loadServices(nom) {
  return fetch(CFG.servicesApi).then(r => r.json()).then(d => {
    state.services = (d.records || []).filter(r => r.city === nom && r.category !== 'education' && r.category !== 'mobilite' && r.lat && r.lon);
  }).catch(() => { state.services = []; });
}
function loadFiness(contour) {
  return fetch(CFG.finessFile).then(r => r.json()).then(all => {
    state.finess = all.filter(r => { try { return turf.booleanPointInPolygon(turf.point([r.lon, r.lat]), contour); } catch { return false; } });
  }).catch(() => { state.finess = []; });
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
    ['Sénateurs', e.senateurs?.length ? e.senateurs.map(s => `${s.prenom} ${s.nom}`).join(' · ') : null]
  ].filter(([, v]) => v) : [];

  const risquesHtml = state.risques.length
    ? state.risques.map(r => `<span class="risque-pill">${escapeHtml(r.libelle_risque_long)}</span>`).join('')
    : '<span class="risque-pill none">Aucun risque référencé à ce jour</span>';

  const territoireRows = [
    state.zan ? ['Surface artificialisée depuis 2011', `${formatNumber(Math.round(state.zan.total / 100) / 10)} ha`] : null,
    state.eau ? ['Réseaux de distribution (UDI) suivis', `${formatNumber(state.eau.reseaux)}${state.eau.reseau ? ' · ' + state.eau.reseau : ''}`] : null,
    state.energie ? [`Électricité résidentielle ${state.energie.annee}`, `${formatNumber(Math.round(state.energie.conso))} MWh · ${formatNumber(state.energie.sites)} sites`] : null
  ].filter(Boolean);

  $('drawer-body').innerHTML = `
    <section class="result-section"><h3>Chiffres clés</h3><dl class="data-grid">${kpiRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
    ${elusRows.length ? `<section class="result-section"><h3>Élus et gouvernance</h3><dl class="data-grid">${elusRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>` : ''}
    <section class="result-section"><h3>Risques majeurs recensés</h3><div class="risque-pills">${risquesHtml}</div><p class="source-note">Géorisques · GASPAR — consulter <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noreferrer">georisques.gouv.fr</a> pour le détail réglementaire.</p></section>
    ${territoireRows.length ? `<section class="result-section"><h3>Artificialisation, eau et énergie</h3><dl class="data-grid">${territoireRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Cerema · Hub’Eau · Agence ORE — voir les lectures <a href="https://ddt95.github.io/artificialisation-zan95/" target="_blank" rel="noreferrer">ZAN</a>, <a href="https://ddt95.github.io/eau95/" target="_blank" rel="noreferrer">Eau</a> et <a href="https://ddt95.github.io/transition-energetique95/" target="_blank" rel="noreferrer">Transition énergétique</a> pour le détail.</p></section>` : ''}
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

// ---------- Couches, regroupées par thème (une par lecture de l'Atlas) ----------
function setupDynamicLayers() {
  state.layerDefs = [
    { id: 'qpv', group: 'Politique de la ville', label: 'Quartiers prioritaires (QPV)', description: `${state.qpv.length ? state.qpv.length + ' quartier(s) recensé(s)' : 'Aucun QPV recensé dans cette commune'} · ANCT`, color: '#c1443c', active: state.qpv.length > 0, disabled: state.qpv.length === 0, kind: 'static' },
    { id: 'ecoles', group: 'Services publics', label: 'Établissements scolaires', description: 'Écoles, collèges, lycées publics et privés sous contrat · data.education.gouv.fr', color: '#c76524', active: true, kind: 'commune' },
    ...Object.entries(SERVICE_CATS).map(([cat, meta]) => ({ id: 'svc_' + cat, group: 'Services publics', label: meta.label, description: 'Service-Public.gouv.fr / OpenStreetMap · acces-services95', color: meta.color, active: cat === 'france_services' || cat === 'administration', kind: 'commune' })),
    ...Object.entries(FINESS_CATS).map(([cat, meta]) => ({ id: 'san_' + cat, group: 'Santé & solidarité', label: meta.label, description: 'Répertoire FINESS · ministère de la Santé', color: meta.color, active: cat === 'hopitaux' || cat === 'medecins', kind: 'commune' })),
    { id: 'coursEau', group: 'Eau', label: 'Cours d’eau', description: 'DDT 95 · arrêté préfectoral 2017-13817', color: '#0063cb', active: true, kind: 'commune' },
    { id: 'stationsEau', group: 'Eau', label: 'Stations de mesure', description: 'DDT 95 · qualité de l’eau', color: '#e4794a', active: false, kind: 'commune' },
    { id: 'batiments', group: 'Urbanisme et bâti', label: 'Bâtiments', description: 'Référentiel National des Bâtiments — tous bâtiments recensés', color: '#18753c', active: false, kind: 'zoom' },
    { id: 'cadastre', group: 'Urbanisme et bâti', label: 'Parcelles cadastrales', description: 'APICarto IGN — cadastre', color: '#6a4c93', active: false, kind: 'zoom' },
    { id: 'gpu', group: 'Urbanisme et bâti', label: 'Zonage PLU', description: 'Géoportail de l’urbanisme — zones du document d’urbanisme', color: '#0d5c63', active: false, kind: 'zoom' },
    { id: 'rpg', group: 'Agriculture', label: 'Parcelles agricoles (RPG)', description: 'Registre parcellaire graphique · APICarto IGN', color: '#8a9a3b', active: false, kind: 'zoom' },
    { id: 'znieff1', group: 'Biodiversité', label: 'ZNIEFF de type I', description: 'Secteurs de grand intérêt biologique · APICarto IGN', color: '#e4792f', active: false, kind: 'commune' },
    { id: 'znieff2', group: 'Biodiversité', label: 'ZNIEFF de type II', description: 'Grands ensembles naturels riches · APICarto IGN', color: '#f2b37f', active: false, kind: 'commune' },
    { id: 'pnr', group: 'Biodiversité', label: 'Parcs naturels régionaux', description: 'Vexin français, Oise–Pays de France · APICarto IGN', color: '#2f6f3e', active: false, kind: 'commune' },
    { id: 'rnn', group: 'Biodiversité', label: 'Réserves naturelles', description: 'Réserves naturelles nationales · APICarto IGN', color: '#006a6f', active: false, kind: 'commune' },
    { id: 'foretsPubliques', group: 'Biodiversité', label: 'Forêts publiques', description: 'IGN BD TOPO · ONF', color: '#174f2d', active: false, kind: 'commune' },
    { id: 'jardins', group: 'Biodiversité', label: 'Jardins remarquables', description: 'Ministère de la Culture · Région Île-de-France', color: '#95c11f', active: false, kind: 'commune' },
    { id: 'busIdfm', group: 'Transports', label: 'Arrêts de bus', description: 'Île-de-France Mobilités', color: '#0063cb', active: false, kind: 'commune' },
    { id: 'railIdfm', group: 'Transports', label: 'Gares et stations (rail/tram)', description: 'Île-de-France Mobilités', color: '#000091', active: true, kind: 'commune' },
    { id: 'routes', group: 'Transports', label: 'Routes principales', description: 'DDT 95 · réseau routier', color: '#68737d', active: false, kind: 'commune' },
    { id: 'inondation', group: 'Risques naturels', label: 'Zonage inondation (PPRI)', description: 'Géorisques · plans de prévention approuvés', color: '#1479c9', active: false, kind: 'wms', wms: 'PPRN_ZONE_INOND' },
    { id: 'mvt', group: 'Risques naturels', label: 'Mouvement de terrain (PPRN)', description: 'Géorisques · plans de prévention approuvés', color: '#7a4a1e', active: false, kind: 'wms', wms: 'PPRN_ZONE_MVT' },
    { id: 'argiles', group: 'Risques naturels', label: 'Retrait-gonflement des argiles', description: 'Géorisques · aléa cartographié', color: '#e76f00', active: false, kind: 'wms', wms: 'ALEARG_REALISE' }
  ];

  buildQpvLayer();
  buildCommuneLayer('ecoles', buildEcoles);
  Object.keys(SERVICE_CATS).forEach(cat => buildCommuneLayer('svc_' + cat, () => buildServiceLayer(cat)));
  Object.keys(FINESS_CATS).forEach(cat => buildCommuneLayer('san_' + cat, () => buildFinessLayer(cat)));
  buildCommuneLayer('coursEau', buildCoursEau);
  buildCommuneLayer('stationsEau', buildStationsEau);
  buildCommuneLayer('znieff1', () => buildNature('znieff1', 'znieff1'));
  buildCommuneLayer('znieff2', () => buildNature('znieff2', 'znieff2'));
  buildCommuneLayer('pnr', () => buildNature('pnr', 'pnr'));
  buildCommuneLayer('rnn', () => buildNature('rnn', 'rnn'));
  buildCommuneLayer('foretsPubliques', buildForetsPubliques);
  buildCommuneLayer('jardins', buildJardins);
  buildCommuneLayer('busIdfm', () => buildIdfmArrets('busIdfm', 'bus'));
  buildCommuneLayer('railIdfm', () => buildIdfmArrets('railIdfm', ['rail', 'tram']));
  buildCommuneLayer('routes', buildRoutes);
  buildWmsLayers();

  map.off('moveend', refreshDetailLayers);
  map.on('moveend', refreshDetailLayers);
  refreshDetailLayers();
}

function buildQpvLayer() {
  if (state.layers.qpv) { map.removeLayer(state.layers.qpv); }
  if (!state.qpv.length) { state.layers.qpv = null; return; }
  state.layers.qpv = L.geoJSON({ type: 'FeatureCollection', features: state.qpv }, {
    style: { color: '#c1443c', weight: 2, opacity: 0.9, fillColor: '#c1443c', fillOpacity: 0.22 },
    onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.libelle || 'Quartier prioritaire', { sticky: true })
  });
  if (state.layerDefs.find(l => l.id === 'qpv')?.active) state.layers.qpv.addTo(map);
}

function buildCommuneLayer(id, fetcher) {
  fetcher().then(layer => {
    state.layers[id] = layer;
    if (layer && state.layerDefs.find(l => l.id === id)?.active) layer.addTo(map);
    updateLegend();
  }).catch(error => { console.warn(id + ' indisponible', error); });
}

function buildEcoles() {
  return fetch(`${CFG.educationApi}?dataset=fr-en-annuaire-education&refine.code_commune=${state.code}&rows=200`).then(r => r.json()).then(d => {
    const records = (d.records || []).filter(r => r.fields.etat === 'OUVERT' && r.fields.latitude && r.fields.longitude);
    if (!records.length) return null;
    return L.layerGroup(records.map(r => {
      const f = r.fields;
      const isPriv = f.statut_public_prive === 'Privé';
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker school${isPriv ? ' alt' : ''}">${(f.type_etablissement || 'É')[0]}</div>`, iconSize: [22, 22] });
      return L.marker([f.latitude, f.longitude], { icon }).bindPopup(`<strong>${escapeHtml(f.nom_etablissement)}</strong><br>${escapeHtml(f.type_etablissement)} · ${escapeHtml(f.statut_public_prive)}<br>${escapeHtml(f.adresse_1 || '')}`);
    }));
  });
}

function buildServiceLayer(category) {
  const records = state.services.filter(r => r.category === category);
  if (!records.length) return Promise.resolve(null);
  const meta = SERVICE_CATS[category];
  return Promise.resolve(L.layerGroup(records.map(r => {
    const icon = L.divIcon({ className: '', html: `<div class="theme-marker svc" style="background:${meta.color}">${meta.label[0]}</div>`, iconSize: [22, 22] });
    return L.marker([r.lat, r.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.name)}</strong><br>${escapeHtml(r.typeLabel || meta.label)}<br>${escapeHtml(r.address || '')}`);
  })));
}

function buildFinessLayer(category) {
  const records = state.finess.filter(r => r.cat === category);
  if (!records.length) return Promise.resolve(null);
  const meta = FINESS_CATS[category];
  return Promise.resolve(L.layerGroup(records.map(r => {
    const icon = L.divIcon({ className: '', html: `<div class="theme-marker svc" style="background:${meta.color}">${r.urgences ? '+' : meta.label[0]}</div>`, iconSize: [22, 22] });
    return L.marker([r.lat, r.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.nom)}</strong><br>${escapeHtml(meta.label)}${r.urgences ? ' · Urgences' : ''}<br>${escapeHtml(r.adresse)}${r.tel ? '<br>' + escapeHtml(r.tel) : ''}`);
  })));
}

function buildCoursEau() {
  if (!state.contour) return Promise.resolve(null);
  return fetch(CFG.eauCoursEau).then(r => r.json()).then(d => {
    const features = (d.features || []).filter(f => { try { return turf.booleanIntersects(f, state.contour); } catch { return false; } });
    if (!features.length) return null;
    return L.geoJSON({ type: 'FeatureCollection', features }, {
      style: { color: '#0063cb', weight: 2, opacity: 0.85 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.NOM || 'Cours d’eau', { sticky: true })
    });
  }).catch(() => null);
}

function buildStationsEau() {
  if (!state.contour) return Promise.resolve(null);
  return fetch(CFG.eauStations).then(r => r.json()).then(d => {
    const features = (d.features || []).filter(f => { try { return turf.booleanPointInPolygon(f, state.contour); } catch { return false; } });
    if (!features.length) return null;
    return L.layerGroup(features.map(f => {
      const [lon, lat] = f.geometry.coordinates;
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker" style="background:#e4794a">S</div>', iconSize: [22, 22] });
      return L.marker([lat, lon], { icon }).bindPopup(`<strong>${escapeHtml(f.properties?.LbStationM || 'Station de mesure')}</strong><br>${escapeHtml(f.properties?.NomCoursdE || '')}`);
    }));
  }).catch(() => null);
}

function buildNature(id, endpoint) {
  return fetch(`${CFG.natureApi}/${endpoint}?code_insee=${state.code}`).then(r => r.ok ? r.json() : { features: [] }).then(d => {
    const features = d.features || [];
    if (!features.length) return null;
    const def = state.layerDefs.find(l => l.id === id);
    return L.geoJSON(d, {
      style: { color: def.color, weight: 1.5, opacity: 0.9, fillColor: def.color, fillOpacity: 0.2 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.nom || f.properties?.nom_site || def.label, { sticky: true })
    });
  });
}

function buildForetsPubliques() {
  if (!state.contour) return Promise.resolve(null);
  const b = L.geoJSON(state.contour).getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},EPSG:4326`;
  const url = `${CFG.geopfWfs}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:foret_publique&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&BBOX=${encodeURIComponent(bbox)}`;
  return fetch(url).then(r => r.ok ? r.json() : { features: [] }).then(d => {
    if (!d.features?.length) return null;
    return L.geoJSON(d, {
      style: { color: '#174f2d', weight: 2, opacity: 1, fillColor: '#174f2d', fillOpacity: 0.15 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.toponyme || 'Forêt publique', { sticky: true })
    });
  }).catch(() => null);
}

function buildJardins() {
  const url = new URL(CFG.jardinsApi);
  url.searchParams.set('where', `code_commune="${state.code}"`);
  url.searchParams.set('limit', '50');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.results || [];
    if (!records.length) return null;
    return L.layerGroup(records.filter(r => r.latitude && r.longitude).map(r => {
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker" style="background:#95c11f">J</div>', iconSize: [22, 22] });
      return L.marker([r.latitude, r.longitude], { icon }).bindPopup(`<strong>${escapeHtml(r.nom_du_jardin)}</strong><br>${escapeHtml(r.adresse_complete || '')}`);
    }));
  });
}

let roadsCache = null;
function buildRoutes() {
  if (!state.contour) return Promise.resolve(null);
  const loadRoads = roadsCache || fetch(CFG.roadsFile).then(r => r.text()).then(t => JSON.parse(t.slice(t.indexOf('{'))));
  roadsCache = loadRoads;
  return loadRoads.then(fc => {
    const features = (fc.features || []).filter(f => { try { return turf.booleanIntersects(f, state.contour); } catch { return false; } });
    if (!features.length) return null;
    return L.geoJSON({ type: 'FeatureCollection', features }, {
      style: f => ({ color: '#68737d', weight: f.properties?.classement === 'Départementale' ? 2.5 : 1.5, opacity: 0.8 }),
      onEachFeature: (f, layer) => layer.bindTooltip(`${f.properties?.numero || ''} ${f.properties?.toponyme || ''}`.trim() || 'Route', { sticky: true })
    });
  }).catch(() => null);
}

function buildIdfmArrets(id, types) {
  const typeList = Array.isArray(types) ? types : [types];
  const whereType = typeList.map(t => `arrtype="${t}"`).join(' or ');
  const url = new URL(CFG.idfmArretsApi);
  url.searchParams.set('where', `arrtown="${state.nom}" and (${whereType})`);
  url.searchParams.set('limit', '100');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.results || [];
    if (!records.length) return null;
    const def = state.layerDefs.find(l => l.id === id);
    return L.layerGroup(records.filter(r => r.arrgeopoint).map(r => {
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker ${id === 'busIdfm' ? 'bus' : 'gare'}">${id === 'busIdfm' ? 'B' : 'G'}</div>`, iconSize: id === 'busIdfm' ? [20, 20] : [22, 22] });
      return L.marker([r.arrgeopoint.lat, r.arrgeopoint.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.arrname)}</strong><br>${escapeHtml(r.arrtype)} · ${escapeHtml(def.label)}`);
    }));
  });
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
  updateZoomNotice();
  if (map.getZoom() < CFG.zoomGated) return;
  if (state.layerDefs.find(l => l.id === 'batiments')?.active) loadBatiments();
  if (state.layerDefs.find(l => l.id === 'cadastre')?.active) loadCadastre();
  if (state.layerDefs.find(l => l.id === 'rpg')?.active) loadRpg();
  if (state.layerDefs.find(l => l.id === 'gpu')?.active) loadGpu();
}

function updateZoomNotice() {
  const pending = state.layerDefs.filter(l => l.kind === 'zoom' && l.active).map(l => l.label);
  const el = $('map-intro');
  if (map.getZoom() < CFG.zoomGated && pending.length) {
    el.hidden = false;
    el.querySelector('strong').textContent = 'Zoomez pour afficher';
    el.querySelector('span').textContent = `${pending.join(', ')}. Ces couches se chargent uniquement à l’échelle de la rue.`;
  } else {
    el.hidden = true;
  }
}

function bboxGeom(b) {
  return { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] };
}

async function loadBatiments() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try {
    let url = `${CFG.rnbApi}?bbox=${bbox}&limit=100`;
    let all = [];
    for (let page = 0; page < 8 && url; page++) {
      const data = await fetch(url).then(r => r.json());
      all = all.concat(data.features || []);
      url = (data.links || []).find(l => l.rel === 'next')?.href || null;
    }
    if (state.layers.batiments) map.removeLayer(state.layers.batiments);
    state.layers.batiments = L.geoJSON({ type: 'FeatureCollection', features: all }, {
      style: { color: '#18753c', weight: 1, opacity: 0.9, fillColor: '#18753c', fillOpacity: 0.35 },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, color: '#18753c', weight: 1, fillColor: '#18753c', fillOpacity: 0.7 }),
      onEachFeature: (f, layer) => layer.on('click', e => { L.DomEvent.stopPropagation(e); openBuildingDrawer(f); })
    });
    if (state.layerDefs.find(l => l.id === 'batiments')?.active) state.layers.batiments.addTo(map);
  } catch (error) { console.warn('RNB indisponible', error); }
}

async function loadCadastre() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    let response;
    try {
      response = await fetch(`${CFG.cadastreApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    } catch {
      response = await fetch(CFG.cadastreApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.json());
    }
    const features = response?.features || [];
    if (state.layers.cadastre) map.removeLayer(state.layers.cadastre);
    state.layers.cadastre = L.geoJSON(features, {
      style: { color: '#6a4c93', weight: 1, opacity: 0.85, fillOpacity: 0 },
      onEachFeature: (f, layer) => layer.bindTooltip(`Parcelle ${f.properties?.section || ''}${f.properties?.numero || ''}`, { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'cadastre')?.active) state.layers.cadastre.addTo(map);
  } catch (error) { console.warn('Cadastre indisponible', error); }
}

async function loadRpg() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    const data = await fetch(`${CFG.rpgApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    if (state.layers.rpg) map.removeLayer(state.layers.rpg);
    state.layers.rpg = L.geoJSON(data, {
      style: { color: '#8a9a3b', weight: 1, opacity: 0.9, fillColor: '#8a9a3b', fillOpacity: 0.3 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.code_cultu ? `Culture ${f.properties.code_cultu}` : 'Parcelle RPG', { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'rpg')?.active) state.layers.rpg.addTo(map);
  } catch (error) { console.warn('RPG indisponible', error); }
}

async function loadGpu() {
  try {
    const data = await fetch(`${CFG.gpuApi}?partition=DU_${state.code}`).then(r => r.ok ? r.json() : { features: [] });
    if (state.layers.gpu) map.removeLayer(state.layers.gpu);
    state.layers.gpu = L.geoJSON(data, {
      style: { color: '#0d5c63', weight: 1, opacity: 0.85, fillColor: '#0d5c63', fillOpacity: 0.15 },
      onEachFeature: (f, layer) => layer.bindTooltip(`Zone ${f.properties?.libelle || ''} — ${f.properties?.libelong || f.properties?.typezone || ''}`, { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'gpu')?.active) state.layers.gpu.addTo(map);
  } catch (error) { console.warn('GPU indisponible', error); }
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
  $('drawer-body').innerHTML = `<section class="result-section"><h3>Bâtiment</h3><dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section><section class="result-section" id="bdnbSection"><h3>DPE, logement social et risques (BDNB)</h3><p class="source-note">Recherche en cours…</p></section>`;
  $('drawer-actions').innerHTML = `<button id="drawer-back" type="button">← Retour à la fiche commune</button>`;
  $('drawer-back').onclick = () => renderFicheDrawer(true);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  if (feature.id) loadBdnb(feature.id);
}

async function loadBdnb(rnbId) {
  const section = $('bdnbSection');
  try {
    const rel = await fetch(`${CFG.bdnbApi}/donnees/batiment_construction?rnb_id=eq.${rnbId}&select=batiment_groupe_id&limit=1`).then(r => r.json());
    const groupId = rel?.[0]?.batiment_groupe_id;
    if (!groupId) { section.innerHTML = '<h3>DPE, logement social et risques (BDNB)</h3><p class="source-note">Aucune correspondance BDNB pour ce bâtiment.</p>'; return; }
    const [dpe, rpls, risks] = await Promise.all([
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_dpe_representatif_logement?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null),
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_rpls?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null),
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_risques?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null)
    ]);
    const rows = [
      dpe?.classe_bilan_dpe ? ['DPE — classe énergie', dpe.classe_bilan_dpe] : null,
      dpe?.classe_emission_ges ? ['DPE — classe GES', dpe.classe_emission_ges] : null,
      dpe?.annee_construction_dpe ? ['Année de construction', dpe.annee_construction_dpe] : null,
      rpls?.nb_log ? ['Logements du parc social (RPLS)', formatNumber(rpls.nb_log)] : null,
      risks?.alea_argile ? ['Aléa retrait-gonflement argiles', risks.alea_argile] : null,
      risks?.alea_radon ? ['Aléa radon', risks.alea_radon] : null,
      risks?.alea_sismique ? ['Aléa sismique', risks.alea_sismique] : null
    ].filter(Boolean);
    section.innerHTML = `<h3>DPE, logement social et risques (BDNB)</h3>${rows.length ? `<dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>` : '<p class="source-note">Aucune donnée BDNB publiée pour ce bâtiment.</p>'}<p class="source-note">Base de Données Nationale des Bâtiments — voir aussi <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a>.</p>`;
  } catch (error) {
    section.innerHTML = '<h3>DPE, logement social et risques (BDNB)</h3><p class="source-note">Interrogation BDNB indisponible pour le moment.</p>';
  }
}

// ---------- Panneau de couches, regroupé par thème ----------
function renderControls() {
  const root = $('layer-list');
  const groups = [...new Set(state.layerDefs.map(x => x.group))];
  root.innerHTML = groups.map(group => `<div class="layer-group"><strong>${group}</strong>${state.layerDefs.filter(x => x.group === group).map(x => `<div class="layer-row" data-layer-row="${x.id}" style="${x.disabled ? 'opacity:.5;pointer-events:none' : ''}"><button class="switch" type="button" data-layer="${x.id}" aria-label="Afficher ${x.label}" aria-pressed="${x.active}"></button><div class="layer-copy"><strong>${x.label}</strong><span>${x.description}${x.kind === 'zoom' ? ' · zoomez pour afficher' : ''}</span></div><i class="swatch" style="background:${x.color}"></i></div>`).join('')}</div>`).join('');
  root.querySelectorAll('[data-layer-row]').forEach(row => row.addEventListener('click', () => toggleLayer(row.dataset.layerRow)));
  updateLegend();
  updateZoomNotice();
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
  const layer = state.layers[id];
  if (def.active) {
    if (layer) layer.addTo(map);
    if (def.kind === 'zoom' && map.getZoom() >= CFG.zoomGated) {
      if (id === 'batiments') loadBatiments(); else if (id === 'cadastre') loadCadastre(); else if (id === 'rpg') loadRpg(); else if (id === 'gpu') loadGpu();
    }
  } else if (layer) {
    map.removeLayer(layer);
  }
  updateLegend();
  updateZoomNotice();
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

async function buildPrintSheet() {
  renderFicheDrawer(true);
  let mapImg = '';
  try {
    map.invalidateSize();
    await new Promise(r => setTimeout(r, 300));
    const canvas = await html2canvas(document.getElementById('map'), { useCORS: true, scale: 1.5 });
    mapImg = `<img class="ps-map" src="${canvas.toDataURL('image/jpeg', 0.9)}" alt="Carte de ${escapeHtml(state.nom)}">`;
  } catch (error) { console.warn('Capture carte indisponible', error); }
  const sections = $('drawer-body').innerHTML;
  $('printSheet').innerHTML = `
    <div class="ps-head"><img src="prefet-val-doise.svg" alt=""><div><span>PORTAIL COMMUNAL · VAL-D’OISE</span><strong>${escapeHtml(state.nom || 'Commune')}</strong></div></div>
    ${mapImg}
    ${sections}
    <p class="ps-foot">Fiche générée le ${new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })} · ${location.href} · DDT du Val-d’Oise</p>
  `;
}

$('printProfile').addEventListener('click', async () => {
  exportDialog.close();
  await buildPrintSheet();
  document.body.classList.add('print-mode');
  setTimeout(() => {
    window.print();
    document.body.classList.remove('print-mode');
  }, 50);
});

$('makePdf').addEventListener('click', async () => {
  exportDialog.close();
  document.body.classList.add('exporting');
  const pdfWindow = window.open('', '_blank');
  if (pdfWindow) pdfWindow.document.write('<title>Génération du PDF…</title><body style="font-family:sans-serif;padding:60px;color:#10104b">Génération de la fiche PDF en cours…</body>');
  try {
    await buildPrintSheet();
    document.body.classList.add('print-mode');
    const blob = await html2pdf().set({
      margin: 8,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(document.getElementById('printSheet')).outputPdf('blob');
    const url = URL.createObjectURL(blob);
    if (pdfWindow && !pdfWindow.closed) pdfWindow.location.href = url; else window.open(url, '_blank', 'noopener');
  } finally {
    document.body.classList.remove('exporting');
    document.body.classList.remove('print-mode');
  }
});
