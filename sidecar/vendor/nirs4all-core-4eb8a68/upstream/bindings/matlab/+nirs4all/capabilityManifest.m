function manifest = capabilityManifest()
%CAPABILITYMANIFEST Return the V1 portable capability manifest.

manifest = struct();
manifest.schema = 'nirs4all-core.capabilities.v1';
manifest.aggregate = 'nirs4all-core';
manifest.runtimeSurfaces = nirs4all.runtimeSurfaces();
manifest.runtimeContracts = nirs4all.runtimeContracts();
manifest.artifactContracts = nirs4all.artifactContracts();
manifest.portableOperatorClasses = nirs4all.portableOperatorClasses();
manifest.controllers = nirs4all.controllerCapabilities();
end
