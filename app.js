const params = new URLSearchParams(location.search);
const requestedCode = params.get("code") || "";
const requestedName = params.get("nom") || "";
const select = document.getElementById("communeSelect");
const selectedLabel = document.getElementById("selectedCommune");

function showCommune(name, code) {
  if (!name) return;
  document.getElementById("pageTitle").innerHTML = `${name}.<br><span>Sa fiche territoriale.</span>`;
  document.getElementById("pageLead").textContent = `Première lecture communale pour ${name} (code INSEE ${code}), avant comparaison et accès aux fiches actions.`;
  selectedLabel.textContent = `Fiche de ${name} · ${code}`;
}

fetch("https://geo.api.gouv.fr/departements/95/communes?fields=nom,code")
  .then((response) => response.json())
  .then((communes) => {
    communes.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    select.innerHTML = '<option value="">Sélectionner une commune</option>' + communes.map((commune) => `<option value="${commune.code}">${commune.nom}</option>`).join("");
    const selected = communes.find((commune) => commune.code === requestedCode);
    if (selected) { select.value = selected.code; showCommune(selected.nom, selected.code); }
    else if (requestedName) showCommune(requestedName, requestedCode || "—");
  });

document.getElementById("communeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const option = select.options[select.selectedIndex];
  if (!select.value) return;
  const next = new URL(location.href);
  next.search = new URLSearchParams({ code: select.value, nom: option.textContent }).toString();
  location.href = next.toString();
});
