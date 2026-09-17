# Livraison corrective Studio 0.11.6 — 17 septembre 2026

**État : candidate non publiée. La qualification Linux a bloqué la livraison.**

- Produit et tag : `244382e10f8576b7cd1d05ea50466d237cc60a9f` / `0.11.6`.
- [Workflow de release 35245572991](https://github.com/GBeurier/nirs4all-studio/actions/runs/35245572991).
- [CI du même commit](https://github.com/GBeurier/nirs4all-studio/actions/runs/35245571964).
- [E2E du même commit](https://github.com/GBeurier/nirs4all-studio/actions/runs/35245572149).

## Blocage de la candidate

Le job d'archive Linux `105285379506` a construit et extrait le paquet, puis
réussi le smoke d'extraction. Le 17 septembre à **16:30:07 UTC**, le contrôle
de fermeture CPU a refusé une ligne `ldd` valide : une dépendance absolue
`libpython` était située dans le répertoire `nirs4all Studio`, dont l'espace
n'était pas accepté par le parseur du harnais. Aucun fichier 0.11.6 n'a été
publié. Le tag est conservé ; le correctif de ce contrôle et les correctifs
produit ci-dessous seront qualifiés sous une nouvelle version.

## Correctifs

- Les processus Python frais utilisés pour inspecter les paquets, prévisualiser
  les datasets et traduire les documents bénéficient du budget d'import à froid
  de 45 secondes déjà utilisé au démarrage. Les attestations restent obligatoires,
  les processus restent bornés et les prédictions conservent leur délai de 120 s.
- Les erreurs API du premier setup sont affichées avec leur détail. Le test du
  produit installé détecte immédiatement une erreur du setup et conserve le
  diagnostic HTTP borné et expurgé.
- La découverte des capacités et les préférences restent disponibles pendant
  les vérifications Python lentes.
- Le runtime Intel macOS utilise les roues NumPy/Numba/llvmlite compatibles.

Le [diagnostic Intel de l'ancien paquet](studio-macintel-first-launch-diagnostic-2026-09-17.json)
prouve des `python_host_timed_out` sur la comparaison de paquets et l'aperçu
dataset. La correction a été reproduite dans les tests comportementaux avec
des workers volontairement ralentis ; seul le nouveau paquet pourra confirmer
sa résolution dans le produit distribué.

## Qualifications requises avant publication

| Plateforme | Migration publique requise | Contrôle du produit |
| --- | --- | --- |
| Windows x64 | 0.11.5 → 0.11.6 | Installation NSIS, setup/UI, migration et redémarrage hors ligne |
| Linux x64 | 0.11.5 → 0.11.6 | Installation DEB, setup/UI, migration et redémarrage hors ligne |
| macOS Apple Silicon | 0.11.5 → 0.11.6 | Installation DMG, setup/UI, migration et redémarrage hors ligne |
| macOS Intel | 0.11.4 → 0.11.6 | Installation DMG, setup/UI, migration et redémarrage hors ligne |
| Docker Linux amd64 CPU | Image construite et testée une seule fois | Smoke API/WebSocket/Chromium puis promotion de l'image qualifiée |

La baseline Intel diffère parce qu'aucun fichier Intel 0.11.5 n'a été publié.
Le nouveau gate Unix sélectionne la dernière archive publique complète par
plateforme, vérifie les identités des fichiers avant et après la migration,
et lie les résultats aux SHA256 source et cible. Tout échec, annulation ou gate
ignoré bloque la publication stable GitHub et Docker.

## Vérifications locales avant le tag

- `npm run lint:parallel` : réussi, 21 avertissements ESLint préexistants.
- `npm run test:parallel` : **4 180 tests frontend**, **2 505 backend**, 1 ignoré.
- `npm run test:e2e` : **63 tests navigateur** (avant l'élargissement du délai
  documentaire ; les E2E du commit final sont relancés dans Actions).
- Cargo : **344 tests réussis, 5 ignorés**, avec le runtime Methods explicitement
  configuré et quatre threads ; formatage et Clippy réussis.
- Scripts de packaging : **38 tests réussis**.

Les résultats locaux ne remplacent pas les qualifications des paquets réels.
Les fichiers publics 0.11.5 ne sont ni remplacés ni reconstruits.
