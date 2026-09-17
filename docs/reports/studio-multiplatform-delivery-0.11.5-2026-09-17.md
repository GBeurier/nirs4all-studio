# Livraison multiplateforme 0.11.5 — 17 septembre 2026

## État attesté

| Distribution | État | Preuve |
| --- | --- | --- |
| Windows x64 | Livrée, stable | [Rapport Windows](studio-delivery-0.11.5-2026-09-17.md) et [preuves](studio-delivery-0.11.5-evidence.json) |
| Docker Linux amd64 CPU | Livrée, `0.11.5` et `latest` | Qualification et contrôle public ci-dessous |
| Linux desktop x64 | Livrée : DEB, AppImage et archive | Installation DEB, UI et migration réelles réussies ; empreintes publiques vérifiées |
| macOS Apple Silicon | Livrée : DMG et archive | Installation DMG, UI et migration réelles réussies ; empreintes publiques vérifiées |
| macOS Intel | En attente | Compatibilité des roues Python et nouvelle qualification à compléter |

Le dernier contrôle public enregistré porte sur Linux desktop au **17 septembre 2026 à 13:48:18 UTC / 15:48:18 Paris** ; la qualification renforcée de l'AppImage s'est terminée à **13:54:21 UTC**. Chaque distribution dispose de ses propres qualifications. [Preuves structurées multiplateformes](studio-multiplatform-delivery-0.11.5-evidence.json).

## Livraison Linux desktop et macOS Apple Silicon

Les [deux qualifications réelles](https://github.com/GBeurier/nirs4all-studio/actions/runs/35227750924) ont réussi : installation du DEB ou du DMG, vérification scientifique hors ligne, premier setup, sauvegarde du mode développeur sans workspace, rechargement et redémarrage. L'updater de l'archive publique 0.11.4 a ensuite remplacé l'application par les octets exacts de 0.11.5 ; les calculs scientifiques, la disparition des fichiers obsolètes et le démarrage à froid hors ligne ont été vérifiés.

La [publication Apple Silicon](https://github.com/GBeurier/nirs4all-studio/actions/runs/35227919265) et la [publication Linux](https://github.com/GBeurier/nirs4all-studio/actions/runs/35227918753) ont ajouté les fichiers à la release existante, sans remplacer les fichiers Windows. Le contrôle public indépendant a vérifié les empreintes et les sidecars à **13:45:28 UTC** pour Apple Silicon et **13:48:18 UTC** pour Linux.

| Fichier | SHA256 |
| --- | --- |
| Linux DEB | `380069f5ab3fbe47a6bf23a541e01cf0e90e418fb903ddc61279b640afb6a9b5` |
| Linux AppImage | `e4be44160f80b654fa54d8d5aca2c824e7786ae8383a9d663c5ceae6d19f283f` |
| Linux archive de mise à jour | `c870a4d2248e9ae7ded017b14017df189f5feea70f45ed6935d5205f7e8639bf` |
| Apple Silicon DMG | `dcaedc17cb9f205151224f79305a26e6edb23a2c97e58372da2b9990bb70f8d4` |
| Apple Silicon archive de mise à jour | `b80a6730dc7442705609fd4f97005da5e276fb11ee118dbb7de1b3ebae8736e2` |

Les premiers essais du harnais ont échoué avant les contrôles du produit : Bash 3.2 refusait un tableau vide sous `set -u`, et la sélection du binaire DEB capturait aussi un répertoire de documentation. Les régressions reproduisent ces deux erreurs ; les qualifications ci-dessus utilisent leur correction.

La [qualification renforcée de l'AppImage](https://github.com/GBeurier/nirs4all-studio/actions/runs/35229689810) a également réussi à **13:54:21 UTC**. Elle relie le fichier publié à son montage FUSE et aux exécutables Electron, sidecar Rust et Python de ses processus descendants. Les contrôles scientifiques et dataset ont réussi hors ligne, et l'arrêt du groupe de processus a été confirmé avant l'écriture du résultat.

Une revue supplémentaire à **14:21 UTC** a identifié une limite de ces tests Linux : les runners avaient préinstallé TBB et OpenMP. L'AppImage publique, vérifiée par son SHA256 complet, n'embarque pas `libtbb.so.12` ni `libgomp.so.1.0.0`, que deux moteurs parallèles optionnels de Numba référencent ; le DEB ne déclare pas leurs paquets dans `Depends`. Une contre-vérification du runtime exact extrait de l'AppImage, avec ces bibliothèques système masquées dans `bwrap`, réussit les calculs SHAP Linear/Kernel/Tree et une réduction Numba parallèle utilisant le moteur de secours `workqueue`. Le host scientifique nettoie son environnement ; les chemins Nirs4all/SHAP/pybaselines examinés ne demandent pas ces moteurs optionnels. Aucun ajout de TBB n'est donc justifié pour corriger une panne CPU du produit par cette preuve. Les modes forcés `tbb`, `omp` et `safe` restent hors de la qualification autonome du paquet desktop ; les tests durables doivent distinguer cette optionalité des dépendances obligatoires.

Le backend exact extrait de cette AppImage a ensuite passé une vérification sous la même isolation : contrat embarqué, disponibilité scientifique, Playground avec PCA/statistiques, inventaire des paquets et parcours dataset complet (NA metadata, identifiant des répétitions, sauvegarde/rechargement). Cette vérification utilise les scripts F314 et ne reconstruit aucun composant. Elle couvre le backend réel ; elle ne répète pas Electron/FUSE ni un entraînement effectif dans cette isolation.

La [qualification CI renforcée](https://github.com/GBeurier/nirs4all-studio/actions/runs/35234849707), terminée à **14:42:03 UTC**, a ensuite réussi sur le fichier public inchangé : **414 ELF** du runtime Python et cinq cas scientifiques dans le namespace sans TBB/OpenMP système, puis lancement de l'AppImage originale par FUSE, contrôles scientifiques/dataset et arrêt des processus. Les deux preuves sont conservées séparément : le lancement FUSE n'est pas exécuté à l'intérieur du namespace du contrôle Python.

L'audit des **430 fichiers ELF** de l'AppImage fixe le minimum à **glibc 2.35 et GLIBCXX 3.4.29**, imposé par `libn4m.so`. Les qualifications Linux utilisent Ubuntu 22.04, qui satisfait ces exigences. L'ancienne mention Ubuntu 20.04+ dans le générateur de notes est corrigée : cette distribution fournit [glibc 2.31](https://lists.ubuntu.com/archives/ubuntu-security-announce/2024-April/008236.html), insuffisante. La borne annoncée devient Ubuntu 22.04+ ou une distribution équivalente ; elle ne constitue pas une certification de toutes les distributions Linux.

## Livraison Docker

L’image publique `ghcr.io/gbeurier/nirs4all-studio:0.11.5` et le tag `latest` désignent la même image Linux amd64 CPU. Le registre public a été interrogé sans authentification ; sa configuration correspond à l’image effectivement testée. Le tag `0.11.4` conserve son empreinte précédente.

```bash
docker pull ghcr.io/gbeurier/nirs4all-studio:0.11.5
docker run --rm -p 127.0.0.1:8000:8000 \
  -e NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1 \
  ghcr.io/gbeurier/nirs4all-studio:0.11.5
```

Cette commande lance le mode local explicite sur le port 8000 de la machine. Les données de ce lancement temporaire ne sont pas une démonstration de migration d’un volume utilisateur existant.

| Identité | Empreinte SHA256 |
| --- | --- |
| Manifeste public `0.11.5` et `latest` | `6c6e4629ee30cafc0bcac97a1e26800ff93a2e23b701aae2431510cead6305aa` |
| Configuration de l’image qualifiée et publiée, image ID | `3d5bd6eed5b327cce38dd45b49983fedcb65d129f38e0bfe96a0fdf9583e54a3` |
| Export conservé `qualified-image.tar.gz` | `f32905616e4659e28bde2ee824807a9d567570307035a011faaac10af241ce9d` |
| Ancien manifeste public `0.11.4`, inchangé | `4f5f66e873ed2ddb4640a66180048b733a1b69646ec04fd4daceff887888ba1c` |

Le push du tag `0.11.5` a réussi à **13:37:53 UTC** ; celui de `latest` à **13:37:54 UTC**. Le [workflow de qualification et publication](https://github.com/GBeurier/nirs4all-studio/actions/runs/35226786609) s’est terminé avec succès à **13:38:00 UTC**. Le contrôle public indépendant a réussi à **13:39:52 UTC**.

## Source et qualification exacte

Le produit est issu du commit immuable `f314cdb223cd77ce1a3fb6d336cca82206cd02a4` (tag `0.11.5`). Le workflow de livraison provient du commit d’infrastructure `59f3020b02c0b3114d8d42f1e775ec2b2b82aee0` et checkout explicitement F314 pour construire le produit.

Le workflow exige la release GitHub 0.11.5 déjà stable, le tag exact et les qualifications du même code : [CI source](https://github.com/GBeurier/nirs4all-studio/actions/runs/35216053291), frontend **4 143 réussis / 1 ignoré**, backend **2 474 réussis / 17 ignorés**, confinement Windows **309 réussis / 5 ignorés**, Docker Runtime réussi ; [E2E](https://github.com/GBeurier/nirs4all-studio/actions/runs/35216025664), **63 réussis**.

L’image Docker de cette première CI était marquée `ci` et n’avait été ni exportée ni poussée. Elle ne pouvait pas être promue. La livraison a donc construit une seule nouvelle image F314 avec la version interne `0.11.5`, puis qualifié et publié cette même image sans reconstruction intermédiaire.

Les contrôles bloquants de cette livraison comprennent :

- Compilation et tests de la bibliothèque Methods au commit épinglé, puis lecture native des archives scientifiques V2.
- Construction avec vérification de la fermeture Python, des dépendances ELF et des bibliothèques TBB/OpenMP ; vérification de la version et de la révision internes de l’image.
- Démarrage du vrai conteneur : frontend statique, API Rust, hôte Python isolé, capacités scientifiques, WebSocket et ports exposés.
- Chromium réel : navigation authentifiée, fetch, mutation JSON et WebSocket ; refus par défaut, mode local explicite et refus des accès cross-origin non autorisés.
- Export `docker save` compressé, SHA256 et image ID conservés avant publication. Le push est suivi d’un pull et d’une comparaison d’image ID ; `latest` ne change qu’après vérification du tag versionné.
- Refus d’un tag Docker 0.11.5 déjà présent, au début et juste avant le push. Les pipelines shell utilisent `bash` avec `pipefail` : un échec de smoke ne peut pas être masqué par `tee`.

L’[image qualifiée conservée](https://github.com/GBeurier/nirs4all-studio/actions/runs/35226786609/artifacts/10499614287) est un export Docker compressé de 577 805 645 octets dans son artefact GitHub, conservé 14 jours. Les [logs et métadonnées de publication](https://github.com/GBeurier/nirs4all-studio/actions/runs/35226786609/artifacts/10499689452) sont conservés 30 jours. Les empreintes et résultats du contrôle public figurent dans le JSON versionné de ce rapport.

## Limites et plateformes restantes

La preuve Docker porte sur **Linux amd64 CPU**. Elle ne couvre pas Docker arm64/GPU ni la migration de volumes et workspaces utilisateurs existants. Le contrôle public indépendant a lu les manifestes et la configuration ; il n’a pas téléchargé toutes les couches ni redémarré un second conteneur distant. Le workflow CI a poussé puis tiré l’image et vérifié son identité après les tests réels.

macOS Intel nécessite encore la nouvelle qualification de sa fermeture Python compatible ; aucun succès macOS Intel n'est revendiqué ici. Les paquets Apple Silicon sont sans signature ni notarisation Apple : les tests fonctionnels ne démontrent pas l'approbation Gatekeeper. La désinstallation, la conservation des données et les migrations de workspaces existants restent à qualifier. L'action de préférence développeur a pris 33,812 s sur Apple Silicon et 34,753 s sur Linux dans ces tests ; sa persistance a été confirmée. La cause de cette attente est corrigée sur main avec mesure locale avant/après, mais cette amélioration nécessite une version ultérieure et n'est pas incluse dans 0.11.5 ; voir l'audit.

Les limites Windows restent celles du [rapport de livraison Windows](studio-delivery-0.11.5-2026-09-17.md). L’[audit des tests d’installation](studio-package-test-audit-2026-09-17.md) décrit les défauts trouvés par les vrais paquets et les contrôles supplémentaires.
