//! UI preset documents, shared with the historical diagnostic backend.
use crate::{HttpRequest, HttpResponse};

const PRESETS: &str = include_str!("../../api/synthetic_datasets.json");

pub fn owns_path(path: &str) -> bool {
    path == "/api/datasets/synthetic-presets"
}

pub fn route(request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    if request.method != "GET" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "GET",
        ));
    }
    if request.query.is_some() {
        return Some(HttpResponse::json(
            400,
            r#"{"detail":"Synthetic presets do not accept query fields"}"#,
        ));
    }
    Some(HttpResponse::json(200, PRESETS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn six_historical_presets_have_closed_distinct_valid_documents() {
        let document: Value = serde_json::from_str(PRESETS).unwrap();
        let rows = document["presets"].as_array().unwrap();
        assert_eq!(rows.len(), 6);
        let mut ids = std::collections::BTreeSet::new();
        for row in rows {
            assert_eq!(row.as_object().unwrap().len(), 7);
            assert!(ids.insert(row["id"].as_str().unwrap()));
            assert!((50..=10000).contains(&row["n_samples"].as_u64().unwrap()));
        }
        assert_eq!(rows[0]["n_samples"], 250);
        assert_eq!(rows[3]["task_type"], "binary_classification");
    }
}
