**Global**
- App Icon
- Add nirs4all logo
- Add target selection each time a dataset is chosen
- Add multi target dataviz in quick view and detail dataset

**Dashboard**
- think it as settings more than dashboard or simply remove

**Settings**
- Configure correctly workspace
- Add space occupied / free space

**API**
- verify that if functions shouldn't go to nirs4all (ie. umap)


**Datasets**
Add drag n drop folder or files. Directly to create datasets, or into the dataset wizard.
ScrollBar in list of files in wizard

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




**Playground**
- Global filter of sample (quartiles, stf max min, all) and local filter for spectra and pca
- OUTLIERS !
- step inverted it affect preprocessed instead of original (rename step, change reference)
- make text of chart component unselectable. They are selected when drawing it's annoying
- better top ux menu
- select inside stacked bars
- single and selection area should be by default together. on click, select one, on click drag select area. Option only for non squared area
- reup maximize, minimize
- all possible view opened by default
- Selection of reference (not final) should be by default raw with a combo in menu bar to choose another step
- organize global menu to distinguish, selection icon, charts icon, reference combo, reference Dataset/step, color
- Add save configuration (pipeline, views, options) and load. Just a name and a list for now
- check export
- add export to pipeline editor (and vice-versa) / import from or export to in pipeline editor
- why diff here ???
- export images does not work. It should have a popup with properties for the export (extension, title, name, etc.)
- I should be possible to select sub bar in stacked bars
- the zoom on


**Folds**
- hover tooltip
- combo transformed in checkable icons
- the bar are not selected when others select

**Spectra**
- Selected should be placed above. Test also. Hover also.
- in cm-1 webgl and canvas are mirrorred
- review right click menu. Or right click for panning, and left for selection
- settings are useless for now. See if removed or updated
- 3d grid option and quality to match canvas
- in selected color, "Keep color"

**PCA**
- can sitch reference / final / both
- 3D, hidden points behind are not selected
- verify on hover same popup as canvas in regl and webgl
installHook.js:1 Error: (regl) invalid y offset for regl.read
    at ScatterRegl3D.tsx:656:24
    at ScatterRegl3D.tsx:680:21
>>> Remove regl ?
- on hover active option
- as for spectra chart. Make the hover tooltip optional
- 3d: show grid useless,
- Canvas rotation and selection control should be the same as webgl.



**Diff**
- pan on right click, selection and selection area on left
- repetition vaeriance ??? what does it do ?
- linear/log either useless or radio button
- line to display overral difference across all samples.
- make webgl / canvas view and switch between both.
- Global filters such as selected only does not update the view
- Select quantile option (to select outliers)

**target histogram**
- combobox to icons for number of bars





**Settings**
- Add chinese
- Remove animation do not work (it's actually worse)
- Unify / clean / specify / distinguish nirs4all workspaces and app settings folder.



**Runs / Results**
- Design role of both and what to focus on.