**Global**
- Add multi target handling (select target(s) in run and pipeline; in playground, how to sort ? prediction viz (2d / 3d / pca ?), etc. )
- clear console.log
- Review the whole runs/predictions/results loading process with the right table in the parquet (see nirs4all parquet format extension)
- add the capabilities to browse predictions parquet directly. or workspaces also (for runs, results, predictions)

**Desktop**
- Mouse wheel or zoom menu.
- Resize to window size (it's too small on my big screen)
- build problems
- VERY VERY VERY SLOW

**Dashboard**
- think it as settings more than dashboard or simply remove

**Settings**
- Configure correctly workspace (1 tab instead of two, separate web app workspace and nirs4all workspace(s))
- On update available put a distinctive markers on settings. When clicked it goes to update.

**API**
- verify that if functions shouldn't go to nirs4all (ie. umap)

**Datasets**
- Add drag n drop folder or files. Directly to create datasets, or into the dataset wizard. ANYWHERE IN THE APP.
- ScrollBar in list of files in wizard
- Add multiple targets
- Test/train not kept after wizard. So no test in playground. It's weird.
- by the way preview should allow to see all/test/or train
- To ease futur dataviz, the initial loading process (and refresh) should store quantiles / min / max / etc.
the page reload dataset each time, it should be cached
- put the image that comes often also in cache (y histogram, spectra chart with quantiles, train/test/folds)
- Enhance detailed view

**Runs / Results**
- Design role of both and what to focus on.


**Pipeline Builder**
- REFACTOR THE COMPONENTS. LOT LOT LOT OF REDONDANCIES
- REVIEW PARAM WINDOWS > MANY COPIES AND USELESS DIVS
- Extend the number of generators to match all existings in nirs4all > advanced checker
- item in menu overlap except for chart oO ? reduce item width
- Operator for sequential (the eqiuvalent of "[" "]" in nirs4all) ?? still necessary ?
- Finetuning: Move 'best model training" in a separate tab > "training".
- Enhance drop zone at last place of nested list. It's difficult.
- Seed is misplaced. Shouldn't be in settings but somewhere else

**Pipelines**
- Update to see saved / presets / etc.
- Review layout
- Add documentation and link to rtd for steps
- Add pipeline diagram preview when dataset is linked. Allow direct run creation with dataset linked. Validate shape when run or diagram.
- Review Seed.


**Playground**
- all possible view opened by default
- reup maximize, minimize

- step inverted; it affects preprocessed instead of original (rename step, change reference)
- single and selection area should be by default together. on click, select one, on click drag select area. Option only for non squared area
- OUTLIERS !
- export images does not work. It should have a popup with properties for the export (extension, title, name, etc.)

- desktop is very slow
- Ensure CACHE on transformations and dataviz is working: cache on processing not working (at least in desktop)
- the page reload dataset each time, it should be cached
- Global filter of sample (quartiles, stf max min, all) and local filter for spectra and pca
- make text of chart component unselectable. They are selected when drawing it's annoying
- add different level of resets (dataset, pipeline, views, views params)
- maybe same in pipeline > the first split should generate test not fold. Verify !

- Selection of reference (not final) should be by default raw with a combo in menu bar to choose another step
- Add save configuration (pipeline, views, options) and load. Just a name and a list for now
- Finish / clean / fix / review EXPORT GLOBAL
- add export to pipeline editor (and vice-versa) / import from or export to in pipeline editor
- Why warning ("one splitter only allowed") when opening view ? > I think there is a default splitter. Remove it.
- verify coloration, warning on classification
- Review the coloration by metadata. Some columns are bugged

- the zoom on
- why diff here ???

**Folds**
- hover tooltip
- combo transformed in checkable icons
- Bug on some metadata columns
- On color 'partition", validation/test colors are not uniform with other charts

**Spectra**
- Selected should be placed above. Test also. Hover also.
- in cm-1 webgl and canvas are mirrorred
- review right click menu. Or right click for panning, and left for selection
- settings are useless for now. See if removed or updated
- 3d grid option and quality to match canvas
- in selected color, "Keep color"
- deactivate tooltip during panning (and click)
- add colormap for quantiles drawing
- some views in webgl don't have the zoom/pan

**PCA**
- can sitch reference / final / both
- 3D, hidden points behind are not selected
- verify on hover same popup as canvas in regl and webgl >>> Remove regl ?
- 3d: show grid useless,
- Canvas rotation and selection control should be the same as webgl.
- Add skewness and kurtosis as metrics for PCA/Embedding

**Diff**
- Global filters such as selected only does not update the view
- repetition vaeriance ??? what does it do ?
- linear/log either useless or radio button
- line to display overral difference across all samples.
- Select quantile option (to select outliers)
- select samples when click on message (10 samples with high variability)
- display line based on 2 and 3 sigmas

**target histogram**
- combobox to icons for number of bars
- allow to choose targerts if multiple targets

**Settings**
- Add chinese
- Remove animation do not work (it's actually worse)
- Unify / clean / specify / distinguish nirs4all workspaces and app settings folder.
- Reinstall lib in advanced. GPU / CPU version ?.
- Reduce pin to backend
- Display installation problem
