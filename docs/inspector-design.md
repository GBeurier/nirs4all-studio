# Inspector — Design Document

> **Prediction Explorer & Model Performance Analyzer**
> Suite d'analyse interactive pour explorer les prédictions par groupes et évaluer les performances des modèles, prétraitements, splits et hyperparamètres.

---

## 1. Vision & Objectifs

L'**Inspector** est le pendant "prédictions" du **Playground** (qui gère spectres et features). Il fournit une suite complète d'outils de dataviz et d'analyse pour explorer les résultats d'un run (ou de plusieurs runs) stockés dans le workspace DuckDB.

### Objectifs principaux

1. **Explorer les prédictions par groupes** — Sélectionner, filtrer et comparer des sous-ensembles de prédictions selon n'importe quelle dimension : modèle, prétraitement, split, dataset, branche, fold, hyperparamètre...
2. **Évaluer les performances** — Visualiser les métriques (RMSE, R², MAE, RPD, accuracy, F1...) de manière comparative pour identifier les meilleures configurations.
3. **Étudier la robustesse** — Analyser la variabilité des scores inter-folds, inter-datasets, inter-branches pour mesurer la stabilité des modèles.
4. **Diagnostiquer les erreurs** — Comprendre les patterns de prédiction (résidus, biais, outliers, confusion) pour guider l'amélioration des pipelines.
5. **Comparer les stratégies** — Heatmaps, rankings, diagrammes de branches pour explorer l'espace des combinaisons prétraitement × modèle × split.

### Philosophie de design

- **Shared selection** — Comme le Playground, un système de sélection partagé entre toutes les vues (multi-select, pin, saved selections, hover cross-highlight).
- **Configurable** — Chaque vue est configurable en couleurs, rendu, paramètres d'affichage, palettes.
- **Panneaux modulaires** — Architecture en panneaux maximisables/minimisables/masquables avec grille adaptative.
- **Filtrage non-destructif** — Les filtres d'affichage n'altèrent jamais les données sous-jacentes.

---

## 2. Architecture Globale

### 2.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│                        Inspector                              │
├──────────┬───────────────────────────────────────────────────┤
│          │                                                    │
│ Sidebar  │              Main Canvas                           │
│ (w-96)   │         (grille adaptive de panneaux)              │
│          │                                                    │
│ ┌──────┐ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│ │Source │ │  │  Scatter    │  │  Heatmap   │  │ Histogram  │  │
│ │Select │ │  │  Pred/Obs  │  │            │  │            │  │
│ │      │ │  └────────────┘  └────────────┘  └────────────┘  │
│ ├──────┤ │                                                    │
│ │Group │ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│ │Select │ │  │ Candlestick│  │  Residuals │  │  Confusion │  │
│ │      │ │  │            │  │            │  │   Matrix   │  │
│ ├──────┤ │  └────────────┘  └────────────┘  └────────────┘  │
│ │Filter │ │                                                    │
│ │Panel │ │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│ │      │ │  │  Branch    │  │  Robustness│  │  Rankings  │  │
│ ├──────┤ │  │  Diagram   │  │  Radar     │  │  Table     │  │
│ │Color │ │  └────────────┘  └────────────┘  └────────────┘  │
│ │Config│ │                                                    │
│ └──────┘ │                                                    │
└──────────┴───────────────────────────────────────────────────┘
```

### 2.2 Flux de données

```
DuckDB (WorkspaceStore)
    │
    ├── v_chain_summary (chaînes agrégées)
    ├── predictions (prédictions individuelles fold-level)
    └── artifacts (modèles, configs)
    │
    ▼
FastAPI Backend  ──── /api/inspector/* endpoints
    │
    ▼
React Frontend (Inspector page)
    │
    ├── InspectorDataContext (données chargées, groupes calculés)
    ├── InspectorSelectionContext (sélection partagée entre vues)
    ├── InspectorFilterContext (filtres d'affichage)
    ├── InspectorColorContext (configuration couleur globale)
    └── InspectorViewContext (visibilité/layout des panneaux)
```

### 2.3 Composants principaux

| Composant | Rôle |
|-----------|------|
| `Inspector.tsx` | Page entry point, providers wrapper |
| `InspectorSidebar.tsx` | Source selection, group builder, filters, color config |
| `InspectorCanvas.tsx` | Grille adaptive de panneaux de visualisation |
| `InspectorPanel.tsx` | Wrapper réutilisable (header, max/min/hide, footer stats) |
| `InspectorToolbar.tsx` | Barre d'outils : export, layout mode, raccourcis |

---

## 3. Sidebar — Sélection & Configuration

### 3.1 Source Selection

Sélection des données à explorer :

- **Run selector** — Dropdown ou multi-select pour choisir un ou plusieurs runs.
- **Dataset filter** — Filtrer par dataset (multi-select).
- **Scope** — `all` | `top-N` (avec N configurable) | `custom filter`.

Le chargement est déclenché par un bouton "Load" ou automatiquement au changement de sélection (avec debounce).

### 3.2 Group Builder (Prediction Group Selector)

C'est l'outil central et distinctif de l'Inspector. Il permet de **créer des groupes de prédictions** qui seront comparés dans toutes les vues.

#### Concept

Un **groupe** est un sous-ensemble de prédictions défini par un ou plusieurs critères de filtrage. Les groupes sont nommés, colorés, et partagés entre toutes les visualisations.

#### Modes de groupement

| Mode | Description | Exemple |
|------|-------------|---------|
| `by_variable` | Grouper par une variable catégorielle | Par `model_class` → groupes "PLS", "RF", "SVM"... |
| `by_range` | Grouper par plage d'une variable numérique | Par `n_components` → "1-5", "6-10", "11-20" |
| `by_expression` | Grouper par expression booléenne combinée | `model_class="PLS" AND preprocessing CONTAINS "SNV"` |
| `by_top_k` | Top-K par métrique | Top 5 par RMSE sur validation |
| `by_branch` | Grouper par branche du pipeline | Branches nommées du run |
| `by_fold` | Grouper par fold | Fold 0, 1, 2, ... |
| `by_partition` | Grouper par partition | train, val, test |
| `manual` | Sélection manuelle dans un tableau | Cocher individuellement |

#### Variables disponibles pour le groupement

Extraites des métadonnées des prédictions :

| Catégorie | Variables |
|-----------|-----------|
| **Modèle** | `model_name`, `model_class`, `best_params.*` |
| **Prétraitement** | `preprocessings` (chaîne complète), `preprocessing_steps[]` (décomposé) |
| **Split** | `fold_id`, `partition`, `splitter_type` |
| **Pipeline** | `pipeline_id`, `pipeline_config`, `template_id`, `branch_name`, `branch_id` |
| **Dataset** | `dataset_name`, `n_samples`, `n_features` |
| **Run** | `run_id`, `run_name` |
| **Score** | `val_score`, `test_score`, `train_score` (pour groupement par plage) |

#### Interface du Group Builder

```
┌─ Group Builder ────────────────────────┐
│                                         │
│  Grouper par: [model_class      ▼]     │
│                                         │
│  ┌─ Groupes détectés ───────────┐      │
│  │ ● PLS Regression    (42)  ✕  │      │
│  │ ● Random Forest     (38)  ✕  │      │
│  │ ● SVR               (25)  ✕  │      │
│  │ ● Ridge             (18)  ✕  │      │
│  └──────────────────────────────┘      │
│                                         │
│  [+ Ajouter un groupe personnalisé]    │
│  [+ Combiner / Intersecter]            │
│                                         │
│  ── Couleurs ──                        │
│  Palette: [Tableau 10         ▼]       │
│  Mode:    [Catégoriel         ▼]       │
│                                         │
└─────────────────────────────────────────┘
```

### 3.3 Filter Panel

Filtres d'affichage non-destructifs (même pattern que le Playground) :

| Filtre | Options |
|--------|---------|
| **Partition** | all, train, val, test |
| **Task type** | regression, classification, all |
| **Metric** | Sélection de la métrique d'affichage |
| **Score range** | Slider min-max pour filtrer par score |
| **Outlier** | all, hide, only (basé sur Z-score ou IQR des résidus) |
| **Selection** | all, selected, unselected |

### 3.4 Global Color Configuration

Configuration couleur unifiée (comme `GlobalColorConfig` du Playground) :

| Paramètre | Options |
|-----------|---------|
| **Mode** | `group` (par groupe), `score` (gradient par score), `partition`, `fold`, `dataset`, `model_class`, `residual` |
| **Palette continue** | `blue_red`, `viridis`, `plasma`, `cividis`, `coolwarm`, `RdYlGn`... |
| **Palette catégorielle** | `tableau10`, `set1`, `set2`, `paired`, `default` |
| **Opacité non-sélectionnés** | 0.05 → 1.0 (slider, défaut: 0.25) |
| **Highlight sélection** | on/off |
| **Highlight hover** | on/off |

---

## 4. Système de Sélection Partagée

### 4.1 InspectorSelectionContext

Réplique le pattern du `SelectionContext` du Playground, adapté aux prédictions :

```typescript
interface InspectorSelectionState {
  // Sélection courante : ensemble d'IDs de prédiction (chain_id ou prediction_id)
  selectedItems: Set<string>;
  pinnedItems: Set<string>;
  hoveredItem: string | null;

  // Modes d'interaction
  selectionMode: 'replace' | 'add' | 'remove' | 'toggle';
  selectionLevel: 'chain' | 'prediction'; // granularité

  // Groupes sauvegardés
  savedSelections: SavedSelection[];

  // Historique
  history: Set<string>[];
  historyIndex: number;
}
```

### 4.2 Interactions cross-vues

- **Click** sur un point/barre/cellule → sélection de la prédiction/chaîne correspondante dans TOUTES les vues.
- **Hover** → highlight cross-chart (tous les panneaux montrent le même item en surbrillance).
- **Lasso/Box select** → sélection d'un ensemble dans les vues scatter.
- **Shift+Click** → ajout à la sélection.
- **Ctrl+Click** → toggle dans la sélection.
- **Escape** → clear selection.
- **Ctrl+Z / Ctrl+Shift+Z** → undo/redo de sélection.

### 4.3 Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Z` | Undo selection |
| `Ctrl+Shift+Z` | Redo selection |
| `Escape` | Clear selection |
| `Ctrl+A` | Select all (visible) |
| `Ctrl+I` | Invert selection |
| `1-9` | Toggle panneau de visualisation |
| `G` | Focus group builder |
| `F` | Focus filter panel |
| `?` | Aide |

---

## 5. Panneaux de Visualisation

Chaque panneau est encapsulé dans un `InspectorPanel` (comme `ChartPanel` du Playground) avec :
- Header avec titre, icône, boutons max/min/hide
- Footer avec statistiques contextuelles (n items, n selected, métrique affichée)
- Configuration locale accessible via icône engrenage
- Export (PNG, SVG, CSV des données)

### 5.1 Predicted vs Observed (Scatter)

> **Objectif** : Visualiser la qualité de prédiction pour un ou plusieurs modèles.

#### Description

Scatter plot des valeurs prédites (y_pred) vs observées (y_true) pour les prédictions sélectionnées/groupées. Ligne de référence y=x (perfect fit). Supporte overlay multi-groupes avec légende interactive.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_top_k()` — partie scatter.

#### Données requises

- `y_true[]`, `y_pred[]` par prédiction/chaîne
- Partition (train/val/test) pour coloration conditionnelle
- Métriques calculées (R², RMSE) affichées en annotation

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Affichage** | Points, densité (heatmap 2D), contours | Points |
| **Taille points** | 2-20px (slider) | 5 |
| **Opacité** | 0.1-1.0 | 0.7 |
| **Ligne de référence** | y=x, régression linéaire, les deux | y=x |
| **Bandes de confiance** | Aucune, ±1σ, ±2σ, ±RMSE | Aucune |
| **Axes** | Auto-scale, fixe, symétrique | Auto |
| **Annotations** | R², RMSE, n, equation, bias | R², RMSE |
| **Agrégation** | Aucune, par groupe metadata (mean/median) | Aucune |
| **Coloration** | Par groupe, par partition, par résidu, par fold | Par groupe |
| **Overlay** | Superposé, facet grid (1 subplot par groupe) | Superposé |

#### Interactions

- Lasso/box select pour sélectionner des prédictions.
- Hover → tooltip avec (y_true, y_pred, résidu, model, fold, sample info).
- Click sur point → sélection croisée dans tous les panneaux.
- Click sur légende de groupe → toggle visibilité du groupe.

---

### 5.2 Residuals Plot

> **Objectif** : Diagnostiquer les biais systématiques et l'hétéroscédasticité.

#### Description

Scatter plot des résidus (y_pred - y_true) vs y_pred (ou y_true, ou index). Ligne de référence à résidu=0. Permet de détecter les patterns de biais, la non-linéarité résiduelle, et les outliers.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_top_k()` — partie résidus, et aux fonctions de `evaluation.py` (`/evaluation/residuals`).

#### Données requises

- `y_true[]`, `y_pred[]` → calcul `residuals = y_pred - y_true`
- Optionnel : résidus standardisés (z-score)

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Axe X** | y_pred, y_true, sample index | y_pred |
| **Type résidus** | Bruts, standardisés, normalisés (% de y_range) | Bruts |
| **Bandes** | Aucune, ±1σ, ±2σ, ±3σ | ±2σ |
| **Histogramme marginal** | Aucun, à droite, en haut, les deux | À droite |
| **QQ-plot intégré** | On/off (mini-plot en incrustation) | Off |
| **Outliers** | Highlight (seuil configurable σ) | 2σ |
| **Coloration** | Par groupe, par partition, par magnitude résidu | Par groupe |
| **Taille points** | 2-20px | 5 |
| **Overlay** | Superposé, facet | Superposé |

#### Interactions

- Lasso/box select sur les résidus extrêmes → identifier les échantillons problématiques.
- Hover → tooltip (sample, y_true, y_pred, résidu, model).
- Cross-highlight avec Pred vs Obs (même point, deux vues).

---

### 5.3 Score Histogram

> **Objectif** : Visualiser la distribution des scores (R², RMSE...) sur l'ensemble des configurations.

#### Description

Histogramme des valeurs d'une métrique choisie, sur l'ensemble des chaînes/prédictions. Permet de voir la spread des performances, d'identifier les outliers, et de comparer les distributions entre groupes.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_histogram()` → `ScoreHistogramChart`.

#### Données requises

- Scores par chaîne (cv_val_score, cv_test_score, etc.) pour la métrique sélectionnée.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Métrique** | Dropdown (toutes métriques disponibles) | Métrique primaire du run |
| **Partition** | val, test, train | val |
| **Bins** | Auto (Sturges/FD), 10, 20, 50, custom | Auto |
| **Layout** | Overlapping, stacked, side-by-side, staggered | Overlapping |
| **Normalisation** | Count, density, percentage | Count |
| **KDE overlay** | On/off (Kernel Density Estimation) | Off |
| **Stats annotations** | Mean, median, std, quartiles | Mean, median |
| **Clip outliers** | On/off (IQR-based) | Off |
| **Coloration** | Par groupe, monochrome | Par groupe |

#### Interactions

- Click sur barre → sélectionner les prédictions dans cette plage de score.
- Hover → tooltip (range, count, % total).
- Brush horizontal → sélectionner une plage de scores.

---

### 5.4 Performance Heatmap

> **Objectif** : Comparer les performances sur une grille 2D de variables (ex: prétraitement × modèle, modèle × dataset).

#### Description

Heatmap colorée montrant une métrique de performance à l'intersection de deux variables catégorielles. Supporte le tri (Borda, Condorcet, consensus...), la normalisation, et le top-K filtering.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_heatmap()` → `HeatmapChart` (composant le plus complexe, ~1370 lignes).

#### Données requises

- Scores par (x_variable, y_variable) — agrégés depuis les prédictions.

#### Variables pour les axes

Chacun des deux axes peut être :
- `model_name`, `model_class`
- `preprocessing` (chaîne complète ou étapes individuelles)
- `dataset_name`
- `branch_name`, `branch_id`
- `fold_id`
- `splitter_type`
- Tout hyperparamètre extrait de `best_params`

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Variable X** | Dropdown de variables | `model_name` |
| **Variable Y** | Dropdown de variables | `preprocessing` |
| **Métrique affichée** | Dropdown métriques | RMSE (regression) / Accuracy (classification) |
| **Partition affichée** | val, test, train | val |
| **Agrégation de ranking** | best, worst, mean, median | best |
| **Agrégation d'affichage** | best, worst, mean, median | mean |
| **Tri** | value, mean, median, borda, condorcet, consensus, alphabetical | borda |
| **Normalisation** | Aucune, per-column, per-row, global min-max | Aucune |
| **Top-K** | Désactivé, 5, 10, 20, custom | Désactivé |
| **Palette** | `RdYlGn`, `viridis`, `plasma`, `coolwarm`... | `RdYlGn` |
| **Annotations** | Valeurs, ranks, les deux, aucune | Valeurs |
| **Column scale** | Indépendant, unifié | Unifié |

#### Interactions

- Click sur cellule → sélectionner toutes les prédictions correspondant à (x, y).
- Hover → tooltip (x_value, y_value, score, rank, n_folds).
- Click sur header de ligne/colonne → sélectionner tous les items de cette ligne/colonne.

---

### 5.5 Candlestick (Box Plot)

> **Objectif** : Visualiser la distribution des scores par catégorie avec min/Q25/median/Q75/max.

#### Description

Box-and-whisker plot montrant la variabilité d'une métrique pour chaque valeur d'une variable catégorielle. Idéal pour comparer la robustesse des modèles ou prétraitements.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_candlestick()` → `CandlestickChart`.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Variable** | Dropdown (même que heatmap axes) | `model_class` |
| **Métrique** | Dropdown métriques | Métrique primaire |
| **Partition** | val, test, train | val |
| **Orientation** | Horizontal, vertical | Vertical |
| **Outliers** | Montrer (points), masquer, highlight | Montrer |
| **Violin overlay** | On/off (distribution kernel) | Off |
| **Swarm overlay** | On/off (points individuels jittés) | Off |
| **Tri** | Par médiane, par moyenne, alphabétique, par spread (IQR) | Par médiane |
| **Coloration** | Par variable, par groupe, monochrome | Par variable |

#### Interactions

- Click sur box → sélectionner toutes les prédictions de cette catégorie.
- Click sur outlier point → sélectionner cette prédiction.
- Hover → tooltip (min, Q25, median, mean, Q75, max, IQR, n).

---

### 5.6 Confusion Matrix (Classification)

> **Objectif** : Visualiser la matrice de confusion pour les tâches de classification.

#### Description

Heatmap de la matrice de confusion (classes réelles vs prédites) avec annotations (count et/ou pourcentage). Supporte la normalisation par ligne (recall) ou par colonne (precision).

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_confusion_matrix()` → `ConfusionMatrixChart`.

#### Conditions d'affichage

Ce panneau n'est visible que si `task_type` est `binary_classification` ou `multiclass_classification`.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Normalisation** | Aucune (counts), par ligne (recall), par colonne (precision), globale | Aucune |
| **Annotations** | Count, percentage, les deux | Les deux |
| **Palette** | `Blues`, `Greens`, `Reds`, `YlOrRd` | `Blues` |
| **Tri classes** | Alphabétique, par fréquence, custom | Alphabétique |
| **Métriques overlay** | Precision, Recall, F1 par classe (barre latérale) | Off |
| **Multi-model** | Facet grid (1 matrice par modèle/groupe) | Single |

#### Interactions

- Click sur cellule → sélectionner les échantillons correspondant à (true_class, pred_class).
- Hover → tooltip (true, pred, count, %).

---

### 5.7 Branch Comparison

> **Objectif** : Comparer les performances entre branches parallèles d'un pipeline.

#### Description

Graphique en barres avec intervalles de confiance montrant la performance moyenne par branche. Identifie visuellement la meilleure branche et la variabilité.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_branch_comparison()` et `plot_branch_boxplot()`.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Type** | Barres + CI, boxplot, violin, dot plot | Barres + CI |
| **Métrique** | Dropdown | Métrique primaire |
| **Partition** | val, test, train | val |
| **Intervalle de confiance** | 90%, 95%, 99%, none | 95% |
| **Tri** | Par score moyen, par nom, par variabilité | Par score |
| **Highlight best** | On/off (couleur distincte pour le meilleur) | On |
| **Nested view** | Plat, hiérarchique (groupé par level) | Plat |
| **Coloration** | Par branche, par groupe, monochrome | Par branche |

#### Interactions

- Click sur barre → sélectionner toutes les prédictions de cette branche.
- Hover → tooltip (mean, std, CI, n_folds, best/worst fold).

---

### 5.8 Branch Topology Diagram

> **Objectif** : Visualiser la structure topologique du pipeline (DAG) avec métriques overlay.

#### Description

Diagramme dirigé (DAG) montrant les étapes du pipeline, les branchements, et les fusions. Chaque noeud affiche la métrique associée. Les branches sont colorées par performance.

#### Lien PredictionAnalyzer

Correspond à `PredictionAnalyzer.plot_branch_diagram()` → `PipelineDiagram`.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Layout** | Horizontal (LR), vertical (TB) | LR |
| **Métrique overlay** | Dropdown | Métrique primaire |
| **Coloration noeuds** | Par type d'étape, par score, uniforme | Par type |
| **Labels** | Nom complet, abrégé, score only | Abrégé + score |
| **Highlight path** | Meilleur chemin, sélection courante | Meilleur |

#### Interactions

- Click sur noeud → sélectionner les prédictions passant par cette branche.
- Hover → tooltip (étape, paramètres, score moyen).

---

### 5.9 Robustness Radar

> **Objectif** : Évaluer la robustesse multi-critères d'un modèle ou groupe de modèles.

#### Description

Spider/radar chart montrant plusieurs dimensions de robustesse normalisées :
- **CV stability** — Écart-type des scores inter-folds (inversé : faible variabilité = bon).
- **Train-test gap** — Différence entre score train et score val/test (petit gap = bon).
- **Cross-dataset** — Performance moyenne sur différents datasets (si multi-dataset).
- **Score absolu** — Performance brute normalisée.
- **Outlier resistance** — Proportion de folds sans dégradation majeure.
- **Prediction spread** — Uniformité de la distribution des résidus.

#### Données requises

Calculées côté backend à partir des prédictions :
- Scores par fold → stabilité CV
- Scores train vs val → gap
- Scores par dataset → cross-dataset
- Résidus → spread et outlier resistance

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Axes** | Sélection/désélection des dimensions | Toutes |
| **Normalisation** | Global (0-1 sur tout le run), local (par groupe) | Global |
| **Multi-overlay** | Superposé, facet | Superposé |
| **Fill** | Remplissage semi-transparent, outline only | Fill |
| **Coloration** | Par groupe | Par groupe |
| **Reference** | Montrer/masquer la référence "parfait" | On |

#### Interactions

- Click sur aire → sélectionner le groupe.
- Hover sur axe → tooltip détaillé de la dimension.
- Toggle groupes dans la légende.

---

### 5.10 Fold Stability Plot

> **Objectif** : Visualiser la stabilité des scores à travers les folds de cross-validation.

#### Description

Line chart ou strip chart montrant l'évolution du score par fold pour chaque modèle/groupe. Met en évidence les folds problématiques et la variance inter-fold.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Type** | Lines (connected), strip (jitter), paired (train+val) | Lines |
| **Métrique** | Dropdown | Métrique primaire |
| **Partition** | val, test, train, val+test overlay | val |
| **Bandes** | Mean ± std, median ± IQR, none | Mean ± std |
| **Tri folds** | Par index, par score (asc/desc) | Par index |
| **Coloration** | Par groupe, par fold | Par groupe |

#### Interactions

- Click sur point → sélectionner la prédiction de ce fold.
- Hover → tooltip (fold, score, model, écart à la moyenne).
- Click sur fold label → sélectionner toutes les prédictions de ce fold.

---

### 5.11 Rankings Table

> **Objectif** : Tableau interactif de classement des configurations avec multi-critères.

#### Description

Tableau trié montrant les chaînes/modèles classés par performance, avec colonnes configurables. Supporte le multi-tri, le filtrage inline, et l'expansion des détails.

#### Données affichées

| Colonne | Source |
|---------|--------|
| Rank | Calculé |
| Model | `model_name` |
| Preprocessing | `preprocessings` |
| Branch | `branch_name` |
| CV Val Score | `cv_val_score` |
| CV Test Score | `cv_test_score` |
| Final Test Score | `final_test_score` |
| Fold Count | `cv_fold_count` |
| Std (variabilité) | Écart-type des scores inter-folds |
| Dataset | `dataset_name` |

#### Lien PredictionAnalyzer

Correspond à `TabReportManager.generate_per_model_summary()` et aux modes de nommage NIRS/ML.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Colonnes visibles** | Toggle par colonne | Toutes pertinentes |
| **Mode de nommage** | NIRS (RMSECV, RMSEP...), ML (CV_Score, Test_Score...) | Auto (selon métrique) |
| **Tri principal** | Click sur header | CV Val Score |
| **Direction tri** | Auto-detect (higher_better), manual | Auto |
| **Groupement** | Aucun, par dataset, par model_class | Aucun |
| **Densité** | Compact, normal, expanded | Normal |
| **Max rows** | 25, 50, 100, all | 50 |

#### Interactions

- Click sur ligne → sélectionner cette chaîne dans tous les panneaux.
- Multi-select (Shift+Click, Ctrl+Click).
- Double-click → ouvrir le détail (ChainDetailSheet).
- Tri multi-colonnes (Shift+Click sur headers).

---

### 5.12 Metric Correlation Matrix

> **Objectif** : Analyser les corrélations entre métriques pour comprendre la redondance et les trade-offs.

#### Description

Heatmap de corrélation entre toutes les métriques disponibles (RMSE, R², MAE, RPD, bias, SEP...). Permet de savoir si optimiser une métrique en optimise automatiquement une autre, ou s'il y a des trade-offs.

#### Pertinence chimiométrique

En NIRS, la relation entre RMSE, RPD, R² et biais n'est pas toujours linéaire. Cette vue aide à comprendre quelles métriques apportent de l'information complémentaire.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Métriques** | Multi-select des métriques à inclure | Toutes disponibles |
| **Méthode** | Pearson, Spearman, Kendall | Spearman |
| **Filtre magnitude** | Seuil minimal de corrélation (0-1) | 0 |
| **Affichage** | Full matrix, triangle supérieur, circle size | Triangle |
| **Palette** | `RdBu`, `coolwarm`, `PiYG` | `RdBu` |
| **Annotations** | Coefficients, significativité (p-value), aucune | Coefficients |

#### Interactions

- Click sur cellule → highlight les deux métriques concernées dans les autres vues.
- Hover → tooltip (r, p-value, n).

---

### 5.13 Preprocessing Impact Chart

> **Objectif** : Quantifier l'impact individuel de chaque étape de prétraitement sur les performances.

#### Description

Graphique montrant l'amélioration (ou dégradation) moyenne apportée par chaque prétraitement, calculée en marginalisant sur les autres variables (modèles, splits...).

#### Pertinence chimiométrique

En spectroscopie NIR, le choix du prétraitement (SNV, MSC, dérivées, baseline correction...) est critique. Cette vue permet de quantifier objectivement l'apport de chaque transformation, ce qui est rarement fait de manière systématique.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Type** | Bar (effet marginal), waterfall (cumulatif), paired (avec/sans) | Bar |
| **Métrique** | Dropdown | Métrique primaire |
| **Baseline** | Aucun prétraitement, moyenne globale | Moyenne globale |
| **Regroupement** | Individuel, par catégorie (scatter correction, derivative, baseline...) | Individuel |
| **Tri** | Par impact, alphabétique, par fréquence d'utilisation | Par impact |
| **Significativité** | On/off (test de Wilcoxon/Mann-Whitney) | Off |
| **Coloration** | Positif/négatif (vert/rouge), par catégorie | Positif/négatif |

#### Interactions

- Click sur barre → sélectionner les prédictions utilisant ce prétraitement.
- Hover → tooltip (preprocessing, mean improvement, CI, n_configs).

---

### 5.14 Hyperparameter Sensitivity

> **Objectif** : Visualiser l'influence d'un hyperparamètre numérique sur les performances.

#### Description

Scatter ou line chart montrant score vs valeur d'un hyperparamètre (ex: `n_components` pour PLS, `alpha` pour Ridge, `max_depth` pour RF). Détecte les zones optimales et le sur/sous-ajustement.

#### Pertinence ML

Essentiel pour comprendre si l'optimisation des hyperparamètres a trouvé un bon optimum et comment la performance évolue autour de celui-ci.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Hyperparamètre** | Dropdown (extrait de `best_params`) | Premier paramètre numérique détecté |
| **Métrique** | Dropdown | Métrique primaire |
| **Partition** | val, test, train, val+test | val |
| **Type** | Scatter, line (mean ± std), LOESS smooth | Scatter |
| **Échelle X** | Linéaire, log | Auto-detect |
| **Facet** | Aucun, par modèle, par dataset | Aucun |
| **Coloration** | Par groupe, par modèle, monochrome | Par groupe |
| **Annotations** | Optimum (vertical line), zone optimale | Optimum |

#### Interactions

- Brush horizontal → sélectionner les prédictions dans une plage d'hyperparamètre.
- Hover → tooltip (param_value, score, model, config).

---

### 5.15 Score Evolution (Learning Curve)

> **Objectif** : Visualiser l'évolution du score en fonction de la taille du dataset d'entraînement (si disponible).

#### Description

Line chart montrant comment le score train et val évoluent avec `n_samples`. Permet de diagnostiquer le sous/sur-ajustement et d'estimer si davantage de données aideraient.

#### Pertinence ML/chimiométrie

En NIRS, les datasets sont souvent petits. Cette vue aide à décider s'il est plus utile de collecter plus d'échantillons ou d'améliorer le pipeline.

#### Conditions d'affichage

Visible uniquement si les prédictions couvrent différentes tailles de dataset (multi-dataset ou progressive sampling).

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Axe X** | n_samples, n_features | n_samples |
| **Partitions** | Train only, val only, both | Both |
| **Bandes** | ± std, ± CI, none | ± std |
| **Échelle X** | Linéaire, log | Linéaire |
| **Coloration** | Par groupe, par partition | Par partition |

---

### 5.16 Bias-Variance Decomposition

> **Objectif** : Décomposer l'erreur en composantes bias² et variance pour chaque modèle/groupe.

#### Description

Stacked bar chart montrant la décomposition bias²/variance/bruit pour chaque configuration. Calculé via les prédictions multi-folds : `bias² = (mean_pred - y_true)²` et `variance = Var(predictions across folds)`.

#### Pertinence ML

Fondamental pour comprendre pourquoi un modèle échoue : trop simple (high bias) ou trop complexe (high variance). Guide directement le choix du modèle et de la régularisation.

#### Configurabilité

| Paramètre | Options | Défaut |
|-----------|---------|--------|
| **Décomposition** | Bias² + Variance, Bias² + Variance + Irréductible | Bias² + Variance |
| **Variable** | Par modèle, par prétraitement, par configuration | Par modèle |
| **Affichage** | Stacked bars, grouped bars, waterfall | Stacked bars |
| **Tri** | Par erreur totale, par bias, par variance | Par erreur totale |
| **Normalisation** | Absolu, relatif (%) | Absolu |
| **Coloration** | Bias (bleu), Variance (orange), Bruit (gris) | Standard |

#### Interactions

- Click sur segment → sélectionner le modèle.
- Hover → tooltip détaillé (bias², variance, total error, n_folds, n_samples).

---

## 6. Configuration des Panneaux

### 6.1 InspectorViewContext

```typescript
type InspectorChart =
  | 'scatter'         // 5.1 Predicted vs Observed
  | 'residuals'       // 5.2 Residuals
  | 'histogram'       // 5.3 Score Histogram
  | 'heatmap'         // 5.4 Performance Heatmap
  | 'candlestick'     // 5.5 Candlestick
  | 'confusion'       // 5.6 Confusion Matrix
  | 'branch'          // 5.7 Branch Comparison
  | 'topology'        // 5.8 Branch Topology
  | 'robustness'      // 5.9 Robustness Radar
  | 'fold_stability'  // 5.10 Fold Stability
  | 'rankings'        // 5.11 Rankings Table
  | 'correlation'     // 5.12 Metric Correlation
  | 'preprocessing'   // 5.13 Preprocessing Impact
  | 'hyperparameter'  // 5.14 Hyperparameter Sensitivity
  | 'learning_curve'  // 5.15 Score Evolution
  | 'bias_variance';  // 5.16 Bias-Variance

type ViewState = 'visible' | 'hidden' | 'maximized' | 'minimized';
type LayoutMode = 'auto' | 'grid-2' | 'grid-3' | 'grid-4' | 'single-column';

interface InspectorViewState {
  chartStates: Record<InspectorChart, ViewState>;
  maximizedChart: InspectorChart | null;
  layoutMode: LayoutMode;
  focusedChart: InspectorChart | null;
}
```

### 6.2 Chart Registry

Pattern extensible (comme le Playground) pour ajouter de futures visualisations :

```typescript
interface InspectorChartDefinition {
  id: InspectorChart;
  name: string;                    // i18n key
  icon: LucideIcon;
  component: React.ComponentType;
  category: 'core' | 'diagnostic' | 'comparison' | 'advanced';
  defaultVisible: boolean;
  priority: number;                // Ordre dans la grille
  taskTypes: ('regression' | 'classification' | 'all')[];
  requiresData: (data: InspectorData) => boolean;
}
```

### 6.3 Visibilité conditionnelle

Certains panneaux ne s'affichent que sous conditions :

| Panneau | Condition |
|---------|-----------|
| Confusion Matrix | `task_type` est classification |
| Branch Comparison / Topology | Le run contient des branches |
| Learning Curve | Données multi-tailles disponibles |
| Bias-Variance | >= 2 folds par modèle |
| Hyperparameter Sensitivity | >= 1 paramètre numérique variable |

---

## 7. Backend API — `/api/inspector/*`

### 7.1 Endpoints requis

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/inspector/data` | POST | Charger les données d'inspection (prédictions + métadonnées) |
| `/api/inspector/groups` | POST | Calculer les groupes selon les critères |
| `/api/inspector/scatter` | POST | Données scatter pred/obs + résidus pour un ensemble de chaînes |
| `/api/inspector/heatmap` | POST | Données de heatmap (matrice scores × 2 variables) |
| `/api/inspector/histogram` | POST | Distribution d'une métrique |
| `/api/inspector/candlestick` | POST | Stats boxplot par variable |
| `/api/inspector/confusion` | POST | Matrice de confusion agrégée |
| `/api/inspector/branches` | POST | Données de comparaison de branches |
| `/api/inspector/robustness` | POST | Métriques de robustesse multi-dimensionnelles |
| `/api/inspector/fold-stability` | POST | Scores par fold |
| `/api/inspector/rankings` | POST | Tableau de classement paginé + trié |
| `/api/inspector/correlation` | POST | Matrice de corrélation entre métriques |
| `/api/inspector/preprocessing-impact` | POST | Impact marginal des prétraitements |
| `/api/inspector/hyperparameter` | POST | Sensibilité à un hyperparamètre |
| `/api/inspector/bias-variance` | POST | Décomposition bias-variance |
| `/api/inspector/export` | POST | Export des données (CSV, JSON) |

### 7.2 Requête commune

Tous les endpoints partagent un corps de requête de base :

```python
class InspectorBaseRequest(BaseModel):
    run_ids: list[str] | None = None
    dataset_names: list[str] | None = None
    chain_ids: list[str] | None = None          # Filtre optionnel
    metric: str = "rmse"
    partition: str = "val"                        # val, test, train
    aggregate: str | None = None                  # Colonne d'agrégation (sample ID)
    aggregate_method: str = "mean"                # mean, median, vote
    groups: list[GroupDefinition] | None = None   # Groupes définis côté frontend
```

### 7.3 Délégation vers nirs4all

Le backend webapp est un **thin orchestration layer**. La logique d'analyse est dans nirs4all :

| Endpoint backend | Fonction nirs4all |
|-----------------|-------------------|
| `/inspector/heatmap` | `PredictionAnalyzer.plot_heatmap()` (données, pas la figure) |
| `/inspector/histogram` | `PredictionAnalyzer.plot_histogram()` (données) |
| `/inspector/candlestick` | `PredictionAnalyzer.plot_candlestick()` (données) |
| `/inspector/confusion` | `PredictionAnalyzer.plot_confusion_matrix()` (données) |
| `/inspector/branches` | `PredictionAnalyzer.branch_summary()` + `plot_branch_comparison()` |
| `/inspector/robustness` | Nouvelles fonctions à ajouter dans nirs4all analysis |
| `/inspector/correlation` | `core.metrics.eval_multi()` + numpy corrcoef |
| `/inspector/bias-variance` | Nouvelles fonctions à ajouter dans nirs4all analysis |
| `/inspector/preprocessing-impact` | Marginal analysis sur les prédictions existantes |

> **Note** : Certaines analyses (robustness radar, bias-variance, preprocessing impact) nécessiteront de nouvelles fonctions dans `nirs4all.analysis` ou `nirs4all.visualization`. C'est là que la logique doit vivre, pas dans le backend webapp.

---

## 8. Implémentation — Structure de fichiers

```
src/
├── pages/
│   └── Inspector.tsx                          # Page entry point
├── components/
│   └── inspector/
│       ├── InspectorSidebar.tsx                # Sidebar complète
│       ├── InspectorCanvas.tsx                 # Grille de panneaux
│       ├── InspectorPanel.tsx                  # Wrapper panneau réutilisable
│       ├── InspectorToolbar.tsx                # Barre d'outils
│       ├── SourceSelector.tsx                  # Sélection run/dataset
│       ├── GroupBuilder.tsx                    # Constructeur de groupes
│       ├── GroupChip.tsx                       # Chip de groupe (nom + couleur + count)
│       ├── FilterPanel.tsx                     # Panneau de filtres
│       ├── ColorConfigPanel.tsx                # Configuration couleurs
│       └── visualizations/
│           ├── PredVsObsChart.tsx              # 5.1
│           ├── ResidualsChart.tsx              # 5.2
│           ├── ScoreHistogram.tsx              # 5.3
│           ├── PerformanceHeatmap.tsx          # 5.4
│           ├── CandlestickChart.tsx            # 5.5
│           ├── ConfusionMatrixChart.tsx        # 5.6
│           ├── BranchComparison.tsx            # 5.7
│           ├── BranchTopology.tsx              # 5.8
│           ├── RobustnessRadar.tsx             # 5.9
│           ├── FoldStabilityChart.tsx          # 5.10
│           ├── RankingsTable.tsx               # 5.11
│           ├── MetricCorrelation.tsx           # 5.12
│           ├── PreprocessingImpact.tsx         # 5.13
│           ├── HyperparameterSensitivity.tsx   # 5.14
│           ├── LearningCurve.tsx               # 5.15
│           └── BiasVariance.tsx                # 5.16
├── context/
│   ├── InspectorSelectionContext.tsx
│   ├── InspectorFilterContext.tsx
│   ├── InspectorColorContext.tsx
│   ├── InspectorViewContext.tsx
│   └── InspectorDataContext.tsx
├── hooks/
│   ├── useInspectorData.ts                    # Chargement et cache des données
│   ├── useInspectorGroups.ts                  # Calcul des groupes
│   ├── useInspectorShortcuts.ts               # Raccourcis clavier
│   └── useInspectorExport.ts                  # Export PNG/CSV
├── lib/
│   └── inspector/
│       ├── colorConfig.ts                     # Configuration couleur
│       ├── grouping.ts                        # Logique de groupement côté client
│       ├── metrics.ts                         # Utils métriques (noms, directions)
│       └── chartRegistry.ts                   # Registre des panneaux
├── api/
│   └── inspector.ts                           # Client API
└── types/
    └── inspector.ts                           # Types TypeScript

api/                                           # Backend FastAPI
├── inspector.py                               # Routes /api/inspector/*
└── inspector_adapter.py                       # Bridge vers PredictionAnalyzer
```

---

## 9. Phases d'implémentation suggérées

### Phase 1 — Foundation
- Layout page (sidebar + canvas)
- InspectorDataContext (chargement depuis DuckDB)
- InspectorSelectionContext (sélection partagée basique)
- GroupBuilder (mode `by_variable` uniquement)
- **Panneaux** : Scatter Pred/Obs, Rankings Table, Score Histogram

### Phase 2 — Core Analysis
- InspectorFilterContext + InspectorColorContext
- GroupBuilder modes avancés (`by_range`, `by_top_k`, `by_branch`)
- **Panneaux** : Residuals, Performance Heatmap, Candlestick

### Phase 3 — Advanced Comparison
- Sélection avancée (lasso, pin, saved selections, undo/redo)
- **Panneaux** : Branch Comparison, Branch Topology, Fold Stability

### Phase 4 — Deep Diagnostics
- **Panneaux** : Confusion Matrix, Robustness Radar, Metric Correlation

### Phase 5 — Expert Analysis
- GroupBuilder mode `by_expression`
- **Panneaux** : Preprocessing Impact, Hyperparameter Sensitivity, Bias-Variance, Learning Curve
- Export complet (PDF report, multi-chart PNG, données CSV)

### Phase 6 — Polish
- Sessions persistées (comme PlaygroundSessionContext)
- Animations, transitions
- Performance WebGL pour gros volumes

---

## 10. Considérations techniques

### Performance

- **Lazy loading** : Les panneaux ne chargent leurs données que lorsqu'ils sont visibles.
- **Caching** : Les requêtes backend sont cachées par TanStack Query (stale-while-revalidate).
- **Pagination** : Le Rankings Table utilise la pagination serveur.
- **WebGL** : Pour les scatter plots > 10k points, utiliser le renderer WebGL (comme le Playground).
- **Debouncing** : Les changements de groupe/filtre sont debouncés (300ms).

### Responsivité

- Sur écrans larges : grille multi-colonnes avec sidebar fixe.
- Sur écrans moyens : sidebar collapsible, grille 2 colonnes.
- Sur mobile : sidebar overlay, vue single-column.

### Accessibilité

- Toutes les couleurs doivent passer le contrast ratio WCAG AA.
- Palettes colorblind-friendly disponibles (`cividis`, `viridis`).
- Navigation clavier complète dans le Rankings Table.
- Alt-text pour les graphiques dans les exports.

### i18n

Toutes les chaînes de l'interface utilisent i18next avec le namespace `inspector.*`.

---

## 11. Synergies avec les pages existantes

| Page existante | Lien avec Inspector |
|---------------|---------------------|
| **Predictions** | Le bouton "Analyze" dans Predictions ouvre l'Inspector avec les prédictions pré-filtrées. |
| **AggregatedResults** | Le bouton "Inspect" dans ChainDetailSheet ouvre l'Inspector centré sur cette chaîne. |
| **Results** | Le lien "Compare" entre datasets ouvre l'Inspector en mode multi-dataset. |
| **Playground** | Le prétraitement identifié comme optimal dans l'Inspector peut être envoyé au Playground pour visualisation spectrale. |
| **VariableImportance** | L'Inspector peut lier vers la page SHAP pour un modèle sélectionné. |
