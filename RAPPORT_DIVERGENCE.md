# RAPPORT DE DIVERGENCE — codebase WSL (refactorée) vs codebase Windows (réelle)

**Date :** 2026-06-05
**Verdict en une phrase :** ⚠️ **Ta crainte est confirmée et l'ampleur est maximale.**
Tout le travail de cette session a été fait sur un **fork figé au 9 février 2026**, alors
que le vrai développement a continué pendant ~4 mois ailleurs (**141 commits + 320 fichiers
non commités, +218 000 lignes**). La majorité du refactoring n'est **pas directement
réutilisable**.

---

## 1. Les deux codebases sont deux dépôts GitHub DIFFÉRENTS

| | Codebase WSL (où j'ai travaillé) | Codebase Windows (la vraie) |
|---|---|---|
| Chemin | `/home/delete/nirs4all/nirs4all-studio` | `D:\nirs4all\nirs4all-webapp` |
| Remote GitHub | `GBeurier/**nirs4all-studio**` | `GBeurier/**nirs4all-webapp**` |
| Branche | `master` | `operators_refactoring` (= mainline, `main` est 1 commit derrière) |
| Dernier commit | 2026-06-04 (mes 37 + 3 commits récents) | **2026-05-13** `50077b5` + **320 fichiers non commités** |
| Version (`package.json`) | `1.0.0` (placeholder du renommage) | `0.6.3` (vraies releases 0.6.0→0.6.3) |
| Onglet **Dashboard** | ✅ présent (vieux) | ❌ **supprimé** (`src/pages/Dashboard.tsx` n'existe plus) |

Le commit révélateur dans l'historique WSL : `63d1dea 2026-05-27 "Rename project
nirs4all-webapp → nirs4all-studio"`. **`nirs4all-studio` a été créé en renommant un
snapshot du 9 février de `nirs4all-webapp`** — mais le vrai travail a continué sur
`nirs4all-webapp`.

---

## 2. Point de divergence et ampleur

- **Ancêtre commun : `e512732` — 2026-02-09** ("Add webapp/API/library discrepancy review").
- Depuis cette date :
  - Côté **WSL `master`** : **40 commits** (dont ~37 de cette session). Entre le 9 fév et le
    27 mai, la ligne WSL n'a eu **aucun commit** — elle a été gelée 3,5 mois puis renommée.
  - Côté **Windows `operators_refactoring`** : **141 commits** (9 fév → 13 mai) **+ 320
    fichiers modifiés non commités**. Total : **887 fichiers, +218 219 / −29 195 lignes**.

Autrement dit : la base sur laquelle j'ai refactoré est **~4 mois et 141 commits en
retard** sur la vraie.

---

## 3. Preuves que la base WSL est l'ancienne

| Élément | WSL (ma base) | Windows (réel) | Conclusion |
|---|---|---|---|
| `src/pages/Dashboard.tsx` | présent | **absent** | WSL = pré-suppression Dashboard |
| `src/pages/Analysis.tsx` | présent | **absent** | idem (page supprimée depuis) |
| `api/evaluation.py` | présent (je l'ai supprimé comme "mort") | **présent, 775 l., enregistré (VIVANT)** | ❌ je l'ai supprimé à tort |
| `api/preprocessing.py` | présent (supprimé) | **présent, 827 l., VIVANT** | ❌ supprimé à tort |
| `api/automl.py` | présent (supprimé) | **présent, 880 l., VIVANT** | ❌ supprimé à tort |
| Pages absentes de ma base | — | `Inspector`, `Lab`, `Predict`, `SetupWizard` | features que je n'ai jamais vues |
| Modules API absents de ma base | — | `inspector`, `lazy_imports`, `network_state`, `node_registry_loader`, `pipeline_canonical`, `predict`, `preset_loader`, `projects`, `recommended_config` | idem |

---

## 4. Bilan du travail de la session : perdu / redondant / portable

**142 des 280 fichiers que j'ai touchés (51 %) ont AUSSI changé côté Windows** → collision
directe. Voici le détail par catégorie.

### ❌ Travail PERDU (fait sur des fichiers obsolètes, non portable tel quel)
- **Suppression "dead code" des routers `evaluation` / `preprocessing` / `automl`
  (~2 480 lignes)** : ils sont **VIVANTS** sur la vraie codebase. Suppression à *annuler*.
- **Décompositions god-files** : `client.ts`→http+11 modules, `pipelineConverter/`,
  `lib/playground/export/`, `WorkspaceScanner`, `workspace_helpers`. Tous ces fichiers ont
  fortement évolué côté Windows → mes découpages sont sur des versions périmées.
- **Perf frontend** (rendu à la demande SpectraWebGL/scatter, hover rAF, memo YHistogram,
  polling→WS, React Query dataset cache) : tous les fichiers concernés
  (`SpectraWebGL`, `YHistogramV2`, `SpectraChartV2`, `ActiveRunContext`, `RunProgress`,
  `useSpectralData`, scatter*) ont collisionné. Windows a probablement fait sa propre version.
- **Perf backend Bloc A** (to_thread venv/pip, RLock, WS serialize, JobManager workers) :
  `updates.py`, `venv_manager.py`, `workspace.py`, `websocket/manager.py` ont tous changé
  côté Windows.
- **Bundle/vendor chunking, CI bloquant, line-endings** : `vite.config.ts`,
  `.github/workflows/ci.yml`, `.gitattributes` ont changé côté Windows.

### ❌ Travail REDONDANT (déjà fait, mieux, sur la vraie codebase)
- **Fix crash `/datasets` sur compteurs null** : Windows a **déjà** le guard, en mieux —
  `formatNumber(num: number | number[] | undefined | null)` gère aussi les tableaux.
- **Suppression Dashboard / Analysis** : déjà supprimés côté Windows.

### 🟡 Travail PORTABLE (valeur réelle, à ré-appliquer sur la vraie codebase)
- **Fix bug `na_policy` "Drop"** : **bug RÉEL et toujours présent sur Windows** (tu l'as
  confirmé). Le défaut y est déjà `"auto"`, mais `nirs4all_adapter` passe `na_policy` **brut**
  (ligne 182) sans normalisation, et `api/shared/na_policy.py` **n'existe pas** côté Windows.
  → La logique de normalisation (`drop`→`remove_sample`, `keep`→`ignore`, à chaque frontière
  `DatasetConfigs`) est exactement ce qu'il faut y porter. **C'est le livrable le plus utile.**
- **Fix 404 `aggregated-predictions` sur workspace vierge** : le `_get_store()` lève
  toujours 404 côté Windows (lignes 278/296) → *possiblement* encore à corriger (fichier très
  différent, à revalider).
- **L'AUDIT + la ROADMAP** (`AUDIT_TECHNIQUE.md`, `docs/audit/2026-06-04/`, 18 rapports
  Claude+Codex) : c'est de la *réflexion* (catégories de dette, patterns, méthodo). Réutilisable
  comme grille d'analyse — **mais à revalider** car établie sur du code périmé.
- **Concepts** : durcissement sécurité (token API, updater fail-closed, path containment),
  `require_workspace` dependency, sanitizer NaN unique. Idées portables, intégration à refaire.

---

## 5. Le problème des deux dépôts GitHub (à trancher par toi)

1. **`github.com/GBeurier/nirs4all-studio`** (où j'ai **poussé `master` = 40 commits**) :
   peuplé à partir du fork périmé du 9 février. **À ne PAS utiliser comme base.** Si
   `nirs4all-studio` doit devenir le dépôt canonique (ce que le renommage suggérait), il
   faut le **re-semer depuis l'état réel Windows**, pas depuis ce fork.
2. **`github.com/GBeurier/nirs4all-webapp`** (Windows) : le **vrai** code. Les 320 fichiers
   non commités y sont le travail courant — **à committer/sauvegarder en priorité** (risque
   de perte indépendant de cette histoire).

Mon push sur `nirs4all-studio/master` ne pollue PAS `nirs4all-webapp` (dépôts séparés), mais
il pose un dépôt "officiel" trompeur basé sur du vieux code.

---

## 6. Recommandations

1. **Ne rien fusionner** de WSL→Windows automatiquement. 138 fichiers / 51 % collisionnent.
2. **Sauvegarder d'abord les 320 fichiers non commités** de `D:\nirs4all\nirs4all-webapp`
   (commit ou stash) — c'est le risque le plus urgent, sans rapport avec mon travail.
3. **Porter à la main, sur la vraie codebase, uniquement les 🟡** :
   - en priorité le **fix `na_policy`** (créer `api/shared/na_policy.py` + appeler
     `normalize_na_policy_in_config()` à chaque construction `DatasetConfigs`). Je peux le
     faire directement sur `D:\nirs4all\nirs4all-webapp` si tu veux.
   - vérifier/porter le **404 aggregated** et le **durcissement sécurité** si pertinents.
4. **Décider du sort de `nirs4all-studio` GitHub** : soit le re-créer depuis l'état Windows
   réel, soit l'abandonner. Garder éventuellement ma branche comme référence d'audit.
5. **Relancer l'audit/refactoring sur la vraie base** une fois celle-ci propre et commitée.

---

## Annexe — reproductibilité
Comparaison faite en fetchant (lecture seule) le dépôt Windows dans le repo WSL :
`git fetch D:\nirs4all\nirs4all-webapp\.git 'refs/heads/*:refs/remotes/wincopy/*'`.
Refs locales `wincopy/main`, `wincopy/operators_refactoring` ajoutées au repo WSL (supprimables
via `git remote`/`update-ref -d`). Ancêtre commun : `git merge-base master
wincopy/operators_refactoring` = `e512732`. Listes de fichiers : `/tmp/{mine,win_all,collision}.txt`.
