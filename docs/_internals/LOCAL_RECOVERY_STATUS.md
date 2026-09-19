# Studio 0.11.10 — qualification locale, 19 septembre 2026

Les modifications sont prêtes pour publication depuis les worktrees
`studio-python` et `library-fixes-review` ; le développement WIP est préservé.

Les trois erreurs Windows ont été reproduites en changeant scikit-learn pendant
que Python avait encore l'ancienne version en mémoire. Cela peut arriver dès la
première installation. Les calculs sont désormais bloqués pendant la modification
des dépendances et jusqu'au redémarrage effectif du backend. Le wizard attend
ensuite la disponibilité du moteur et du workspace.

Autres corrections confirmées :

- Brouillon modifié restauré correctement dans « Run this pipeline » ; identifiants
  de pipelines uniques, sans écrasement lors de deux créations simultanées.
- Scores des modèles terminés conservés après l'échec d'un modèle suivant.
  Results et Database se rafraîchissent ; une erreur ne s'affiche plus comme une
  base vide. Une exécution disparue du polling n'est plus déclarée réussie sans
  vérifier son état.
- Compatibilité des sélecteurs supervisés, IKPLS, StackingClassifier, paramètres
  sklearn, fonctions de scoring, matrices creuses, rééchantillonnage, filtres,
  groupes et fusions. Les sorties multiples gardent leurs dimensions dans le
  calcul, le stockage et les modèles rechargés.
- Les opérateurs inadaptés au contexte spectral sont signalés avant l'exécution,
  sans inventer de résultat. AOM-PLS est relié au backend natif de
  `nirs4all-methods` et s'exécute normalement dans Studio.

**Vérifications :** 344 scénarios scientifiques exécutés, persistés et scorés dans
une passe uniforme de 6 min 31, sans échec ni timeout ; l'audit en lecture seule
trouve 697 lignes Results avec scores finis. Dix profils optionnels sont qualifiés
séparément. Le vrai wizard CPU, l'alignement, le redémarrage et `pip check` passent.
TabPFN est validé dans PCA → sélection → validation croisée → Ridge + TabPFN, avec
stockage et replay strict dans un nouveau processus.

**Performance :** comparaison avec le commit précédant les corrections, mêmes
données 1000 × 256 et trois répétitions : Ridge 0,587 → 0,588 s ; PLS 0,607 → 0,618 s.
Scores et prédictions identiques. Navigation locale mesurée à 77–95 ms ; aucun
polling readiness répété au repos. Ces mesures ne remplacent pas un essai Windows.

Le gate navigateur réel passe également : deux parcours éditeur → Run et un
entraînement Ridge réussi suivi d'un PLS invalide. Leaderboard et Database affichent
le score Ridge enregistré (RMSE CV 1,745), même après l'échec du second modèle.
Le visualiseur multi-sortie présente les valeurs stockées, scores, tableau et CSV
de la sortie choisie, sans nouveau téléchargement lors d'un changement de sortie.

**Modèles optionnels :** les six modèles neuronaux, TabPFN régression/classification
et TabICL régression/classification passent fit, prédictions, stockage et Results.
Les paramètres d'architecture et d'entraînement sont effectivement appliqués.

**Limites explicites :**
Seize entrées du catalogue ont une contrainte Studio explicite ; elles sont bloquées
avec une cause actionnable plutôt que lancées dans un pipeline invalide. Les modèles
optionnels demandent leur profil installé. Aucun profil GPU n'a été qualifié ici.

Le contrôle avant construction des installers inclut ces scénarios scientifiques
concrets et les parcours navigateur, sans relancer les milliers de tests
d'installation. La publication ne contient que les installers par OS et Docker.

Preuves détaillées : [qualification du catalogue](LOCAL_CATALOG_QUALIFICATION.md).
