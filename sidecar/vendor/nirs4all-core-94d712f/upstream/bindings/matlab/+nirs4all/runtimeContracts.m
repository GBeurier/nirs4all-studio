function contracts = runtimeContracts()
%RUNTIMECONTRACTS Return per-runtime execution and prediction contracts.

contracts = { ...
    contract('python', 'run_portable_pipeline', false, []), ...
    contract('r', 'nirs4all_run_portable_pipeline', false, []), ...
    contract('javascript_wasm', 'runPortablePipeline', true, 'predictPortablePipeline'), ...
    contract('rust', 'run_portable_pipeline_with_library', false, []), ...
    contract('matlab_octave', 'runPortablePipeline', false, []) ...
};
end

function item = contract(surface, pipelineEntrypoint, serializedModelPredict, predictEntrypoint)
item = struct();
item.surface = surface;
item.pipelineExecution = 'parity-validated';
item.pipelineEntrypoint = pipelineEntrypoint;
item.serializedModelPredict = serializedModelPredict;
item.predictEntrypoint = predictEntrypoint;
end
