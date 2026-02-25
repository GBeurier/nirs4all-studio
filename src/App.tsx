import { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { NirsSplashLoader } from "@/components/layout/NirsSplashLoader";
import { useMlReadiness } from "@/context/MlReadinessContext";
import Datasets from "@/pages/Datasets";
import DatasetDetail from "@/pages/DatasetDetail";
import Pipelines from "@/pages/Pipelines";
import PipelineEditor from "@/pages/PipelineEditor";
import NewExperiment from "@/pages/NewExperiment";
import Playground from "@/pages/Playground";
import Inspector from "@/pages/Inspector";
import Runs from "@/pages/Runs";
import RunProgress from "@/pages/RunProgress";
import Results from "@/pages/Results";
import AggregatedResults from "@/pages/AggregatedResults";
import Predictions from "@/pages/Predictions";
import Lab from "@/pages/Lab";
import SpectraSynthesis from "@/pages/SpectraSynthesis";
import TransferAnalysis from "@/pages/TransferAnalysis";
import VariableImportance from "@/pages/VariableImportance";
import Settings from "@/pages/Settings";
import SetupWizard from "@/pages/SetupWizard";
import NotFound from "@/pages/NotFound";
import EnvSetup from "@/components/setup/EnvSetup";

const electronApi = (window as unknown as {
  electronApi?: {
    isElectron: boolean;
    isEnvReady: () => Promise<boolean>;
  };
}).electronApi;

const backendMessages = [
  "Training models on imaginary data...",
  "Convincing electrons to cooperate...",
  "Negotiating with Python runtime...",
  "Polishing spectral baselines...",
  "Persuading NumPy to be reasonable...",
  "Herding stochastic gradients...",
  "Recalibrating the flux capacitor...",
  "Teaching PLS about new spectra...",
  "Optimizing hyperparameters telepathically...",
  "Waiting for photons to arrive...",
  "Consulting the chemometric oracle...",
  "Reducing dimensions enthusiastically...",
  "Applying Savitzky-Golay with care...",
  "Searching for the global minimum...",
  "Unfolding multivariate mysteries...",
  "Computing spectral fingerprints...",
  "Waking up the backend hamsters...",
  "Factorizing covariance matrices...",
  "Reticulating spectral splines...",
  "Parsing the meaning of absorbance...",
  "Aligning wavelengths with destiny...",
  "Calibrating instruments by moonlight...",
  "Whispering sweet nothings to tensors...",
  "Stabilizing volatile eigenvalues...",
  "Tuning kernels to perfect harmony...",
  "Massaging latent spaces gently...",
  "Entangling features responsibly...",
  "Appeasing the loss function...",
  "Summoning extra GPU spirits...",
  "Debiasing cosmic noise...",
  "Smoothing spectra with ancient wisdom...",
  "Convincing matrices to behave...",
  "Synchronizing phase and vibes...",
  "Chasing runaway outliers...",
  "Normalizing the fabric of reality...",
  "Tickling the covariance monster...",
  "Learning harmonics of cellulose...",
  "Freezing layers below 900 nm...",
  "Unfreezing lignin representations...",
  "Tokenizing chemical bonds...",
  "Masking noisy wavelengths...",
  "Distilling chemometric wisdom...",
  "Projecting spectra into hyperspace...",
  "Regularizing baseline drift...",
  "Quantizing molecular vibes...",
  "Stacking residual spectrometers...",
  "Pooling over noisy pixels...",
  "Autoencoding imaginary flour samples...",
  "Optimizing latent sucrose channels...",
  "Dropout on water absorption peaks...",
  "Aligning convolutional kernels with chemistry...",
  "Scheduling learning rates by wavelength...",
  "Checkpointing photons...",
  "Sharding spectral tensors...",
  "Propagating gradients through Beer-Lambert...",
  "Teaching transformers about starch...",
  "Pruning overconfident wavelengths...",
  "Calibrating softmax on cellulose...",
  "Waiting for CUDA and the spectrometer...",
  "Backpropagating through questionable life choices...",
  "Initializing weights with cautious optimism...",
  "Clipping runaway gradients...",
  "Batch-normalizing emotional instability...",
  "Dropping neurons for character development...",
  "Aligning attention heads...",
  "Fine-tuning latent personalities...",
  "Freezing layers in self-defense...",
  "Unfreezing layers dramatically...",
  "Shuffling tensors into place...",
  "Accumulating gradients patiently...",
  "Scheduling learning rates poetically...",
  "Masking tokens with intent...",
  "Tokenizing philosophical questions...",
  "Embedding abstract thoughts...",
  "Stacking residual connections...",
  "Balancing exploding and vanishing hopes...",
  "Quantizing questionable decisions...",
  "Compiling computational graphs...",
  "Tracing autograd paths...",
  "Packing sequences tightly...",
  "Padding realities to equal length...",
  "Optimizing billions of tiny numbers...",
  "Calibrating softmax temperatures...",
  "Distilling teacherly wisdom...",
  "Pruning overconfident neurons...",
  "Checkpointing fragile progress...",
  "Synchronizing distributed gradients...",
  "Sharding the universe...",
  "Calibrating photon detectors...",
  "Aligning spectral wavelengths...",
  "Warming up the spectrometer...",
  "Counting near-infrared photons...",
  "Initializing chemometric engines...",
  "Loading spectral databases...",
  "Tuning neural pathways...",
  "Synchronizing wavelength arrays...",
  "Preparing molecular vibrations...",
  "Charging the laser diodes...",
  "Unpacking spectral libraries...",
  "Bootstrapping prediction cores...",
  "Defragmenting absorbance matrices...",
  "Waking up the PLS algorithm...",
  "Compiling scatter correction routines...",
  "Indexing overtone harmonics...",
  "Buffering diffuse reflectance...",
  "Establishing Beer-Lambert equilibrium...",
  "Teaching vectors some manners...",
  "Reweighing invisible evidence...",
  "Interpolating between universes...",
  "Casting spells on residuals...",
  "Untangling correlated destinies...",
  "Refining probabilistic intuition...",
  "Rescuing lost gradients...",
  "Bending manifolds politely...",
  "Harmonizing signal and noise...",
  "Consulting the Fourier elders...",
  "Breeding well-behaved features...",
  "Aligning latent chakras...",
  "Convincing randomness to settle down...",
  "Extracting meaning from chaos...",
  "Diagonalizing stubborn matrices...",
  "Projecting onto questionable subspaces...",
  "Cholesky-decomposing my feelings...",
  "Orthogonalizing rebellious vectors...",
  "Maximizing likelihood with crossed fingers...",
  "Minimizing convex regret...",
  "Integrating over forgotten priors...",
  "Sampling from dubious posteriors...",
  "Backpropagating through absorbance space...",
  "Embedding wavelengths into latent dreams...",
  "Convolving near-infrared whispers...",
  "Attention-aligning spectral bands...",
  "Fine-tuning photons end-to-end...",
  "Batch-normalizing reflectance regrets...",
  "Clipping gradients at 1100 nm...",
  "Mapping hydrogen bond networks...",
  "Spinning up cross-validation folds...",
  "Routing spectra through a questionable DAG...",
  "Hashing preprocessing chains for reproducibility...",
  "Caching reflectance tensors aggressively...",
  "Parallelizing Savitzky-Golay across wavelengths...",
  "Serializing chemometric destinies to Parquet...",
  "Validating folds against spectral leakage...",
  "Propagating indices through augmentation branches...",
  "Vectorizing Beer-Lambert assumptions...",
  "Resolving pipeline dependencies at 2150 nm...",
  "Compiling preprocessing graphs just in time...",
  "Dispatching spectra to GPU workers...",
  "Balancing CPU threads and photon counts...",
  "Checkpointing multiblock PLS states...",
  "Stacking operators in suspicious order...",
  "Reconciling metadata with latent space...",
  "Normalizing baselines before orchestration...",
  "Merging spectral shards from distant nodes...",
  "Tracking provenance of rogue wavelengths...",
  "Scheduling hyperparameters across clusters...",
  "Streaming absorbance batches through Redis...",
  "Debouncing noisy sensors in the pipeline...",
  "Versioning stochastic preprocessing steps...",
  "Mapping covariance across compute nodes...",
  "Reducing dimensionality without breaking CI...",
  "Injecting synthetic spectra into production...",
  "Profiling bottlenecks at 1400 nm...",
  "Guarding against data drift in reflectance space...",
  "Replaying experiment manifests deterministically...",
  "Synchronizing fold splits with metadata partitions...",
  "Awaiting convergence across distributed photons...",
];


function BackendConnectingScreen() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const idxRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function pickNext() {
      let idx;
      do { idx = Math.floor(Math.random() * backendMessages.length); } while (idx === idxRef.current);
      idxRef.current = idx;
      return backendMessages[idx];
    }
    function cycle() {
      setText(pickNext());
      setVisible(true);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        timerRef.current = setTimeout(cycle, 450);
      }, 3500);
    }
    const startDelay = setTimeout(cycle, 800);
    return () => { clearTimeout(startDelay); clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen" style={{ background: "#ffffff" }}>
      <style>{`
        .splash-char {
          opacity: 0;
          display: inline-block;
          animation: splashCharReveal 0.25s ease forwards;
        }
        @keyframes splashCharReveal {
          0% { opacity: 0; text-shadow: 0 0 8px rgb(37, 119, 187); }
          40% { opacity: 1; text-shadow: 0 0 4px rgb(37, 119, 187); }
          60% { opacity: 0.4; }
          80% { opacity: 0.85; text-shadow: none; }
          100% { opacity: 0.65; }
        }
      `}</style>
      <img src={`${import.meta.env.BASE_URL}nirs4all_logo.png`} alt="nirs4all" draggable={false} className="w-[200px] h-auto mb-1.5 select-none pointer-events-none" />
      <h1 className="text-[28px] font-semibold -tracking-wide mb-1" style={{ color: "#18181b" }}>Studio</h1>
      <p className="text-[13px] uppercase tracking-[2px] mb-5" style={{ color: "#a1a1aa" }}>
        Build {"\u00B7"} Explore {"\u00B7"} Predict
      </p>
      <NirsSplashLoader className="w-[340px] h-[90px]" />
      <p
        className={`mt-4 font-mono text-[11px] min-h-[16px] transition-opacity duration-[400ms] ${visible ? "opacity-100" : "opacity-0"}`}
        style={{ color: "#94a3b8" }}
      >
        {text.split("").map((char, i) => (
          <span key={`${idxRef.current}-${i}`} className="splash-char" style={{ animationDelay: `${i * 25}ms` }}>
            {char === " " ? "\u00A0" : char}
          </span>
        ))}
      </p>
    </div>
  );
}

function App() {
  // In Electron mode, check if the Python environment is ready.
  // If not, show the env setup screen before loading the app.
  const [envReady, setEnvReady] = useState<boolean | null>(null);
  const { coreReady } = useMlReadiness();
  const isElectron = !!electronApi?.isElectron;

  useEffect(() => {
    if (!isElectron || !electronApi) {
      // Web mode: no env check needed, backend managed externally
      setEnvReady(true);
      return;
    }
    electronApi.isEnvReady().then(setEnvReady);
  }, [isElectron]);

  // Loading state while checking env
  if (envReady === null) {
    return <BackendConnectingScreen />;
  }

  // Env not ready in Electron mode: show setup screen (no backend available yet)
  if (!envReady) {
    return <EnvSetup onComplete={() => setEnvReady(true)} />;
  }

  // Backend not yet reachable — show connecting screen
  // (only in Electron; in web mode, Vite proxy handles backend connectivity)
  if (isElectron && !coreReady) {
    return <BackendConnectingScreen />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/datasets" replace />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="pipelines" element={<Pipelines />} />
        <Route path="pipelines/:id" element={<PipelineEditor />} />
        <Route path="pipelines/new" element={<PipelineEditor />} />
        <Route path="editor" element={<NewExperiment />} />
        <Route path="playground" element={<Playground />} />
        <Route path="inspector" element={<Inspector />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<RunProgress />} />
        <Route path="results" element={<Results />} />
        <Route path="results/aggregated" element={<AggregatedResults />} />
        <Route path="predictions" element={<Predictions />} />
        <Route path="lab" element={<Lab />}>
          <Route index element={<Navigate to="/lab/synthesis" replace />} />
          <Route path="synthesis" element={<SpectraSynthesis />} />
          <Route path="transfer" element={<TransferAnalysis />} />
          <Route path="shapley" element={<VariableImportance />} />
        </Route>
        <Route path="settings" element={<Settings />} />
        <Route path="setup" element={<SetupWizard />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
