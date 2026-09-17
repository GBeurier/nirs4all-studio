# Livraison Windows 0.11.5 — 17 septembre 2026

## Résultat

**0.11.5 est publiée comme dernière version stable Windows.** L’installeur et le portable étaient publics à 14:16:17 Paris, dans les deux heures. L’archive de mise à jour et la promotion stable ont terminé à 14:32:38 Paris : cette partie a dépassé le délai de 15 min 38 s.

La migration réelle depuis 0.11.4, les vérifications scientifiques après remplacement et le redémarrage à froid hors ligne ont réussi. L’API publique sans authentification expose les six assets attendus et leurs SHA ; les trois exécutables/archives correspondent aux preuves de qualification.

[Télécharger l’installeur](https://github.com/GBeurier/nirs4all-studio/releases/download/0.11.5/nirs4all.Studio-0.11.5-win-x64.exe) · [Release stable](https://github.com/GBeurier/nirs4all-studio/releases/tag/0.11.5) · [Preuves structurées](studio-delivery-0.11.5-evidence.json)

## Candidat immuable et corrections

Tag `0.11.5`, commit `f314cdb223cd77ce1a3fb6d336cca82206cd02a4`.

Le correctif répare l’activation et la persistance du mode développeur sans workspace, les paramètres locaux de parsing, les métadonnées avec politique NA `ignore`, la sélection des identifiants de répétitions et les chemins Windows canoniques interprétés à tort comme des motifs glob.

L’installation contrôle la fermeture CPU épinglée, `pip check`, les versions présentes et des opérations scientifiques réelles avant de déclarer le runtime prêt. Les téléchargements interrompus, les anciens marqueurs ready et les environnements externes modifiés sont couverts par des régressions.

## Qualification du code exact

- Frontend : 4 143 tests réussis, 1 ignoré ; lint sans erreur.
- Backend : 2 474 tests réussis, 17 ignorés.
- Confinement natif Windows : 309 tests réussis, 5 ignorés, dont les régressions Drive/UNC.
- Playwright : 63 scénarios réussis sur le commit publié.
- Le paquet Windows produit a passé les contrôles des paquets, le parcours dataset réel et les calculs scientifiques.

Sources : [build et CI](https://github.com/GBeurier/nirs4all-studio/actions/runs/35216053291), [E2E](https://github.com/GBeurier/nirs4all-studio/actions/runs/35216025664).

## Vérifications de livraison

Les installateurs Windows ont été publiés en préversion le **17 septembre 2026 à 12:16:17 UTC / 14:16:17 Paris**, soit 43 secondes avant l’échéance de deux heures. L’installation manuelle était disponible dans le délai ; la mise à jour automatique ne l’était pas.

Le test de migration réelle a bloqué l’archive initiale : elle était plate, alors que l’updater exige un répertoire parent unique. Le smoke de self-update antérieur reconstruisait sa propre fixture enveloppée et ne détectait pas ce défaut du livrable. L’archive a été reconditionnée sans changer les **13 348 fichiers de l’application**, comparés individuellement par SHA256. La migration réelle et le redémarrage à froid ont ensuite réussi ; la promotion stable a été exécutée après ces succès.

- [Installation NSIS, UI installée et migration N−1 en parallèle](https://github.com/GBeurier/nirs4all-studio/actions/runs/35219251646).
- [Reconditionnement vérifié et migration réelle de l’archive corrigée : succès](https://github.com/GBeurier/nirs4all-studio/actions/runs/35220453537).
- [Publication stable et vérification des empreintes : succès](https://github.com/GBeurier/nirs4all-studio/actions/runs/35221208155).

Les tests utilisent les artefacts du build ci-dessus, sans reconstruction. La migration télécharge l’archive publique 0.11.4, vérifie les empreintes source et cible, exécute son updater vers les octets de 0.11.5, puis contrôle le produit relancé et son redémarrage à froid hors ligne.

## Portée et limites

Cette livraison cible Windows x64. Les artefacts macOS Intel restent bloqués par une roue Numba/llvmlite indisponible ; aucune publication macOS/Linux/Docker n’est attestée ici.

L’installeur Windows n’est pas signé. La désinstallation avec conservation des données et une migration de workspace utilisateur préexistant restent à qualifier. La sauvegarde du mode développeur peut être lente sous forte contention CPU ; le test impose sa persistance réelle après rechargement et redémarrage.

L’audit détaillé se trouve dans [studio-package-test-audit-2026-09-17.md](studio-package-test-audit-2026-09-17.md).

## Empreintes des installateurs publiés

- NSIS : `1f9eecc8a75e141c4552af8d95281730371b33a8d1c213f03a9b693671b9df1d`.
- Portable : `8359fc05b3a438921c18436daa7815c8a40e9a7c68b1816a42470d90664656d8`.
- Archive de mise à jour : `053112186b48c46084ffd71a620df33566a42f453fc08c5058ee2a82f076417e`.

## Prévention ajoutée après qualification

Les prochaines releases stables attendent désormais une installation NSIS réelle, le parcours UI du premier démarrage et une migration depuis la dernière version publique. Un échec, une annulation ou un skip bloque la publication GitHub et Docker. Les prereleases conservent leur comportement antérieur, sans revendication de cette couverture supplémentaire.

Le constructeur ZIP Windows crée explicitement un répertoire parent et relit le livrable avant finalisation. Les tests réels couvrent les fichiers cachés, une archive plate, une corruption CRC et la préservation de l’ancien fichier en cas d’échec. Validation locale supplémentaire : 49 tests Vitest de construction/workflows et 3 tests Python réussis ; actionlint valide les workflows.
