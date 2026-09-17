# Livraison corrective Studio 0.11.7 — 17 septembre 2026

**État : construction et qualification en cours. Aucune publication 0.11.7
n'est encore attestée dans ce rapport.**

- Produit et tag : `bf6d7b13fda815b7f8153350e36907910829c4c6` / `0.11.7`.
- [Workflow de release 35247378499](https://github.com/GBeurier/nirs4all-studio/actions/runs/35247378499).
- [CI du même commit](https://github.com/GBeurier/nirs4all-studio/actions/runs/35247375971).
- [E2E du même commit](https://github.com/GBeurier/nirs4all-studio/actions/runs/35247375954).

La [candidate 0.11.6](studio-delivery-0.11.6-2026-09-17.md) n'a pas été publiée :
son contrôle Linux refusait un chemin de bibliothèque valide contenant un espace.
Le correctif conserve le confinement des dépendances. Neuf tests ciblés passent,
dont deux nouveaux cas avec de véritables ELF : une bibliothèque embarquée est
acceptée, une bibliothèque extérieure est refusée. Le tag 0.11.6 reste immuable.

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
| Windows x64 | 0.11.5 → 0.11.7 | Installation NSIS, setup/UI, migration et redémarrage hors ligne |
| Linux x64 | 0.11.5 → 0.11.7 | Installation DEB, setup/UI, migration et redémarrage hors ligne |
| macOS Apple Silicon | 0.11.5 → 0.11.7 | Installation DMG, setup/UI, migration et redémarrage hors ligne |
| macOS Intel | 0.11.4 → 0.11.7 | Installation DMG, setup/UI, migration et redémarrage hors ligne |
| Docker Linux amd64 CPU | Image construite et testée une seule fois | Smoke API/WebSocket/Chromium puis promotion de l'image qualifiée |

La baseline Intel diffère parce qu'aucun fichier Intel 0.11.5 n'a été publié.
Le nouveau gate Unix sélectionne la dernière archive publique complète par
plateforme, vérifie les identités des fichiers avant et après la migration,
et lie les résultats aux SHA256 source et cible. Tout échec, annulation ou gate
ignoré bloque la publication stable GitHub et Docker.

## Vérifications du commit final

La CI complète et les E2E ont réussi sur le SHA exact du tag, `bf6d7b13` :

- Frontend : **4 179 réussis, 1 ignoré**, 586 fichiers de tests.
- Scripts de packaging : **38 réussis**.
- Backend : **2 491 réussis, 17 ignorés**.
- Rust Windows : **313 réussis, 5 ignorés**, 14 exécutables de tests.
- Chromium : **63 réussis**, 9,8 minutes ; run `35247375954`, job
  `105290894166`, artefact `playwright-report` `10508471477`.

L'archive Linux a passé son contrôle CPU isolé le 17 septembre à 16:50:46 UTC :
**414 ELF**, calculs SHAP et réduction parallèle Numba avec le moteur `workqueue`.
Les modes forcés TBB/OpenMP/safe ne sont pas garantis par cette qualification.
[Preuve JSON exacte](studio-linux-archive-cpu-closure-0.11.7-2026-09-17.json),
[artefact source](https://github.com/GBeurier/nirs4all-studio/actions/runs/35247378499/artifacts/10509051147).
Cette preuve ne remplace pas l'installation DEB ni un lancement AppImage par FUSE.
Le runtime de l'installateur a passé le même contrôle à 16:54:53 UTC, également
sur **414 ELF** : [preuve exacte de l'installateur](studio-linux-installer-cpu-closure-0.11.7-2026-09-17.json).

## Vérifications locales de la reprise

- `npm run lint:parallel` : réussi, 21 avertissements ESLint préexistants.
- `npm run test:parallel` : **4 180 tests frontend**, **2 505 backend**, 1 ignoré (avant les deux nouveaux tests ELF mentionnés ci-dessus).
- `npm run test:e2e` : **63 tests navigateur** (avant l'élargissement du délai
  documentaire ; les E2E du commit final sont relancés dans Actions).
- Cargo : **344 tests réussis, 5 ignorés**, avec le runtime Methods explicitement
  configuré et quatre threads ; formatage et Clippy réussis.
- Scripts de packaging : **38 tests réussis**.

Les résultats locaux ne remplacent pas les qualifications des paquets réels.
Les fichiers publics 0.11.5 ne sont ni remplacés ni reconstruits.

Le smoke du produit installé exerce aussi le parcours dataset d'origine :
métadonnée vide, correction locale du séparateur et de l'en-tête, présence de
`sample_id` parmi les identifiants, conservation de l'agrégation après
enregistrement, puis aperçu et rafraîchissement du dataset sauvegardé.
