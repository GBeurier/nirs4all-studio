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

- Exécuter les installateurs Windows NSIS, Linux DEB/AppImage et macOS DMG dans des machines vierges, puis désinstaller et vérifier la conservation des données. Le smoke actuel démarre l’application dépaquetée ; il ne remplace pas cette preuve.
- Tester la migration **de la précédente version publique vers la nouvelle** avec préférences et workspace existants. Le self-update actuel prouve download/apply/relaunch, mais utilise une copie du candidat modifiée comme cible.
- Étendre le nouveau parcours UI du paquet Linux aux plateformes Windows/macOS. Les tests React du setup utilisent des réponses simulées ; les E2E navigateur génériques appellent `skip-setup`.
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

La dernière version publique constatée est **0.11.4**. Le correctif préparé est **0.11.5**, avec priorité aux installateurs Windows et à l’archive utilisée pour la mise à jour. La publication doit suivre les contrôles du paquet Windows et du self-update ; les résultats de build et l’URL de la release sont consignés dans le suivi de livraison.
