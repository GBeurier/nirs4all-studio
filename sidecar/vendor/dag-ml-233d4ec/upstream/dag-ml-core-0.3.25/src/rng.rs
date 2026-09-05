use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SeedContext {
    pub root_seed: u64,
    pub path: Vec<String>,
}

impl SeedContext {
    pub fn root(root_seed: u64) -> Self {
        Self {
            root_seed,
            path: Vec::new(),
        }
    }

    pub fn child(&self, label: impl Into<String>) -> Self {
        let mut next = self.clone();
        next.path.push(label.into());
        next
    }

    pub fn derive_u64(&self, label: impl AsRef<str>) -> u64 {
        let mut hasher = Sha256::new();
        hasher.update(self.root_seed.to_le_bytes());
        for part in &self.path {
            hasher.update([0]);
            hasher.update(part.as_bytes());
        }
        hasher.update([0xff]);
        hasher.update(label.as_ref().as_bytes());

        let digest = hasher.finalize();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&digest[..8]);
        u64::from_le_bytes(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_stable_streams() {
        let a = SeedContext::root(7).child("node:model").child("fold:1");
        let b = SeedContext::root(7).child("node:model").child("fold:1");

        assert_eq!(a.derive_u64("split"), b.derive_u64("split"));
        assert_ne!(a.derive_u64("split"), a.derive_u64("bootstrap"));
    }
}
