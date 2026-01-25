# Backend Development Rules - MANDATORY

## RULE 1: USE NIRS4ALL LIBRARY FIRST

Before implementing ANY functionality in the webapp backend, check if it already exists in nirs4all:

- **Dataset** = `SpectroDataset` from nirs4all
- **Loading** = `nirs4all.data.loaders.*`
- **Detection** = `nirs4all.data.detection.*`, `FolderParser`
- **Parsing** = `nirs4all.data.parsers.*`
- **Shape/validation** = Already handled by SpectroDataset

**The webapp backend is a THIN ORCHESTRATION LAYER. It routes requests to nirs4all. Nothing more.**

## RULE 2: NEW FEATURES GO IN NIRS4ALL

If you need a new feature for:
- Pipelines
- Datasets
- Data processing
- Any core functionality

**It MUST be implemented in nirs4all library, NOT in the webapp backend.**

## RULE 3: ASK BEFORE IMPLEMENTING

If you don't find a feature in nirs4all:
1. **ASK the user first**
2. Do NOT implement a new feature in the webapp backend
3. The feature probably exists - search harder
4. If it truly doesn't exist, implement it in nirs4all

## What the webapp backend CAN do:

- HTTP routing (FastAPI endpoints)
- Request/response validation
- Authentication
- File upload handling (then delegate to nirs4all)
- Job queue management
- WebSocket connections
- UI-specific state (favorites, recent items)

## What the webapp backend CANNOT do:

- File parsing (use nirs4all loaders)
- Shape detection (use SpectroDataset)
- Delimiter/decimal detection (use nirs4all detection)
- Data transformation (use nirs4all operators)
- Any CSV/Parquet/Excel reading for data (use nirs4all)

## Examples of violations:

```python
# WRONG - reimplements nirs4all functionality
def _get_file_shape(file_path, delimiter, decimal):
    df = pd.read_csv(file_path, sep=delimiter, ...)
    return len(df), len(df.columns)

# RIGHT - use nirs4all
from nirs4all.data import DatasetConfigs
dataset = DatasetConfigs(config).get_datasets()[0]
shape = dataset.x().shape
```
