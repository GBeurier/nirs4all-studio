//! Process-local executable implementation registry.
//!
//! DAG-ML owns descriptor validation and exact resolution while bindings own
//! the executable object stored as `T`. The registry is deliberately generic:
//! Rust can retain closures or trait objects, and bindings can retain native
//! callable handles without serializing executable code into DAG contracts.

use std::collections::BTreeMap;

use crate::criteria::{
    ImplementationDescriptor, ImplementationSemanticKind, LossReference, MetricReference,
    PortabilityClass,
};
use crate::error::{DagMlError, Result};

struct RegisteredImplementation<T> {
    descriptor: ImplementationDescriptor,
    implementation: T,
}

/// Generic process-local registry keyed by a validated implementation descriptor.
///
/// Resolution always requires the complete expected descriptor. A matching
/// opaque registry key alone is insufficient because replay must also match the
/// semantic, implementation and descriptor fingerprints.
pub struct LocalImplementationRegistry<T> {
    entries: BTreeMap<String, RegisteredImplementation<T>>,
}

impl<T> Default for LocalImplementationRegistry<T> {
    fn default() -> Self {
        Self {
            entries: BTreeMap::new(),
        }
    }
}

impl<T> LocalImplementationRegistry<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        descriptor: ImplementationDescriptor,
        implementation: T,
    ) -> Result<()> {
        let key = implementation_dispatch_key(&descriptor)?;
        if self.entries.contains_key(&key) {
            return registration_error(format!(
                "duplicate local implementation registry key `{key}`"
            ));
        }
        self.entries.insert(
            key,
            RegisteredImplementation {
                descriptor,
                implementation,
            },
        );
        Ok(())
    }

    pub fn register_loss(&mut self, loss: &LossReference, implementation: T) -> Result<()> {
        loss.validate()?;
        self.register(loss.implementation.clone(), implementation)
    }

    pub fn register_metric(&mut self, metric: &MetricReference, implementation: T) -> Result<()> {
        metric.validate()?;
        self.register(metric.implementation.clone(), implementation)
    }

    pub fn resolve(&self, descriptor: &ImplementationDescriptor) -> Result<&T> {
        let key = implementation_dispatch_key(descriptor)?;
        let registered = self.entries.get(&key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "local implementation registry has no implementation for `{key}`"
            ))
        })?;
        if registered.descriptor != *descriptor {
            return resolution_error(format!(
                "local implementation registered for `{key}` does not match the requested descriptor"
            ));
        }
        Ok(&registered.implementation)
    }

    pub fn resolve_loss(&self, loss: &LossReference) -> Result<&T> {
        loss.validate()?;
        if loss.implementation.semantic_kind != ImplementationSemanticKind::Loss {
            return resolution_error("local loss resolution received a non-loss descriptor");
        }
        self.resolve(&loss.implementation)
    }

    pub fn resolve_metric(&self, metric: &MetricReference) -> Result<&T> {
        metric.validate()?;
        if metric.implementation.semantic_kind != ImplementationSemanticKind::Metric {
            return resolution_error("local metric resolution received a non-metric descriptor");
        }
        self.resolve(&metric.implementation)
    }

    pub fn unregister(&mut self, descriptor: &ImplementationDescriptor) -> Result<T> {
        let key = implementation_dispatch_key(descriptor)?;
        let registered = self.entries.get(&key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "local implementation registry has no implementation for `{key}`"
            ))
        })?;
        if registered.descriptor != *descriptor {
            return resolution_error(format!(
                "local implementation registered for `{key}` does not match the requested descriptor"
            ));
        }
        Ok(self
            .entries
            .remove(&key)
            .expect("entry checked above")
            .implementation)
    }

    pub fn descriptors(&self) -> impl Iterator<Item = &ImplementationDescriptor> {
        self.entries.values().map(|entry| &entry.descriptor)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Return the canonical process-local dispatch key for an implementation.
///
/// Registered implementations use their opaque registry key. Built-ins have
/// no registry key and are addressed by their descriptor fingerprint.
pub fn implementation_dispatch_key(descriptor: &ImplementationDescriptor) -> Result<String> {
    descriptor.validate()?;
    match (&descriptor.registry_key, descriptor.portability) {
        (Some(key), _) => Ok(key.clone()),
        (None, PortabilityClass::PortableBuiltIn) => Ok(format!(
            "portable_builtin:{}",
            descriptor.descriptor_fingerprint
        )),
        (None, _) => {
            registration_error("non-built-in implementation descriptor has no local registry key")
        }
    }
}

fn registration_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::CampaignValidation(message.into()))
}

fn resolution_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.into()))
}

#[cfg(all(test, dag_ml_workspace_contract_fixtures))]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use serde_json::Value;

    use super::*;

    fn custom_loss() -> LossReference {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../examples/fixtures/criteria/criteria_contracts.v1.json"
        ))
        .unwrap();
        serde_json::from_value(fixture["valid"]["training_loss_role"]["loss"].clone()).unwrap()
    }

    #[test]
    fn rust_closure_is_resolved_and_executed_as_a_local_loss() {
        type LossFn = Box<dyn Fn(f64, f64) -> f64>;

        let loss = custom_loss();
        let mut registry = LocalImplementationRegistry::<LossFn>::new();
        registry
            .register_loss(
                &loss,
                Box::new(|target, prediction| (prediction - target).abs()),
            )
            .unwrap();

        let callback = registry.resolve_loss(&loss).unwrap();
        assert_eq!(callback(2.0, 5.5), 3.5);
        assert_eq!(registry.len(), 1);
        assert_eq!(registry.descriptors().next(), Some(&loss.implementation));
    }

    #[test]
    fn resolution_requires_the_exact_descriptor_not_only_the_registry_key() {
        let loss = custom_loss();
        let mut registry = LocalImplementationRegistry::new();
        registry.register_loss(&loss, "callable-a").unwrap();

        let mut incompatible = loss.clone();
        incompatible.implementation.implementation_version = "2.0.0".to_string();
        incompatible.implementation.descriptor_fingerprint =
            incompatible.implementation.compute_fingerprint().unwrap();
        let error = registry
            .resolve_loss(&incompatible)
            .unwrap_err()
            .to_string();
        assert!(error.contains("does not match the requested descriptor"));
    }

    #[test]
    fn duplicate_registry_keys_are_rejected_even_for_different_descriptors() {
        let loss = custom_loss();
        let mut second = loss.clone();
        second.implementation.implementation_version = "2.0.0".to_string();
        second.implementation.descriptor_fingerprint =
            second.implementation.compute_fingerprint().unwrap();

        let mut registry = LocalImplementationRegistry::new();
        registry.register_loss(&loss, "callable-a").unwrap();
        let error = registry
            .register_loss(&second, "callable-b")
            .unwrap_err()
            .to_string();
        assert!(error.contains("duplicate local implementation registry key"));
    }

    #[test]
    fn unregister_checks_identity_and_returns_the_local_object() {
        let loss = custom_loss();
        let mut registry = LocalImplementationRegistry::new();
        registry
            .register_loss(&loss, String::from("callable-a"))
            .unwrap();

        assert_eq!(
            registry.unregister(&loss.implementation).unwrap(),
            "callable-a"
        );
        assert!(registry.is_empty());
        assert!(registry.resolve_loss(&loss).is_err());
    }

    #[test]
    fn clear_releases_registry_owned_implementations() {
        struct DropProbe(Arc<AtomicUsize>);

        impl Drop for DropProbe {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }

        let loss = custom_loss();
        let drops = Arc::new(AtomicUsize::new(0));
        let mut registry = LocalImplementationRegistry::new();
        registry
            .register_loss(&loss, DropProbe(Arc::clone(&drops)))
            .unwrap();

        assert_eq!(drops.load(Ordering::SeqCst), 0);
        registry.clear();
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(registry.is_empty());
    }
}
