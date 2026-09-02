use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::fold::FoldSet;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CampaignFingerprintSpec {
    pub graph_id: String,
    pub root_seed: u64,
    pub splitter: serde_json::Value,
    pub fold_set: FoldSet,
}

pub fn campaign_fingerprint(spec: &CampaignFingerprintSpec) -> Result<String> {
    spec.fold_set.validate()?;
    stable_json_fingerprint(spec)
}

pub(crate) fn stable_json_fingerprint<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    let json = serde_json::to_vec(value)?;
    let digest = Sha256::digest(json);
    Ok(to_hex(&digest))
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(&mut out, "{byte:02x}").expect("writing to string cannot fail");
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::fold::KFoldSpec;
    use crate::ids::SampleId;

    use super::*;

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    #[test]
    fn campaign_fingerprint_is_stable_and_sensitive() {
        let samples = ["s1", "s2", "s3", "s4"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let fold_set = KFoldSpec {
            n_splits: 2,
            shuffle: true,
            seed: Some(9),
        }
        .split("outer", &samples)
        .unwrap();
        let mut spec = CampaignFingerprintSpec {
            graph_id: "g".to_string(),
            root_seed: 9,
            splitter: json!({"kind": "kfold", "n_splits": 2}),
            fold_set,
        };

        let left = campaign_fingerprint(&spec).unwrap();
        let right = campaign_fingerprint(&spec).unwrap();
        assert_eq!(left, right);

        spec.root_seed = 10;
        assert_ne!(left, campaign_fingerprint(&spec).unwrap());
    }
}
