# Reprise après crash WSL — 17 septembre 2026

La session interrompue est **« Corriger les bugs de nirs4all-studio »**, identifiant
`01a0aeab-f117-7872-987a-a04a8deefa54`, commencée à 11:21 heure de Paris.
Les messages et commandes ont été retrouvés dans l'historique local Codex.
La reprise commence à 17:47 heure de Paris.

## Demande et état récupérés

La demande porte sur le mode développeur, le parsing des datasets, les NA des
métadonnées, les identifiants de répétitions et la fiabilité de l'installation
des paquets. L'utilisateur a ensuite demandé une livraison Windows urgente,
puis le suivi macOS, Linux et Docker, avec plusieurs agents en parallèle.

Windows, Linux x64, macOS Apple Silicon et Docker amd64 CPU 0.11.5 ont été
livrés avant le crash. Les preuves et limites figurent dans le
[rapport multiplateforme](studio-multiplatform-delivery-0.11.5-2026-09-17.md)
et l'[audit des installations](studio-package-test-audit-2026-09-17.md).
L'inventaire public GitHub a été revérifié lors de cette reprise.

Le dernier message de l'ancienne session, à 15:04 UTC, indiquait un échec HTTP
du premier setup Mac Intel. Son archive avait passé les contrôles scientifiques
et la migration réelle 0.11.4 → 0.11.5 ; le DMG échouait sur le premier écran
de vérification. La publication Intel a été bloquée par le gate correspondant.

## Travail repris

- Les cinq modifications héritées concernant les preuves Linux ont été relues.
  Les preuves JSON correspondent exactement aux artefacts du run `35234849707`.
  Elles sont conservées dans le commit `f0b9d40a`.
- L'écran SetupWizard masquait les objets `ApiError` du transport. Cinq nouvelles
  régressions échouent avant correction et passent après ; les erreurs du serveur
  sont désormais affichées, y compris à la sauvegarde du setup. Commit `65653fc7`.
- Deux fichiers diagnostic étaient vides après le crash. Le script et son workflow
  ont été restaurés et validés dans `fa7b5822`. Ils utilisent l'archive Intel exacte,
  vérifiée par SHA256 et provenance, sans reconstruire le produit. Une relance
  manuelle ne transforme jamais l'échec initial en qualification.
- Le [diagnostic Intel](https://github.com/GBeurier/nirs4all-studio/actions/runs/35243553221)
  a confirmé deux refus `python_host_timed_out` sur le paquet exact : HTTP 503
  pour `config/diff` au premier setup et après retry, puis HTTP 400 pour l'aperçu
  d'un dataset. Inventaire des paquets et cohérence du runtime répondent HTTP 200.
  Les [preuves Intel résumées](studio-macintel-first-launch-diagnostic-2026-09-17.json)
  conservent les identités des artefacts, routes et durées exactes.
- Une incohérence de délais a été reproduite sur le runtime Linux attesté : avec
  son processus Python suspendu 17 secondes, le préflight accepte le runtime dans
  son budget de 45 secondes, mais l'inventaire des paquets échoue en 15,122 secondes
  avec HTTP 503 `python_host_timed_out`. Un premier correctif limité au setup fait
  réussir la même requête retardée en 21,259 secondes. Le diagnostic Intel a ensuite
  montré que l'aperçu des datasets nécessite aussi ce délai de démarrage : le
  correctif final aligne toutes les opérations documentaires à 45 secondes,
  conserve les prédictions à 120 secondes et ne change aucune attestation.
  Les [observations locales avant/après](studio-setup-timeout-regression-2026-09-17.json)
  sont conservées, avec les identités des binaires et du runtime utilisé.
- Le smoke de premier lancement signale immédiatement les erreurs de la carte de
  vérification, avec méthode, URL et erreur HTTP expurgées et bornées. Une erreur
  apparue dans Chromium interrompt l'attente en 208 ms ; les alertes extérieures à
  cette carte sont ignorées. Onze régressions couvrent ces comportements.
- Le workflow stable doit désormais qualifier les trois produits Unix installés,
  puis migrer la précédente version réellement disponible sur chaque plateforme.
  Pour 0.11.6, Linux et Apple Silicon partent de 0.11.5, Intel de 0.11.4. Les
  résultats sont liés aux empreintes des archives source et cible ; un échec,
  une annulation ou un gate ignoré bloque la publication stable.

## Validation de la reprise

- `npm run lint:parallel` : réussi, 21 avertissements ESLint préexistants.
- `npm run test:parallel` : frontend **4 180 réussis** ; backend **2 505 réussis,
  1 ignoré**. Node Linux 24.16.0 ; concurrence limitée à quatre CPU.
- Contrats Linux/packaging ciblés : **14 pytest et 25 Vitest réussis**.
- `node --test scripts/tests/*.test.cjs scripts/tests/linux-installer-cycle.contract.cjs` :
  **38 réussis** ; nouveaux contrats de workflow Unix inclus dans la suite frontend.
- `npm run test:e2e` : **63 tests navigateur réussis**.
- `cargo test --manifest-path sidecar/Cargo.toml --locked -- --test-threads=4` :
  **344 réussis, 5 ignorés**, avec `N4M_LIBRARY_PATH` vers le binaire empaqueté
  et le Python système 3.11. Les premiers essais avaient omis le chemin Methods,
  puis sélectionné le lien symbolique du venv, refusé par le contrôle de l'hôte.
- `cargo fmt --check` et `cargo clippy --all-targets -- -D warnings` : réussis.
- Le diagnostic Mac Intel est terminé. La candidate 0.11.6 a été arrêtée après
  un faux refus du contrôle ELF Linux ; le correctif est livré dans la candidate
  0.11.7, dont les quatre installations réelles et migrations ont réussi.
- Docker 0.11.7 est publié et vérifié anonymement. La publication desktop reste
  bloquée sur les transferts GitHub ; voir le [rapport final de livraison](studio-delivery-0.11.7-2026-09-17.md),
  avec les preuves de chaque plateforme et les erreurs de transfert GitHub.

Les fichiers publics 0.11.5 restent inchangés. L'amélioration de réactivité
déjà présente sur `main` avant le crash est incluse dans les paquets 0.11.7
qualifiés, avec les correctifs de setup et de démarrage à froid de cette reprise.
