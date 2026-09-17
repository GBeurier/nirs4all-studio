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

- Exécuter les installateurs Linux DEB/AppImage et macOS DMG dans des machines vierges ; tester la désinstallation et la conservation des données sur toutes les plateformes. Windows NSIS a maintenant été réellement installé et son application a passé les vérifications scientifiques et UI, voir le suivi de livraison.
- Compléter la migration **de la précédente version publique vers la nouvelle** avec préférences et workspace utilisateur existants. La nouvelle qualification N−1 utilise les versions et les octets réels ; son profil vierge ne prouve pas encore la conservation d’un workspace existant.
- Étendre le parcours UI réel à macOS. Il a désormais passé setup, activation du mode développeur, sauvegarde, reload et redémarrage sur Linux et Windows installé. Les E2E navigateur génériques ne remplacent pas cette preuve.
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
