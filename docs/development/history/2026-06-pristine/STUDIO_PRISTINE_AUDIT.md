# Audit "pristine" de nirs4all Studio

> Historical development evidence (June 2026), retained verbatim below. For the
> released Rust product boundary, start at [the development index](../../README.md).

Date: 2026-06-27

Objectif: mettre Studio dans l'etat le plus maintenable possible avant les gros chantiers dag-ml / dag-ml-data / multimodal / cluster / WASM / benchmarks.

## Resume executif

Studio est fonctionnel et a deja plusieurs bonnes bases: React Query centralise une partie des donnees serveur, le transport HTTP est isole, le registre de nodes JSON est bien engage, les tests couvrent des contrats importants, et le backend a commence a extraire certains domaines (`workspace`, `playground`, `shared`, `updates`, `jobs`). Mais l'application n'est pas encore dans un etat "pristine" pour absorber la nouvelle stack.

Le risque principal n'est pas un manque de features: c'est l'absence de frontieres suffisamment stables entre les concepts metier. Aujourd'hui, les objets `Dataset`, `PipelineStep`, `Run`, `InspectorChainSummary` et `PlaygroundData` encodent encore le monde historique: spectres tabulaires, X/y dense, target principale, pipeline editable localement, execution locale en produit cartesien `pipelines x datasets`, resultats exposes comme chain summaries plats.

Les extensions prevues changent ces invariants. Avec dag-ml-data, un dataset devient un schema multi-source/multi-representation avec axes, relations, vues et validite par cible. Avec dag-ml, un pipeline devient un graphe reifiable, planifie, capable de previews, bundles, OOF, refit et explain. Avec nirs4all-cluster, un run devient une campagne ou un job distribue avec contraintes de capacites. Avec n4a-benchmarks, l'inspector doit raisonner sur des exports de resultats content-addressed, metriques versionnees et residuals sample-keyed, pas seulement sur le store local.

La priorite est donc de stabiliser les contrats et les responsabilites avant d'ajouter ces features. Il faut creer des couches "schema / graph / campaign / result analysis / capability" et deplacer progressivement la logique hors des grosses pages et contexts React.

## Perimetre observe

Audit effectue sur le repo local `/home/delete/nirs4all/nirs4all-studio`, avec lecture croisee des repos locaux suivants:

- `/home/delete/nirs4all/dag-ml`
- `/home/delete/nirs4all/dag-ml-data`
- `/home/delete/nirs4all/nirs4all-core`
- `/home/delete/nirs4all/nirs4all-formats`
- `/home/delete/nirs4all/nirs4all-io`
- `/home/delete/nirs4all/nirs4all-datasets`
- `/home/delete/nirs4all/nirs4all-cluster`
- `/home/delete/nirs4all/nirs4all-benchmarks`

Quelques ordres de grandeur utiles:

- Codegraph: 946 fichiers indexes, 15 939 symboles.
- `src`: environ 714 fichiers TS/TSX/PY detectes, 214k lignes.
- `api`: environ 73 fichiers Python, 44k lignes.
- Registre nodes: 319 nodes dans `canonical-registry.json`, 338 nodes dans les definitions curatees.
- Gros fichiers critiques: `src/utils/pipelineConverter.ts` (~2499 lignes), `api/inspector.py` (~2270), `api/pipeline_canonical.py` (~2250), `api/datasets.py` (~1919), `api/runs.py` (~1830), `api/store_adapter.py` (~1801), plusieurs visualisations playground >1500 lignes.

## Ce qui est deja solide

1. Le registre de nodes est une bonne direction.

   Les definitions sous `src/data/nodes/definitions`, le registre canonique genere, `NodeRegistryContext`, les tests de registry et `api/node_registry_loader.py` donnent une base pour eviter de hardcoder tous les operateurs dans l'UI. C'est essentiel pour les futurs backends `n4a-methods`, sklearn, CUDA/OMP/BLAS et WASM.

2. Les tests de conversion pipeline sont une vraie protection.

   `tests/test_pipeline_canonical.py`, `tests/test_pipeline_roundtrip.py`, `src/utils/__tests__/pipelineConverter.test.ts` et les tests de resolver couvrent un point qui deviendra encore plus critique avec dag-ml: l'aller-retour entre syntaxe utilisateur, representation editor et representation canonique.

3. Le backend a deja quelques separations utiles.

   `api/playground/executor.py` orchestre, `api/playground/steps.py` execute les steps, `api/playground/charts.py` produit les payloads de visualisation. `api/shared/pipeline_service.py`, `api/shared/runtime_grouping.py`, `api/shared/metrics_computer.py` sont des debuts de couche metier partagee.

4. L'app a deja une architecture de shell exploitable.

   `AppSidebar` separe deja prepare / explore / outcomes / apply. Cette structure peut devenir le squelette de la future UX: Dataset Builder, Pipeline/Campaign Builder, Execution, Results/Arena, Repository.

5. React Query est bien utilise a plusieurs endroits.

   Les caches dataset/workspace et les invalidations autour de `MlReadinessContext` montrent un effort pour eviter le couplage direct page -> fetch imperatif.

## Risques principaux

### 1. Les contrats metier sont trop plats pour le futur modele data

Fichiers representatifs:

- `src/types/datasets.ts`
- `src/types/playground.ts`
- `api/datasets.py`
- `api/playground/models.py`
- `api/playground/executor.py`

Le modele actuel reste centre sur:

- `X`, `Y`, `metadata`;
- partitions `train` / `test`;
- `num_samples`, `num_features`;
- `targets` comme colonnes;
- `n_sources` et `is_multi_source` comme extensions autour d'un coeur encore spectral dense.

Ce modele ne suffit pas pour dag-ml-data, qui possede schemas, axes, representations, vues immuables, relations sample/source/origin, fingerprints et plans de materialisation. Il manque une premiere-class abstraction pour:

- source heterogene;
- representation disponible ou demandee;
- axes/unit/dtype/ragged/sparse;
- relation entre `physical_sample`, `source_sample`, `observation`, `combo`;
- validite par target et multi-target;
- preview de schema sans materialiser tout le buffer;
- fingerprint stable du schema et du data plan.

Recommandation: introduire une couche `DatasetSchema` / `DataView` / `RepresentationPreview` dans Studio avant de brancher dag-ml-data. L'ancien `Dataset` doit devenir une projection UI de compatibilite, pas le modele central.

### 2. Les grosses pages orchestrent trop de logique

Fichiers representatifs:

- `src/pages/PipelineEditor.tsx` (~1244 lignes)
- `src/pages/Playground.tsx` (~815 lignes)
- `src/pages/NewExperiment.tsx` (~628 lignes)
- `src/pages/Datasets.tsx` (~938 lignes)
- `src/components/playground/MainCanvas.tsx` (~1254 lignes)
- `src/components/inspector/InspectorCanvas.tsx` (~909 lignes)

Ces pages melangent souvent:

- chargement API;
- etat UI local;
- persistance local/session storage;
- transformation de payload;
- navigation;
- toasts;
- logique metier;
- assemblage de layout.

Ca rend les refontes UX risquees parce que le comportement n'est pas porte par des modeles testables. Exemple: `NewExperiment.tsx` encode directement le flow `Select Pipelines -> Select Datasets -> Runtime Grouping -> Review -> Launch` et calcule `totalRuns = selectedDatasets.length * selectedPipelines.length`. C'est l'invariant exact que tu envisages de remplacer par `1 pipeline + 1 dataset`, ou par des campagnes avec previews et contraintes.

Recommandation: pour chaque grand domaine, creer une "feature slice" avec:

- `model/`: types, reducers, state machines, selectors;
- `api/`: client de domaine;
- `components/`: composants purs et reutilisables;
- `screens/`: composition route-level seulement;
- `adapters/`: conversion depuis/vers contrats legacy.

### 3. Le pipeline editor concentre trop de responsabilites dans un hook et deux convertisseurs

Fichiers representatifs:

- `src/hooks/usePipelineEditor.ts`
- `src/components/pipeline-editor/types.ts`
- `src/utils/pipelineConverter.ts`
- `api/pipeline_canonical.py`
- `src/components/pipeline-editor/config/step-renderers/*`

`usePipelineEditor` gere l'etat, l'historique undo/redo, la persistance `localStorage`, les mutations d'arbre imbrique, les branches, les children, la selection et l'export. `pipelineConverter.ts` et `api/pipeline_canonical.py` contiennent beaucoup de logique miroir.

Risque pour dag-ml:

- les previews de schema/data plan vont ajouter des dependances dataset dans l'edition;
- les variants/generators vont devoir etre planifies plutot que seulement comptes;
- Optuna/SHAP/refit doivent se brancher au pipeline reifie, pas a un modele final;
- les nodes devront exposer des capacites par backend et runtime;
- le futur WASM ne doit pas dependre d'un backend Python pour comprendre un pipeline.

Recommandation:

- Extraire un `pipelineGraphReducer` pur, teste, sans React ni storage.
- Extraire `pipelinePersistenceAdapter` pour drafts.
- Extraire `pipelineImportExport` avec contrat unique et fixtures partagees.
- Introduire un `PipelineGraphSpec` Studio proche de dag-ml `GraphSpec`, avec adaptateur legacy vers les steps actuels.
- Faire de `PipelineEditor.tsx` un screen qui assemble palette, tree, config panel, preview panel et toolbar, sans porter la logique de conversion.

### 4. Le flow run/campaign est encore un produit cartesien historique

Fichiers representatifs:

- `src/pages/NewExperiment.tsx`
- `src/types/runs.ts`
- `api/runs.py`
- `api/jobs/manager.py`
- `src/components/runs/*`

`api/runs.py:create_run` valide datasets et pipelines, boucle sur `dataset_ids`, boucle sur `pipeline_ids`, cree des `DatasetRun` et `PipelineRun`, puis lance un job local. C'est lisible pour le monde actuel, mais cette route deviendra un goulet d'etranglement avec:

- campagne `1 pipeline : 1 dataset`;
- previews de compatibilite schema/pipeline;
- decomposition asymetrique par source/repetition;
- execution locale ou cluster;
- contraintes de capacites worker;
- bundles dag-ml;
- reprise/idempotence;
- exports benchmark.

Recommandation: introduire un objet `CampaignSpec` distinct de `Run`.

Un `CampaignSpec` devrait contenir:

- dataset schema ou dataset reference + target/task selection;
- pipeline graph spec;
- preview / plan summary;
- execution backend (`local-python`, `cluster`, `wasm-local`, plus tard);
- capability requirements;
- run matrix explicite, pas implicite;
- expected artifacts;
- benchmark export policy.

`Run` doit devenir l'instance d'execution d'une campagne, pas le conteneur qui definit implicitement la campagne.

### 5. L'inspector est trop couple au store local et a des summaries plats

Fichiers representatifs:

- `api/inspector.py`
- `src/types/inspector.ts`
- `src/context/InspectorDataContext.tsx`
- `src/components/inspector/*`
- `api/store_adapter.py`

L'inspector actuel expose des `InspectorChainSummary` avec scores `cv_val_score`, `cv_test_score`, `final_test_score`, params, preprocessing string, branch path. Le frontend recalcule ensuite groupements, ranges, top-k et expressions.

Ce modele est limite pour n4a-benchmarks:

- les metriques doivent etre versionnees;
- les residuals sont sample-keyed;
- les resultats sont content-addressed;
- les producteurs peuvent etre nirs4all workspace, dag-ml bundle ou export `.n4a` sans poids;
- la quarantining / leakage honesty doit etre visible;
- les axes d'analyse sont `model x pipeline x split x cv x rng x refit x dataset`, pas seulement chain summary.

Recommandation:

- Creer un contrat `ResultStore` / `AnalysisStore` independant du `WorkspaceStore`.
- Aligner une partie du modele Studio sur `ArenaRunExport` / queries n4a-benchmarks.
- Faire de l'inspector une UI de requetes et vues analytiques, pas une collection de panels qui post-traitent un tableau plat.
- Deplacer groupements, ranking, metric direction, score selection et aggregations dans une couche d'analyse testee.

### 6. Les routes backend ont des responsabilites qui se recouvrent

Fichiers representatifs:

- `main.py`
- `api/workspace/router_datasets.py`
- `api/datasets.py`

`workspace_router` est inclus avant `datasets_router`. Les deux possedent des routes `/datasets/*`. Au moins ces routes sont dupliquees avec le meme chemin public:

- `DELETE /api/datasets/{dataset_id}`
- `POST /api/datasets/{dataset_id}/refresh`

Dans FastAPI, l'ordre d'enregistrement determine la resolution. Cela rend une partie du code masquee ou ambigue.

Recommandation:

- Choisir un proprietaire unique pour `datasets CRUD/linking`.
- Garder `api/datasets.py` pour detection/preview/materialisation, ou le renommer `api/dataset_intake.py`.
- Garder `workspace/router_datasets.py` pour groupes et liens globaux, ou le deplacer vers `api/dataset_links.py`.
- Ajouter un test qui liste les routes publiques et echoue sur collision methode+path apres application des prefixes.

### 7. Les capacites backend sont encore trop binaires

Fichiers representatifs:

- `api/system.py`
- `src/hooks/useBackendCapabilities.ts`
- `src/lib/pipelineOperatorAvailability.ts`
- `src/components/pipeline-editor/contexts/OperatorAvailabilityContext.tsx`
- `src/hooks/useOperatorRegistry.ts`

Le systeme actuel sait dire qu'un module est importable ou qu'un operateur est indisponible. Pour les futurs backends, il faut un modele beaucoup plus riche:

- `metadata`: visible mais non executable;
- `plan`: planifiable mais pas executable ici;
- `execute-local`;
- `execute-remote`;
- `execute-wasm`;
- `parity-validated`;
- contraintes hardware (`cuda`, `omp`, `blas`, memoire);
- contraintes package/version;
- source de l'implementation (`n4a-methods`, `sklearn`, custom, remote).

Cette grille existe deja dans l'esprit du contrat equivalent `nirs4all-core/docs/OPERATORS.md`. Studio devrait l'adopter avant d'ajouter les nouveaux nodes.

### 8. La persistance locale est dispersee

Fichiers representatifs:

- `src/hooks/usePipelineEditor.ts`
- `src/hooks/useDatasetBinding.ts`
- `src/hooks/usePlaygroundPipeline.ts`
- `src/context/InspectorSessionContext.tsx`
- `src/context/PlaygroundSessionContext.tsx`
- `src/context/UISettingsContext.tsx`
- `src/data/nodes/custom/CustomNodeStorage.ts`
- `src/lib/pipelineOperatorAvailability.ts`

Il y a beaucoup de `localStorage` / `sessionStorage` directs. Certains sont legitimes, mais les migrations et la portee des donnees ne sont pas uniformes.

Risques:

- collisions de versions pendant migration;
- drafts incompatibles avec nouveaux `PipelineGraphSpec`;
- bindings dataset/pipeline obsoletes;
- comportement different web/Electron/WASM;
- impossibilite d'auditer les donnees client stockees.

Recommandation:

- Creer `src/lib/clientStorage/` avec key registry, versioning, TTL, migrations et tests.
- Interdire les nouveaux appels directs a `localStorage` hors de cette couche.
- Definir quels etats sont session-only, workspace-scoped, user-scoped, runtime-scoped.

### 9. L'environnement et les docs ne sont pas parfaitement coherents

Constats:

- `.nvmrc` demande Node 24.
- `package.json` requiert Node >=20 et npm >=10, version app 0.9.1.
- `package-lock.json` annonce encore version 0.8.2.
- Le shell courant trouve `npm` dans `/mnt/c/Program Files/nodejs`, mais `node` n'est pas resolu; le README alerte justement contre les PATH Windows injectes dans WSL.
- Le README mentionne `npm start` et `npm run stop`, absents de `package.json`.

Recommandation:

- Remettre lockfile et package version en coherence.
- Clarifier Node 24 vs Node >=20.
- Corriger les commandes README.
- Ajouter un script `doctor` ou `dev:check-env` qui detecte Node/npm/Python/venv, surtout WSL.

### 10. Les garde-fous qualite sont trop permissifs pour une refonte longue

Fichiers representatifs:

- `eslint.config.js`
- `tsconfig.app.json`
- `ruff.toml`

Constats:

- `@typescript-eslint/no-unused-vars` desactive.
- `noUnusedLocals` et `noUnusedParameters` desactives.
- Pas de regles d'import/layers pour empecher les features de s'importer entre elles.
- Ruff ignore plusieurs signaux; la line-length Python est tres large.
- Pas de check automatique des collisions de routes.

Recommandation:

- Ajouter des regles de boundaries progressivement, pas en big bang.
- Activer au moins les unused vars avec convention `_`.
- Ajouter une regle d'interdiction des imports `pages -> pages`, `components/domainA -> components/domainB`.
- Ajouter un check de taille/fichiers hotspot informatif dans CI.

## Architecture cible conseillee

### Frontend

Structure cible progressive:

```text
src/
  app/                  # routing, providers, shell, feature flags
  shared/
    ui/                 # shadcn primitives + composants vraiment generiques
    api/                # transport, erreurs, query helpers
    storage/            # local/session storage versionne
    charts/             # primitives chart reutilisables
    domain/             # types transversaux stables si non generes
  features/
    datasets/
      model/
      api/
      components/
      screens/
      adapters/
    pipelines/
    campaigns/
    execution/
    playground/
    results/
    inspector/
    repository/
    settings/
```

Regles:

- `screens` assemblent seulement.
- `model` contient reducers/selectors/state machines testables.
- `components` ne fetchent pas directement sauf composants route-level explicites.
- `api` expose des fonctions de domaine et des query keys.
- `adapters` isolent legacy <-> futur contrat.
- `shared/ui` ne contient pas de logique nirs4all.

### Backend

Structure cible progressive:

```text
api/
  routers/              # FastAPI thin routes seulement
  services/
    dataset_intake.py
    dataset_schema.py
    pipeline_graph.py
    campaign_planner.py
    execution.py
    result_analysis.py
    capabilities.py
  adapters/
    nirs4all_legacy.py
    dag_ml.py
    dag_ml_data.py
    nirs4all_io.py
    cluster.py
    arena.py
  contracts/
    datasets.py
    pipelines.py
    campaigns.py
    results.py
    capabilities.py
```

Regles:

- Les routes ne font pas de logique metier lourde.
- Les contrats Pydantic sont regroupes par domaine.
- Les adapters sont les seuls a importer `nirs4all`, `dag_ml`, `dag_ml_data`, `nirs4all_cluster`, etc.
- Les services retournent des contrats Studio stables.
- Les erreurs sont normalisees avec codes machine, pas seulement `detail` texte.

## Alignement avec les extensions prevues

### 1. Donnees multimodales et playground decompose

Besoin cible:

- Dataset schema explorer.
- Source/relation viewer.
- Representation preview.
- Transformation preview par data view.
- Validation target/masks.

Refactor prealable:

- Ne plus faire du playground le seul lieu de preview.
- Extraire `DataPreviewPanel`, `RepresentationSelector`, `SourceRelationView`, `TargetValidityView`.
- Remplacer `PlaygroundData { x, y, wavelengths }` par `DataViewRef + materialized preview`.

### 2. Pipelines et configurations dataset plus complexes

Besoin cible:

- Pipeline lie a un dataset/schema pour preview.
- Planification avant execution.
- Presets parametrables par schema/capabilites.
- Definition claire entre pipeline template, pipeline instance, campaign plan.

Refactor prealable:

- Extraire `PipelineGraphSpec`.
- Ajouter `PipelinePreviewService`.
- Ne pas injecter la logique dataset dans `usePipelineEditor`.

### 3. nirs4all-cluster

Besoin cible:

- Selection backend execution.
- Worker capabilities.
- Job leases/retries/cancel.
- Artifact download.
- Live events.

Refactor prealable:

- Introduire `ExecutionBackend` et `CampaignRun`.
- Ne pas faire de `api/runs.py` le seul orchestrateur.
- Unifier WebSocket events locaux et cluster dans un contrat UI.

### 4. Optuna et SHAP au niveau pipeline reifie

Besoin cible:

- HPO/explain nodes ou policies attaches au graph.
- Resultats lies a plan/fold/refit/prediction level.
- UI de configuration independante du modele sklearn 1D.

Refactor prealable:

- Sortir `FinetuneConfig` et SHAP de la logique "model step only".
- Ajouter `AnalysisAttachment` / `OptimizationSpec` au graph.
- Faire remonter les capacites par node/backend.

### 5. Plusieurs backends de methodes et options calcul

Besoin cible:

- Node capability matrix.
- Backend selection / preference / fallback.
- Runtime constraints.
- Diagnostics explicites.

Refactor prealable:

- Remplacer availability binaire par `CapabilityLevel`.
- Ajouter `implementationRefs` dans les node definitions.
- Stocker les contraintes compute dans le plan/campaign, pas dans l'UI.

### 6. Generation complexe, previews, schema, 1 pipeline avec 1 dataset

Besoin cible:

- Preview du nombre de runs, transformations, folds, refits, aggregations.
- Schema compatibility check.
- Campagnes explicites.

Refactor prealable:

- Remplacer le wizard `NewExperiment` par `CampaignBuilder`.
- Faire du produit cartesien un mode explicite "batch matrix", pas le modele par defaut.
- Ajouter une page `Plan Preview` avant launch.

### 7. Meta-analyse resultats / n4a-benchmarks

Besoin cible:

- Ingestion/export Arena.
- Metriques versionnees.
- Residuals sample-keyed.
- Views leaderboard, matrix, robustness, complementarity.

Refactor prealable:

- Isoler `ResultAnalysisStore`.
- Aligner `Inspector` sur des queries d'analyse, pas sur `InspectorChainSummary` plat.
- Ajouter un adaptateur `WorkspaceStore -> Arena-like export` pour transition.

### 8. Acces n4a-repo

Besoin cible:

- Naviguer recettes/pipelines/datasets distants.
- Installer/importer des assets versionnes.
- Comparer local vs repo.

Refactor prealable:

- Ajouter un domaine `repository` separe.
- Eviter que `Pipelines` ou `Datasets` melangent local, linked, repo et benchmark sans type discriminant.

### 9. Unification n4a-studio / n4a-web / future WASM pure

Besoin cible:

- UI sans dependance obligatoire a FastAPI Python pour les flows purs.
- Contrats partages.
- Runtime adapter Python/WASM.
- Browser-safe file IO pour formats/io/datasets.

Refactor prealable:

- Sortir les contrats TS dans une couche stable.
- Identifier les operations "runtime local" vs "server required".
- Eviter les conversions canonical uniquement backend.
- Remplacer les chemins filesystem par des `InputRef` abstraits quand possible.

## Roadmap recommandee

### P0 - Hygiene bloquante avant gros chantier

1. Corriger environnement et docs:
   - synchroniser `package-lock.json` avec `package.json`;
   - clarifier Node 24 vs >=20;
   - corriger README (`npm start`, `npm run stop`);
   - ajouter un `doctor` WSL/Node/Python.

2. Supprimer les collisions de routes dataset:
   - proprietaire unique pour link/list/delete/refresh;
   - test route table.

3. Creer une couche `clientStorage`:
   - registry de cles;
   - versions;
   - migrations;
   - tests.

4. Ajouter un document de boundaries:
   - qui possede datasets, pipelines, campaigns, results;
   - quels modules peuvent importer quels modules.

5. Activer des checks doux:
   - unused vars avec exceptions `_`;
   - route collision check;
   - lockfile version check.

### P1 - Contrats Studio stables

1. Definir `DatasetSchemaRef`, `DataViewRef`, `RepresentationPreview`.
2. Definir `PipelineGraphSpec` et adaptateur legacy.
3. Definir `CampaignSpec`, `PlanPreview`, `ExecutionBackend`.
4. Definir `ResultAnalysisQuery` et `ResultAnalysisView`.
5. Definir `CapabilityReport` multi-niveau.

Ces contrats peuvent d'abord envelopper les API existantes sans changer toute l'UI.

### P2 - Decoupage frontend

1. Extraire `features/datasets`.
2. Extraire `features/pipelines`.
3. Extraire `features/campaigns`.
4. Extraire `features/results`.
5. Garder `src/components/ui` strictement generique.

Commencer par deplacer les modeles purs et hooks, puis les screens.

### P3 - Dataset/schema workbench

1. Transformer le DatasetWizard en schema builder.
2. Ajouter previews par source/representation/target.
3. Brancher nirs4all-io puis dag-ml-data comme adapters.
4. Garder l'ancien flow X/Y comme "classic import".

### P4 - Pipeline/campaign planning

1. Adapter le pipeline editor a `PipelineGraphSpec`.
2. Ajouter plan preview dataset-aware.
3. Remplacer `NewExperiment` par `CampaignBuilder`.
4. Introduire execution backend local/cluster.

### P5 - Results/Arena/Inspector

1. Ajouter export/import Arena-like.
2. Refondre inspector autour de queries.
3. Ajouter vues n4a-benchmarks progressivement.
4. Conserver `WorkspaceStore` via adapter.

### P6 - WASM/web unification

1. Identifier les flows sans backend Python.
2. Ajouter runtime adapter WASM pour formats/io/dag-ml-data/dag-ml quand disponible.
3. Faire converger Studio et web sur les memes features pures.

## Definition de "pristine" pour ce repo

Le repo sera vraiment pret pour les gros chantiers quand:

- un nouveau contrat data/pipeline/campaign/result peut etre ajoute sans modifier une page de 800 lignes;
- les routes publiques ont un proprietaire unique et des tests de collision;
- les nodes exposent des capacites multi-backend, pas seulement des imports Python;
- les conversions pipeline ont une source de verite claire et des fixtures partagees;
- les previews dataset/pipeline passent par des services dedies;
- le produit cartesien `n pipelines x m datasets` est une option de campagne, pas un invariant;
- l'inspector peut lire un store local ou un export benchmark par le meme contrat;
- la persistance client est versionnee et migrable;
- les docs d'installation et le lockfile refletent l'etat reel;
- les gros composants graphiques sont decomposes en panels/composants reutilisables et modeles testables.

## Priorites concretes

Si je devais commencer demain, je ferais dans cet ordre:

1. Nettoyer routes dataset + lockfile/docs/env.
2. Extraire `CampaignSpec` et remplacer le calcul implicite `datasets.length * pipelines.length` par un plan explicite, meme si l'UI reste identique au debut.
3. Extraire `PipelineGraphSpec` + reducer pur du pipeline editor.
4. Introduire `DatasetSchemaRef` comme facade autour du `Dataset` actuel.
5. Remplacer availability binaire par capability matrix.
6. Creer `ResultAnalysisStore` et un adapter depuis l'inspector actuel.
7. Decouper les grosses pages en feature slices apres stabilisation des contrats.

Ce plan evite de bloquer les features futures, tout en gardant la compatibilite avec les signatures publiques existantes.
