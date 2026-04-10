# nirs4all-webapp/scripts/generate_seed_presets.py — run from the repo root
import yaml
from sklearn.cross_decomposition import PLSRegression
from sklearn.model_selection import KFold
from sklearn.cross_decomposition import PLSRegression
from sklearn.linear_model import Ridge
from sklearn.preprocessing import MinMaxScaler, StandardScaler

from nirs4all.operators.transforms import StandardNormalVariate
from nirs4all.pipeline.config.component_serialization import serialize_component
from nirs4all.operators.splitters.splitters import SPXYFold, SPXYGFold
from nirs4all.operators.transforms import (
    AreaNormalization,
    ASLSBaseline,
    Baseline,
    Derivate,
    Detrend,
    FlexiblePCA,
    Gaussian,
    Haar,
    IdentityTransformer,
    KubelkaMunk,
    Normalize,
    SavitzkyGolay,
    ToAbsorbance,
)
from nirs4all.operators.transforms import (
    ExtendedMultiplicativeScatterCorrection as EMSC,
)
from nirs4all.operators.transforms import (
    MultiplicativeScatterCorrection as MSC,
)
from nirs4all.operators.transforms import (
    SavitzkyGolay as SG,
)
from nirs4all.operators.transforms import (
    StandardNormalVariate as SNV,
)
from nirs4all.operators.transforms.nirs import Wavelet
from nirs4all.operators.transforms.orthogonalization import OSC


# # 1. Build the pipeline using normal nirs4all syntax
# pipeline = [
#     StandardNormalVariate(),
#     KFold(n_splits=5),
#     {"model": PLSRegression(n_components=10)},
# ]

# # 2. Wrap with preset metadata + canonical pipeline
# preset = {
#     "id": "pls_basic",
#     "name": "Basic PLS Pipeline",
#     "description": "Simple PLS regression with SNV preprocessing",
#     "task_type": "regression",
#     "pipeline": serialize_component(pipeline),
# }

# # 3. Write the YAML
# with open("../../api/presets/pls_basic.yaml", "w") as f:
#     yaml.safe_dump(preset, f, sort_keys=False, default_flow_style=False)





pipeline = [
    SPXYFold(n_splits=3, random_state=42),
    {
        "_cartesian_": [
            # {"_or_": [None, KubelkaMunk]},
            {"_or_": [None, SNV, MSC, EMSC(degree=1), EMSC(degree=2)]},
            {"_or_": [None, SG(window_length=11, polyorder=2, deriv=1), SG(15,2,1), SG(21,2,1), SG(31,2,1), SG(15,3,2), SG(21,3,2), SG(31,3,2), Gaussian(order=0, sigma=1), Gaussian(order=0, sigma=2),
            #         # WaveletDenoise('db4', level=3), WaveletDenoise('db4', level=5)
            ]},
            {"_or_": [None, ASLSBaseline, Detrend]},
            {"_or_": [None, OSC(1), OSC(2), OSC(3)]},

        ],
        "count": 150,
    },
    StandardScaler(with_mean=True, with_std=False),
    {
        "model": PLSRegression(scale=False),
        "name": "PLS",
        "finetune_params": {
            "n_trials": 25,
            "sampler": "binary",
            # "pruner": 'successive_halving',
            # "n_jobs": -1,
            "model_params": {
                "n_components": ('int', 1, 25),
            },
        },
    },

]



preset = {
    "id": "pls_spxy_cartesian_finetune",
    "name": "Advanced PLS Pipeline",
    "description": "PLS finetuning with SPXYFolding and Cartesian product of main preprocessings",
    "task_type": "regression",
    "pipeline": serialize_component(pipeline),
}

# 3. Write the YAML
with open("../../api/presets/pls_finetune_advanced.yaml", "w") as f:
    yaml.safe_dump(preset, f, sort_keys=False, default_flow_style=False)


