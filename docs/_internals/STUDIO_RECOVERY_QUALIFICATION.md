# Audit Studio intégration/publication — 2026-09-19

Audit initial des sources, CodeGraph et GitHub Actions, suivi de correctifs et qualifications ci-dessous. Les budgets proposés ne sont pas des mesures Windows. Le parent confirme spawn gpt-6-astra/high.

## Résultat

Le système teste souvent présence d’écran ou intégrité du paquet, sans prouver le parcours métier. La priorité est un petit driver Playwright du vrai Electron installé, avec vrai dataset/workspace, conservation du profil entre upgrade/restart, assertions métier et temps bornés. Les builds d’archives dupliquent un coût mesuré et couplent inutilement toutes les plateformes.

## Preuves sources

- playwright.config.ts lance bien Rust via cargo, pas Python, mais via Vite : la préselection Electron n’est pas exercée. Un endpoint HTTP vert ne prouve donc pas que le renderer peut l’appeler.
- e2e/fixtures/global-setup.ts appelle config/skip-setup et préchauffe pages ; app.fixture.ts préremplit consentement. Pas de premier démarrage dans ces specs.
- workflow.spec.ts:59 accepte Predictions quand main est visible, donc aussi une erreur. Dernier test contient || true. dataset-wizard.spec.ts contient deux expect(true).toBe(true), ne sélectionne aucun fichier et vérifie des sections sans atteindre leur étape. datasets.spec.ts accepte une barre statistiques et certaines interactions n’assertent rien sans dataset. Pas de spec Playground dédié dans les sept specs actuels.
- runs-redesign.spec.ts intercepte runs/aggregated-predictions : utile pour composant, ne qualifie pas transport réel.
- smoke-first-launch-ui.cjs utilise bien Electron packagé, wizard et préférence developer_mode persistée sur reload/restart. Mais pas de workspace, dataset UI, Predictions ni Playground. Les erreurs HTTP/console sont seulement diagnostics si une autre assertion échoue.
- smoke-archive-standalone.cjs:748 importe seulement deux lignes/deux features par HTTP direct avec timeout 60 s. Pas de croissance dataset/store. windows-real-install-update.yml:151 et unix-product-qualification.yml:173 donnent 360000 ms à chaque attente du smoke UI : cinq minutes peut être vert.
- windows-real-install-update.yml installe NSIS en silencieux dans un chemin explicitement sans espaces (:129). Pas de choix conserver/supprimer du désinstalleur ni espaces/accents ni install UI.
- verify-real-release-update.cjs utilise un profil frais, vérifie version et remplacement, crée dataset APRES upgrade. Il ne prépare ni prefs ni workspace avant et le cold boot final smokeArchiveStandalone recrée encore son sandbox : aucune preuve de préservation du profil migré.
- release-unified.yml:237 appelle CI, pas playwright.yml. Ce dernier est indépendant et ne reçoit pas le SHA release. Python CI teste FastAPI transitoire, pas la surface Rust livrée.
- windows-release-gate-plan.cjs exige une archive en stable ; unix-product dépend de toutes les archives, Docker de unix-product, publish-qualified-release.cjs refuse stable sans archive. Activer skip_all_in_one seul casse publication.

## Durées observées

Source : https://github.com/GBeurier/nirs4all-studio/actions/runs/35247378499 ; gh run list et gh api jobs le 19/09. Run 0.11.7 du 17/09 : 16:34:04–18:16:40 UTC, 1 h 42 min 36 s, failure.

Installer Windows 19 min 51 s, archive Windows 36 min 57 s, qualification attend archive puis dure 15 min 47 s. Installer mac Intel 48 min 50 s, archive Intel environ 62 min 42 s ; toutes qualifications Unix attendent archive Intel, même arm64 dont installer finit à 16:48:23. Docker ne démarre qu’à 17:54:01 et prend 13 min 23 s. mac Intel installer : closure Python 16 min 36 s, sidecar 11 min 02 s, replay Archive V2 7 min 51 s, package 4 min 18 s, smoke 3 min 43 s. Coûts répétés dans archive. Aucun gain total promis sans nouvelle mesure.

## Plan appliquable

1. Distribuer Python vérifié tant que Rust n’a pas prouvé au moins équivalence. Préserver état et données existants.
2. Étendre driver packagé existant, pas nouveau framework : premier démarrage consentement deux choix + chemins natifs + workspace ; import UI CSV déterministe 1000×256 + métadonnées/target ; Predictions avec résultats attendus, Playground + transformation simple, mini SNV/PLS score fini ; upgrade vrai installer N-1 avec profil prérempli et comparer mêmes fichiers/prefs après restart. Données synthétiques, chemins espaces/accents. Échec sur refus route, erreur métier HTTP, pageerror et alertes. Aucun skip/retry qui transforme dépassement temps en vert.
3. Mesurer JSON avec SHA Studio/runtime, OS/arch, tailles et latences. Budgets initiaux à calibrer baseline Python sur même runner : readiness warm p95 100ms, interaction 1s, preview 2s, link 3s, démarrage warm 5s, premier launch 20s, install offline 90s. Calcul scientific : pas plus de 20% régression paired et parité score/predict. Timeouts infra séparés.
4. Workspaces SQLite valides 10MiB/250MiB, read/list p95 sur 5–10 appels : aucune sérialisation/hash full store en sondes, volume I/O/calls borné. UI idle 30s, coût polling/CPU documenté. Détecter croissance indue, pas seulement timeout généreux.
5. Release : NSIS, DEB, DMG x64 et arm64 + Docker. Un format par OS ; garder deux DMG évite casser Intel. Universal nécessiterait deux closures Python/Methods et sélection loader, pas un simple renommage. Retirer portable Windows/AppImage et quatre archive jobs. Chaque installer se qualifie dès sa construction, Docker candidat parallèle ; publish seul attend résultats et promeut mêmes bytes/digest.
6. Remplacer migration archive par installer N-1 avec même profil rempli. Anciens lecteurs archives seulement pour historique existant, aucune nouvelle archive obligatoire. Réutiliser closures immuables par OS/arch/hash, éviter double compilation et dry-run complet redondant.
7. PR unitaires utiles + petit parcours Electron Linux et Windows ciblé installation ; release mêmes quatre parcours sur produits ; nightly matrice scientific/browser exhaustive. Supprimer tautologies. Tous parcours métiers release requis sans skip. Publication reprend manifeste/artifacts existants, pas nouveau workflow par incident.

Audit bibliothèque en parallèle : bench_engine_perf.py existe sans job CI, resource non Windows, subprocess sans timeout, best_score parfois None. Gate paired cross-platform avec scores CV/predict finis et timeout nécessaire.

## Limites

Aucun installateur Windows lancé ici, aucune preuve du binaire exact utilisé. Défauts de couverture prouvés par sources, causes physiques de lenteur relèvent du diagnostic performance. Timings relatifs à un run donné. Validation sur Linux ne vaut pas validation Windows.

## Implémentation de cette tranche

`release-unified.yml` ne produit plus d’archives ni de portables : NSIS/DEB et deux DMG CPU, Docker candidat parallèle, publication finale après tous les gates. `installer-baselines.cjs` choisit un vrai installer/checksum N-1 par plateforme et lie les identités GitHub. `qualify-installer.cjs` installe les paquets, prépare workspace+dataset+prefs avant upgrade, compare les fichiers et le profil après, exerce wizard/import UI 1000×256, navigation Predictions/Playground et budgets 30s launch/5s preview-link/3s navigation/120s install. Sous Windows, le profil upgrade est le vrai profil du runner GitHub jetable, car les known folders NSIS ignorent les overrides APPDATA de processus ; un simple sandbox aurait laissé passer le wipe. Les deux choix de consentement sont parcourus et vérifiés après restart.

Les 67 tests Node ciblés et 62 tests Vitest packaging/workflows passent sur Linux Node24. Le driver installer complet n’a pas encore été exécuté sur les OS natifs : ceci est une implémentation à qualifier, pas une preuve produit verte. Il reste à étendre le parcours aux résultats de prédictions non vides et à un vrai calcul/graphique Playground, puis exécuter la comparaison baseline/candidat sur Windows. Les checks de navigation ne prouvent pas encore ces calculs. Les suites web tautologiques ont été supprimées/corrigées ; elles ne revendiquent plus un workflow scientifique complet.

## Qualification après correctifs (19 septembre)

Première preuve historique du repli isolé 0.11.8, base 0.10.1 : nirs4all 0.11.0, moteur legacy effectif. Cette combinaison est abandonnée ci-dessous à cause de son incompatibilité avec les stores déjà livrés. Le driver `recovery-qualify-installer.cjs` teste le vrai Electron, téléchargement Python depuis profil vide, CPU Lite, workspace automatique, import UI 1000×256, SNV avec invariant numérique et graphique visible, PLS/KFold réel, Predictions non vide avec 334 valeurs de validation finies, restart et deux consentements. Seul le sélecteur natif de dossier est substitué. Aucun calcul mocké, aucun skip-setup candidat.

Preuve Linux locale `/tmp/recovery-qualification-final.json`, succès `packaged_application_only` : Python 55,20/50,76 s, preview 1,865 s, ajout 0,917 s, SNV UI 2,609 s (serveur 104 ms), PLS legacy 3,002 s, Predictions 203 ms, restart prêt 6,704 s. Les scores CV restent CV : suppression du faux refit synthétique et visibilité CV seule par défaut.

Budgets effectivement appliqués : installer 120 s, lancement 30 s, téléchargement+création Python 180 s, profil 60 s, preview/ajout/Predictions 5 s, Playground 10 s, PLS 60 s. Erreur numérique ou refus de route bloque même dans le budget.

Défauts trouvés par ces parcours : nom dataset ignoré, registre SNV absent du paquet malgré sources présentes, pin Python `==` mal interprété, boucle infinie après erreur preview, macros NSIS dépendantes d'includes/variables déclarés trop tard. NSIS compilé avec ordre electron-builder et `-WX`, deux passes installer/uninstaller ; cela ne prouve pas l'exécution Windows.

CI recovery #35435071694 : Docker vrai SNV réussi. Linux installation, téléchargements Python 33/31 s, preview 401 ms, ajout 931 ms, SNV UI 1,88 s, PLS 755 ms, Predictions 193 ms, restart 7,1 s réussis. Gate ensuite bloqué par dpkg N-1 dépassant maxBuffer ; mac ARM preview non résolue en 5 s, Windows provisioning non résolu en 180 s. Aucun de ces produits n'est déclaré qualifié. Driver suivant : logs installation streamés, écran/body/réponses backend exportés, userData macOS explicitement isolé, transitions wizard vérifiées ; aucun budget augmenté.

Studio current : 589 fichiers / 4185 tests frontend passent ; trois projets TypeScript, Ruff, dépendances, schémas nœuds, pin UI passent. ESLint zéro erreur, 21 warnings fast-refresh préexistants. Test anti-boucle preview ajouté ensuite passe. La qualification Electron Rust avec fermeture privée corrigée reste nécessaire.

Limites : local Linux ne prouve ni installation DEB ni Windows/macOS. Nouvelle roue nirs4all et sidecar à pins privés sont réservés à la qualification. Publication bloquée jusqu'aux parcours natifs complets et réinstallation N-1 peuplée. Durée totale future inconnue avant CI verte ; seules duplications antérieures sont mesurées.


## Mise à jour après qualification native et migration peuplée

La CI suivante (`35435949843`, SHA `6a2cc4b9`) a validé les deux premiers démarrages mac ARM : configuration Python 34/41 s, preview 867 ms, ajout 940 ms, SNV 2,75 s, PLS 3,22 s, Predictions 203 ms et redémarrage 18,6 s. La migration a correctement refusé une fixture sans store : enregistrer un dataset ne crée pas de résultats scientifiques. Le driver peuple désormais le workspace N-1 avec le Python réellement livré par N-1, un entraînement legacy et des prédictions persistées, puis compare tous les fichiers avant/après réinstallation.

Cette correction de test a découvert un blocage produit : la bibliothèque 0.11.0 ne lit pas le schéma SQLite v5 de Studio 0.11.7. La récupération conserve donc le backend Python et le moteur legacy explicitement, mais embarque la bibliothèque compatible 1.0.2 propre. Une seule roue universelle est construite depuis un commit et une archive source vérifiés, puis les mêmes octets alimentent les quatre installateurs et Docker. L'installation et la réparation utilisent exclusivement cette roue ; le driver vérifie le SHA enregistré dans `direct_url.json`, pas seulement la version annoncée. Les environnements Python partagés ne sont pas modifiés automatiquement.

Autres défauts révélés par la CI et corrigés : dossier Documents absent sous Windows faisant échouer le lancement après un provisioning réussi ; profil Electron macOS non isolé par HOME seul ; processus Electron orphelin lorsque le budget de readiness échoue avant retour du contexte ; sortie dpkg trop volumineuse pour execFile. Le driver ferme désormais toutes les applications suivies avec délai maximal, capture les logs et tue un processus bloqué. Les tests reproduisent ces échecs sans augmenter les budgets.

Sur mac Intel, deux POST preview partaient à 42 ms d'intervalle ; GET config/diff bloquait la boucle HTTP 8,8 s pendant pip/outdated, et le preview bloquait des GET simples pendant 4,9 s. Le frontend déduplique les requêtes par contenu de configuration, conserve l'inflight identique et présente une erreur avec relance explicite. Les deux routes backend bloquantes délèguent leur travail synchrone à un thread. Deux tests React prouvent absence de double requête et de boucle automatique ; des tests backend vérifient la réactivité concurrente.

La lecture de résultats ne suffit pas : le driver rejoue également huit spectres avec le modèle enregistré après entraînement et après migration N-1, vérifie huit valeurs finies et RMSE < 0,05 sur la fixture synthétique. Cela couvre des erreurs supplémentaires trouvées dans le repli : moteur de replay implicitement natif et extraction d'un ancien attribut renvoyant un tableau vide. Ces nouveaux parcours doivent encore passer sur les quatre installateurs finaux avant toute publication.

Le Rust corrigé a une preuve HTTP et des suites ciblées ; il ne possède pas encore de qualification Electron scientifique complète. Un essai privé a atteint import/preview réels, puis sa qualification a été interrompue pour donner priorité à la récupération Python. Les adaptations de bibliothèque privées ne doivent pas remplacer les pins publics d'une release. La couverture des routes reste incomplète ; aucun argument de performance Rust ne justifie de le publier avant parité de parcours et mesure comparative.

Validation finale du frontend current après correctifs : 4 196 tests passent, lint complet passe (agent performance). Backend recovery avec bibliothèque propre 1.0.2 : 2 145 tests passent, 55 ignorés et 169 désélectionnés selon les marqueurs existants ; les fixtures obsolètes de politique de release ont été corrigées explicitement, sans désactiver les guards de récupération.
