function registry = localImplementationRegistry()
%LOCALIMPLEMENTATIONREGISTRY Create the upstream DAG-ML local registry.

item = nirs4all.requireUpstream('dag_ml');
if ~strcmp(item.package, '+dagml')
    error('nirs4all:IncompatibleDagMl', ...
        'The declared DAG-ML MATLAB binding is incompatible.');
end

try
    registry = dagml.LocalImplementationRegistry();
catch cause
    error('nirs4all:MissingDagMl', ...
        ['The DAG-ML MATLAB/Octave binding is not available. Add its ' ...
        'bindings/matlab directory to the path. Cause: %s'], cause.message);
end

registryMethods = methods(registry);
requiredMethods = {'registerLoss', 'registerMetric', 'invokeTrainingLoss'};
missingMethods = requiredMethods(~ismember(requiredMethods, registryMethods));
if ~isempty(missingMethods)
    error('nirs4all:IncompatibleDagMl', ...
        ['The installed DAG-ML MATLAB/Octave registry does not expose %s; ' ...
        'upgrade DAG-ML.'], strjoin(missingMethods, ', '));
end
end
