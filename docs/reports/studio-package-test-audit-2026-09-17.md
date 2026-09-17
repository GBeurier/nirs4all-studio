# Audit des tests d’installation et préparation du correctif 0.11.5

## Conclusion

La couverture était importante en volume, mais insuffisante sur le produit distribué. Les tests unitaires de gestion des environnements simulaient les subprocess ; les tests navigateur contournaient le setup initial ; la CI des PR construisait Electron sans exécuter le paquet. Un succès de ces suites ne prouvait donc pas que l’utilisateur disposerait d’un runtime scientifique complet.

La première qualification Linux du correctif a révélé des défauts que ces tests n’avaient pas détectés : découverte des polices à cache vide, disponibilité scientifique sans catalogue, puis perte des paramètres NA lors d’une seconde traduction de configuration. La revue suivante a aussi reproduit des défauts de compatibilité des anciens datasets et de vérification des environnements Python externes.

## Couverture et actions

| Risque | Preuve auparavant | Protection ajoutée |
| --- | --- | --- |
| SHAP/Matplotlib absents du runtime | Constantes et subprocess simulés | Dépendances partagées et contraintes exactes, inventaire du paquet, imports et vrais calculs SHAP/Matplotlib pendant le bake |
| Installation pip partielle ou incompatible | Succès des étapes d’installation | `pip check` avant finalisation ; validation fonctionnelle avant état prêt des environnements gérés/externes |
| Cache de vérification devenu faux après modification d’un module | Empreinte du répertoire parent | Révalidation des imports requis avant réutilisation d’un environnement |
| Téléchargement tronqué ou figé | Mocks du téléchargement | Tests HTTP locaux avec coupure, timeout, redirections, reprise et écriture atomique du fichier complet |
| Ancien marqueur prêt après échec de requalification | Helpers testés séparément | Révocation du marqueur et tests de l’orchestration : package absent, mauvaise version, doublon, adapter altéré, subprocess de contrôle en échec |
| Imports réussis uniquement grâce au cache du développeur | Machine déjà utilisée | Cache Matplotlib vierge à chaque préflight, Python isolé, premier lancement dans un profil vierge |
| Paramètres NA/répétitions perdus entre wizard et chargement sauvegardé | Tests par fonction | Parcours réel détection → correction locale → validation → aperçu → ajout → réouverture → refresh dans Electron packagé |
| CI PR verte sans lancement du produit | `electron-builder --dir` et readiness du sidecar | Smoke complet du paquet Electron Linux en CI PR |
| Publication indépendante des suites CI | Workflow tag autonome | Réutilisation de la CI sur le SHA exact, publication dépendante de son succès ; builds d’artefacts en parallèle |
| Docker publié avant validation des autres paquets ou reconstruit après son test | Job indépendant | Publication après qualification des artefacts, promotion de l’image effectivement testée, `latest` réservé aux versions stables |
| Synthèse CI verte malgré Docker en échec | Job absent de `summary.needs` | Docker obligatoire dans la synthèse ; tests du graphe de dépendances et des résultats échec/annulation/skip |

Les tests de workflow évaluent les conditions de publication pour plusieurs combinaisons de résultats. Le test de promotion Docker exécute le shell du workflow avec un faux exécutable Docker qui enregistre les commandes : il détecte une reconstruction après test et une promotion incorrecte vers `latest`.

## Ce qui reste à qualifier après le correctif urgent

- Tester la désinstallation et la conservation des données sur toutes les plateformes. Windows NSIS, Linux DEB et macOS Apple Silicon DMG ont désormais passé une installation réelle, les contrôles scientifiques et l'UI ; l'AppImage a passé un lancement FUSE réel. macOS Intel est encore en qualification. Voir le [suivi multiplateforme](studio-multiplatform-delivery-0.11.5-2026-09-17.md).
- Compléter la migration **de la précédente version publique vers la nouvelle** avec préférences et workspace utilisateur existants. La nouvelle qualification N−1 utilise les versions et les octets réels ; son profil vierge ne prouve pas encore la conservation d’un workspace existant.
- Terminer la qualification du parcours UI macOS Intel. Setup, activation du mode développeur, sauvegarde, reload et redémarrage ont réussi sur Windows installé, Linux DEB et macOS Apple Silicon installé. Les E2E navigateur génériques ne remplacent pas cette preuve.
- Étendre la qualification des paquets Windows/macOS aux PR pertinentes. Les builds réels multiplateformes restent effectués à la release.
- Protéger la branche principale avec des checks obligatoires. Vérification GitHub en lecture seule le 17 septembre : `branches/main/protection` renvoie « Branch not protected » et `rules/branches/main` renvoie une liste vide. Aucun réglage distant n’a été modifié pendant cet audit.

Ces limites interdisent de promettre l’absence de tout bug. Les protections ajoutées visent à rendre reproductibles les incidents observés et à empêcher leur publication silencieuse.

## Revue complémentaire pendant la préparation de la release

- Un vrai premier lancement Electron Linux, piloté par Playwright dans un profil vierge, a validé la vérification du runtime puis l'ouverture des datasets sans `skip-setup`.
- La revue de l'écran Settings a retrouvé un verrou résiduel du bouton développeur en l'absence de workspace. Il est retiré ; le test du vrai Switch a échoué avant correction et passe après correction.
- Le build Docker distant a détecté les bibliothèques TBB puis OpenMP manquantes pour les extensions Numba apportées par SHAP. Le runtime installe maintenant `libtbb12` et `libgomp1` ; le contrôle de toutes les dépendances ELF reste bloquant. L'audit local des 412 objets ELF n'a identifié aucune autre dépendance externe non couverte.
- Le test réel des Settings a reproduit une saturation du serveur : les diagnostics `/system/build` et `/system/env-coherence` importaient Python sous le verrou global. Ils utilisent désormais une copie de l'état et libèrent le verrou avant l'import. Un test HTTP impose que health réponde en moins de 500 ms pendant un diagnostic volontairement ralenti. Le script `smoke-first-launch-ui.cjs` contrôle setup, sauvegarde réelle du mode développeur sans workspace, rechargement de la fenêtre et redémarrage de l'application ; il est exécuté sur le paquet Linux en CI et à la release.
- Le workflow manuel `windows-real-install-update.yml` exécute réellement l'installateur NSIS, puis migre l'archive publique précédente vers les octets du candidat qualifié, sans reconstruire l'application. Il contrôle les SHA, les versions source/cible, le remplacement des anciens fichiers, la relance scientifique et un démarrage à froid offline. Son résultat doit être enregistré avant de considérer ces deux lacunes closes pour Windows.

## Livraison urgente

La qualification Windows réelle a reproduit un autre défaut absent des tests Linux : les chemins canoniques `\\?\C:\...` devenaient des motifs glob lors de la résolution des sources. La frontière Rust retire maintenant ce préfixe après confinement et vérifie que le chemin transmis désigne exactement la même ressource. Une régression Windows couvre chemins de fichiers, métadonnées, folds et conversions répétées ; le paquet Windows doit repasser le parcours dataset complet avant publication.

La priorité de publication est Windows. La qualification macOS Intel a également révélé une absence de roue compatible pour la fermeture Numba/llvmlite ; cette distribution ne doit pas être publiée avant correction et nouvelle qualification.

Les installateurs Windows **0.11.5** ont été publiés en préversion à **14:16:17 Paris**. Le premier test N−1 a bloqué l’archive plate produite par electron-builder : le smoke de self-update construisait sa propre fixture enveloppée et masquait le défaut du livrable. L’archive a été reconditionnée avec une racine unique et comparaison SHA de chaque fichier. La nouvelle migration réelle et le redémarrage hors ligne ont réussi ; la promotion stable a terminé à **14:32:38 Paris**. Le [suivi de livraison](studio-delivery-0.11.5-2026-09-17.md) consigne le résultat final et ses limites.

### Remaining performance observation (2026-09-17)

On the A3 packaged product constrained to one CPU, opening Advanced Settings queued several runtime diagnostics. The actual developer-preference PUT completed after 14.848 seconds, and the preference survived renderer reload. This demonstrates delayed persistence under load, rather than a lost preference; responsiveness remains an audit item. The packaged UI smoke uses its configured runtime timeout for persistence and navigation, logs the elapsed save time and bounded transport diagnostics, and still requires actual persisted data, renderer reload, and application restart.

## Contrôles durables ajoutés après la qualification Windows

- Les releases stables suivantes doivent passer le workflow réutilisable NSIS + premier setup UI + migration N−1 avant publication GitHub et Docker. Les états failure/cancelled/skipped bloquent la publication ; les tests évaluent les conditions et le graphe de dépendances.
- Le constructeur Windows crée le ZIP sous un répertoire parent unique, relit ses membres et vérifie leur intégrité avant de remplacer atomiquement le livrable précédent. Les tests utilisent de vrais ZIP, conservent les fichiers cachés et rejettent un ZIP plat ou corrompu.
- L’exception initial-release n’est applicable qu’après un véritable HTTP 404 pour la dernière version publique. Un lancement manuel exige une version source explicite ; une release existante sans archive/checksum Windows ne permet pas de sauter la migration.
- Cette protection supplémentaire vise les versions stables. Les prereleases conservent leur traitement antérieur et ne revendiquent pas cette qualification automatique complète.

## Livraison Docker indépendante après Windows

L’image du job Docker Runtime initial F314 avait passé le smoke et Chromium, mais portait la version `ci` et n’avait pas été conservée. Le publisher normal avait été skipped. Cette qualification ne prouvait donc aucune livraison Docker 0.11.5. Un workflow dédié a reconstruit F314 avec la version interne correcte, passé les tests natifs et Chromium, puis conservé et publié exactement cette image. Le contrôle public sans authentification confirme `0.11.5` et `latest` sur le même manifeste ; `0.11.4` est inchangée. Les dates, empreintes et preuves sont dans le [suivi multiplateforme](studio-multiplatform-delivery-0.11.5-2026-09-17.md).

La revue du nouveau workflow a aussi retrouvé un défaut du harnais : sans `pipefail`, `smoke | tee` pouvait réussir malgré un smoke en échec. Le shell Bash CI est maintenant explicite. Une régression exécute réellement le bloc avec un smoke qui quitte avec le code 17 et vérifie que la sonde navigateur suivante n’est pas exécutée. Le run de livraison a ensuite passé les contrôles réels avec cette protection.

La compatibilité macOS Intel reste une qualification distincte : une fermeture Python disponible sous Linux ou Windows ne garantit pas l’existence de toutes les roues macOS x64. Les adaptations de contraintes doivent repasser l’installation, la fermeture scientifique et les tests du paquet sur la cible avant toute revendication de livraison macOS Intel.

### Observation de performance macOS installé

Le parcours UI du paquet installé macOS Apple Silicon a enregistré **33 812 ms** entre le début de l'action sur le contrôle et l'observation de la préférence persistée ; Linux DEB a enregistré **34 753 ms**. Ce délai comprend l'attente Playwright, les échanges nécessaires à l'action et la vérification par GET : il ne mesure pas la seule durée du PUT. Les tests ont ensuite confirmé la sauvegarde sans workspace, sa conservation après rechargement et le redémarrage de l'application. Preuve : `installed-ui.log` du [run de qualification 35227750924](https://github.com/GBeurier/nirs4all-studio/actions/runs/35227750924). L'analyse de cette lenteur et le correctif supplémentaire sont décrits plus bas ; ils sont distincts de cette preuve de réussite fonctionnelle.

## Revue des scripts de livraison multiplateformes

Les tests Node des scripts d'installation et de publication sont maintenant exécutés dans la CI habituelle, en plus de Vitest et pytest. Ils couvrent les commandes compatibles avec Bash macOS 3.2, la sélection exacte du binaire DEB, l'extraction des archives macOS, les gates de publication et le refus de remplacer des fichiers publiés par des octets différents.

La revue indépendante de l'AppImage a trouvé deux preuves trop faibles : un montage FUSE sans attribution au processus testé, et un résultat réussi écrit avant confirmation de l'arrêt. Le harnais corrigé relie le binaire descendant, son montage et le fichier AppImage exact, puis attend l'arrêt du groupe de processus avant de produire la preuve. Les régressions incluent de vrais processus résistant à SIGTERM et un échec d'arrêt qui ne doit laisser aucun résultat réussi.

Un autre défaut concernait les releases manuelles visant un tag ancien : les installateurs indiquaient le commit du workflow plutôt que celui du produit checkouté. Les quatre fichiers de version utilisent désormais le SHA résolu du produit. La régression exécute les blocs shell avec deux SHA différents ; elle échouait avant cette correction.

## Lenteur des réglages : correctif préparé pour une version ultérieure

La cause a été reproduite : chaque préselection de capacités relançait l'attestation du convertisseur historique sous le mutex global. Son sous-processus Python importe DuckDB/PyArrow et vérifie Parquet ; une attestation isolée prenait environ 930 ms sur la référence locale. L'ouverture des réglages multipliait ces appels, bloquant les requêtes de santé et de préférence et remplissant aussi la file de connexions Chromium.

Le [correctif `09d74709`](https://github.com/GBeurier/nirs4all-studio/commit/09d74709a35cfae5529dfd980b36a94bfa28b7d4) atteste la disponibilité au bootstrap et utilise cet état pour la découverte. Une conversion conserve sa validation complète avant exécution. L'inspection explicite d'une transition de workspace réatteste hors mutex global ; les refus de disponibilité invalident l'annonce et les échecs de confinement la bloquent, même face à une ancienne attestation concurrente. Un runtime réparé peut être réattesté. La revue indépendante a vérifié ces chemins et les paramètres query refusés.

Validation locale : **291 tests Rust réussis, 3 ignorés**, clippy, format et compilation release réussis. Un test sur quatre connexions TCP exige que capacités, santé et préférence persistée terminent en moins de 300 ms pendant une attestation d'une seconde ; le résultat observé est **19,7 ms**.

La [CI complète](https://github.com/GBeurier/nirs4all-studio/actions/runs/35232120800) et la [suite navigateur](https://github.com/GBeurier/nirs4all-studio/actions/runs/35232120905) du commit `c4e0961455bdac3acb8fad6f0b534f3efe5af29e`, qui contient cette correction, ont ensuite réussi. La CI inclut le lancement réel du paquet Electron.

La mesure UI instrumentée utilise deux CPU et une référence locale prépublication identifiée par empreintes, sans revendiquer son SHA source ni une qualification F314/macOS. L'action de préférence passe de **28 718 à 343 ms** ; le PUT de **5 755 à 13 ms**, dont l'attente avant connexion passe de **5 734 à 0,7 ms**. La comparaison SHA256 de **11 571 fichiers** confirme seulement deux différences : le sidecar et son identité dans le contrat ; renderer, Python et Methods restent identiques. Cette mesure couvre le premier setup et la préférence instrumentée, pas une nouvelle qualification complète des installeurs. Les identités sont conservées dans les [preuves structurées](studio-multiplatform-delivery-0.11.5-evidence.json).

**Ce correctif supplémentaire n'est pas inclus dans les paquets 0.11.5 publiés.** Ceux-ci conservent leurs octets et leur qualification ; une nouvelle version sera nécessaire pour distribuer l'amélioration de performance.

## Dépendances natives Linux : lacune du runner découverte après publication

L'audit du contenu exact de l'AppImage publique 0.11.5 (SHA256 `e4be44160f80b654fa54d8d5aca2c824e7786ae8383a9d663c5ceae6d19f283f`) trouve deux extensions Numba dont les entrées ELF `DT_NEEDED` ne sont pas satisfaites par le paquet : `tbbpool` exige `libtbb.so.12`, `omppool` exige `libgomp.so.1.0.0`. La copie OpenMP privée de scikit-learn porte un autre SONAME. Le contrôle et l'inventaire du DEB public confirment que ces dépendances ne sont pas déclarées dans `Depends`.

Les runners des tests DEB et AppImage préinstallaient `libtbb12` et `libgomp1`, ce qui masque cette lacune. Le succès des calculs et de l'UI sur ces runners reste une preuve fonctionnelle, mais ne prouve pas l'autonomie des moteurs parallèles optionnels sur une machine vierge. Numba capture l'échec d'import d'un moteur et peut utiliser `workqueue` par défaut ; aucun échec général du démarrage de Studio n'est établi par cette seule inspection. Docker déclare et installe déjà ces bibliothèques dans son image.

La contre-vérification indépendante du runtime exact extrait de l'AppImage dans `bwrap`, avec les fichiers TBB/OpenMP système masqués et leur `dlopen` effectivement impossible, réussit SHAP Linear, Kernel et Tree (erreur d'additivité inférieure à `9e-16`). Une réduction `njit(parallel=True)` réussit en `workqueue`, avec résultat exact. Les modes explicitement forcés `tbb`, `omp` et `safe` échouent comme attendu ; ils ne sont pas hérités par le host scientifique F314 qui utilise `env_clear()`. Les chemins Nirs4all/SHAP/pybaselines inspectés utilisent du JIT séquentiel, UMAP est absent du profil publié. Le correctif proportionné porte donc sur le contrat et les tests : autoriser uniquement ces deux dépendances optionnelles connues, refuser toute autre bibliothèque nécessaire absente et exercer les calculs CPU sans les bibliothèques préinstallées du runner.

Une seconde vérification lance le sidecar et son host scientifique exacts extraits de cette AppImage, avec les mêmes bibliothèques masquées pour tous les descendants. Le contrat original, la disponibilité scientifique, le Playground PCA/statistiques et le parcours dataset F314 complet réussissent. Les empreintes du fichier public et du harnais sont consignées dans les preuves structurées. Le périmètre est le backend réel : Electron/FUSE et un entraînement effectif ne sont pas répétés dans cette isolation.

Le [correctif de qualification `c8a79c7f`](https://github.com/GBeurier/nirs4all-studio/commit/c8a79c7f0aca32e74b86a2b21548ba4733c36482) introduit un contrôle des dépendances du runtime Python Linux et cinq scénarios scientifiques dans un namespace sans réseau, sans accès aux bibliothèques TBB/OpenMP système. Il autorise uniquement les deux couples fichier/SONAME optionnels ; toute autre bibliothèque absente ou scientifique résolue hors du paquet est une erreur. La qualification locale du runtime public passe **414 ELF et cinq scénarios**. Sept tests ciblés, dont de vrais ELF avec dépendance absente ou uniquement présente sur l'hôte, et 41 tests de workflows passent. Le contrôle devient obligatoire dans les jobs Linux installer/archive, avant leur upload, et dans la qualification AppImage.

La [qualification CI 35234849707](https://github.com/GBeurier/nirs4all-studio/actions/runs/35234849707) sur ce commit termine avec succès à **14:42:03 UTC** : les 414 ELF et cinq scénarios CPU passent, suivis du lancement FUSE réel et des contrôles scientifiques/dataset sur l'AppImage publique inchangée. Les JSON et logs sont conservés. Le test du runtime Python est isolé par namespace ; le lancement FUSE constitue une étape distincte.

L'audit séparé de tous les ELF du produit, incluant Electron et Methods (**430 fichiers**), retrouve une annonce système erronée : `libn4m.so` demande `hypot@GLIBC_2.35` et `__throw_bad_array_new_length@GLIBCXX_3.4.29`, incompatibles avec glibc 2.31 d'Ubuntu 20.04. Le générateur de notes et les notes publiques indiquent désormais Ubuntu 22.04+ ou équivalent, conformément aux runners utilisés. Cette correction documentaire n'altère aucun binaire publié.
