# Audit installation et déploiement Studio — 17 septembre 2026

> Suivi final : [livraison Windows 0.11.5 et preuves de qualification](studio-delivery-0.11.5-2026-09-17.md). Ce document conserve les étapes initiales de l’audit.

Le correctif rend bloquantes les vérifications du runtime scientifique installé et du parcours dataset avant qualification des artefacts. Aucune publication ni rétrogradation de version n’a été effectuée pendant cet audit.

## Défauts constatés et corrections

- **Mode développeur non activable** : la préférence est maintenant persistée au niveau de l’application, avec reprise de l’ancienne préférence du workspace.
- **Métadonnées et réglages locaux ignorés** : les métadonnées utilisent `ignore` par défaut ; les politiques NA sont traduites vers le contrat imbriqué réellement lu par IO, aussi bien pour l’inspection native que pour le chargement complet. Les réglages locaux relancent la validation, les noms des colonnes sont actualisés et deviennent disponibles pour choisir l’identifiant des répétitions. Les réponses obsolètes sont ignorées et un échec de preview ne déclenche plus une boucle infinie.
- **Paramètres perdus à la seconde conversion** : le parcours d’aperçu natif repasse une configuration déjà traduite à l’adaptateur. Celui-ci préserve maintenant les configurations de bibliothèque, dont les paramètres par source, les NA, les folds et les répétitions. Le défaut a été reproduit puis corrigé avec l’interpréteur et les dépendances du paquet, en isolation.
- **Moteur déclaré indisponible sur une installation vierge** : le Playground et le setup vérifient le host scientifique sans exiger qu’un catalogue de datasets existe déjà. Les jobs sauvegardés conservent leurs contrôles propres.
- **Packages annoncés mais absents du bundle** : SHAP et Matplotlib manquaient dans la fermeture CPython. Le bake utilisait en outre le libellé `cpu-lite`. Les dépendances directes sont désormais partagées entre configuration du runtime et bake : `nirs4all==1.0.1`, `duckdb==1.5.5`, `pyarrow==25.0.1`, `shap==0.47.1`, `matplotlib==3.10.1`. Le bake porte le profil `cpu` ; les dépendances transitives ajoutées sont épinglées dans les contraintes et leur empreinte a été actualisée.
- **Installation partielle non détectée** : une succession d’installations pip, dont une roue installée avec `--no-deps`, pouvait réussir sans contrôle global de cohérence. `pip check` est maintenant obligatoire avant suppression de pip et finalisation du runtime. La qualification finale compare aussi l’inventaire complet aux versions contraintes et vérifie les identités des roues et des adapters.
- **Crash au premier lancement masqué par le cache développeur** : avec un cache Matplotlib vide, SHAP déclenchait la découverte des polices via `fc-list`, refusée par le host Python avec une exception incompatible avec le mécanisme de secours de Matplotlib. Le refus de création de processus lève désormais `PermissionError` dans le bake et dans les hooks de production. Les sous-processus restent interdits ; Matplotlib peut utiliser ses polices incluses. Chaque préflight de bake utilise désormais un nouveau `MPLCONFIGDIR` et le backend Agg.
- **Interface d’installation incohérente avec un runtime embarqué immuable** : l’inventaire des packages est exposé à partir de l’interpréteur réellement installé, les mutations pip non disponibles sont désactivées et le setup du produit packagé vérifie packages, cohérence et disponibilité scientifique avant de permettre son achèvement.
- **Qualification limitée au démarrage du sidecar** : le smoke exécute maintenant le produit Electron, vérifie l’inventaire SHAP/Matplotlib et l’alignement CPU, puis le parcours de détection/validation/preview d’un dataset avec métadonnées contenant une valeur manquante et une colonne identifiant. La release locale exécute ce smoke avant promotion vers `release/` ; un test vérifie que son échec conserve les artefacts précédents. Le workflow de release applique aussi ce smoke sur Linux, Windows et macOS, sur le runner correspondant à l’architecture.
- **Bibliothèque Methods impropre à une copie autonome pendant la préparation locale** : extraire uniquement `libn4m` d’une roue Python laissait une dépendance Fortran propre à cette roue introuvable. L’artefact local a été remplacé par le résultat du script officiel `build-native-methods.cjs`, construit à partir de la source épinglée propre et du preset GCC12.

## Vérifications effectivement exécutées

| Vérification | Résultat au moment de cet audit |
| --- | --- |
| Installation CPython depuis un répertoire de sortie neuf, Linux x64 | Réussie ; étape setup en 34 s, runtime d’environ 1,30 Go |
| `pip check` avant suppression de pip | `No broken requirements found.` |
| Inventaire du runtime packagé | Exactement 60 distributions, conformes aux contraintes Linux |
| Préflight isolé `-I -S -B` | Réussi : identités nirs4all/tools, adapters, callable scientifique, refus bind/spawn |
| Fonctions scientifiques réelles | SHAP `LinearExplainer`, rendu PNG Matplotlib Agg, requête DuckDB et aller-retour Parquet PyArrow réussis |
| Premier lancement sans cache Matplotlib | Échec reproduit avant correction ; réussite après correction |
| Finalisation avec manifeste définitif puis vérification de la copie `backend-dist/python-runtime` | Réussies |
| Tests ciblés installation/configuration/env | 42 réussis |
| Tests ciblés contrat release/build/bake | 47 réussis ; recouvrement des tests bake avec la ligne précédente |
| Tests complets frontend/Electron | 4 101 réussis sur la dernière suite complète |
| Tests complets backend Python | 2 479 réussis, 1 ignoré sur la dernière suite complète |
| Lint complet | Réussi : ESLint (0 erreur, 21 avertissements), TypeScript, Ruff et contrôles de cohérence |
| Contrat API (`npm run test:contract`) | Réussi ; ajout du champ facultatif `column_names` pour le choix des identifiants |
| Tests Rust complets | 338 réussis, 5 ignorés ; entraînement et prédiction avec la bibliothèque Methods qualifiée |
| Methods source : build officiel, CTest, CLI ABI/selfcheck | Réussis ; 4/4 tests CTest, ABI 2.5.0 |
| Chargement Methods depuis une copie isolée | Réussi ; aucune dépendance Fortran ou C++ externe dans `ldd` |
| Garde Linux des dépendances Methods | 29 tests ciblés réussis ; vérification réelle acceptant la bibliothèque issue du build et refusant celle extraite de la roue (Fortran/quadmath) |
| Suite E2E complète | 63 réussis en 11,3 min, résultat communiqué par la validation principale |
| Build Electron local et smoke complet du produit packagé | Réussis : démarrage vierge, packages CPU alignés, Playground exécuté, détection/validation avec correction locale du header, preview, ajout, réouverture et refresh du dataset avec NA et répétitions |

## Traçabilité du runtime natif local

Methods : projet `1.0.18`, commit `a9faae2909c71a833bb7f3b208dc20548cf01588`, arbre `5c39dde72afab2ff725ff7b1b53e69a17b9bf865`, preset `ci-linux-gcc12-release`, GCC/GFortran 12.3.

Bibliothèque : `/tmp/studio-methods-native-build/build/ci-linux-gcc12-release/cpp/src/libn4m.so.2.5.0` ; SHA256 `8cc2eafda2a3c0d6407ee9981a8323da5dab75b1403bcec490ad27f3678d4076`. Dépendances dynamiques constatées : bibliothèques système Linux (`libgcc_s`, `libm`, `libc`, chargeur).

Les compilateurs nécessaires ont été extraits dans `/tmp`, sans installation système ni modification du dépôt Methods de travail. Le premier essai a révélé une contamination par le compilateur Fortran Conda du poste ; le build qualifié utilise un PATH isolé et GFortran12 explicite.

Logs locaux de preuve : `/tmp/studio-runtime-install-audit.log` et `/tmp/studio-methods-native-build.log`. Ces fichiers et les sorties de build restent hors versionnement.

Commandes principales de validation (Node 24 et environnement Python qualifié) :

```sh
npm run lint:parallel
npm run test:frontend
npm run test:backend
npm run test:e2e
cargo test --manifest-path sidecar/Cargo.toml
cargo clippy --manifest-path sidecar/Cargo.toml --lib --tests -- -D warnings
node scripts/bake-python-plugin-runtime.cjs --finalize-existing
node scripts/build-native-sidecar.cjs
npx electron-builder --config electron-builder.installer.yml --linux --dir --publish never --config.directories.output=/tmp/studio-hotfix-package
xvfb-run -a node scripts/smoke-archive-standalone.cjs --extracted-root /tmp/studio-hotfix-package/linux-unpacked --platform linux
```

Les commandes natives utilisent `N4M_LIBRARY_PATH` pour les tests et `NIRS4ALL_BUILD_METHODS_LIBRARY` / `NIRS4ALL_BUILD_METHODS_SHA256` pour le build, avec la bibliothèque qualifiée ci-dessus.

## Limites de qualification

Les exécutions réelles décrites ici concernent uniquement **Linux x64 sur le poste local**. Les gates Windows et macOS sont ajoutés au workflow mais leur réussite n’est pas revendiquée : elle devra être constatée sur les runners concernés. Le smoke qualifie l’application dépaquetée ; la signature, la notarisation et le comportement des installateurs distribués restent couverts par leurs contrôles de release propres. Les dépendances système Linux usuelles restent nécessaires.

Une garde Linux supplémentaire lit désormais les entrées `DT_NEEDED` avec `readelf`, sans charger la bibliothèque, à la sortie du build Methods et avant sa copie dans le produit. Elle refuse les dépendances Fortran, quadmath, BLAS et les bibliothèques propres aux roues Python, même si elles existent sur le runner. Elle accepte les bibliothèques ABI système Linux usuelles, dont `libstdc++.so.6` ; aucune obligation de liaison C++ statique n’est introduite. L’absence de dépendance C++ dynamique constatée plus haut décrit uniquement le build local.

La qualification locale Linux est terminée. Les gates de release Windows et macOS restent à exécuter avant une publication multiplateforme.

Paquet Linux local testé : `/tmp/studio-hotfix-package/linux-unpacked` (sortie de validation, non publiée). Log décisif : `/tmp/studio-packaged-smoke-qualified.log`. Autres résultats finaux : `/tmp/studio-frontend-final.log`, `/tmp/studio-backend-canonical-final.log`, `/tmp/studio-rust-qualified.log`, `/tmp/studio-e2e.log`, `/tmp/studio-final-lint.log` et `/tmp/studio-contract-final.log`.
