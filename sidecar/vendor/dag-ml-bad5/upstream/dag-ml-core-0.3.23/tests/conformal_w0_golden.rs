use dag_ml_core::{
    apply_split_absolute_residual, finite_sample_conformal_rank, regression_conformal_metrics,
    split_absolute_residual_quantiles, ConformalError, ConformalMeasurementStatus,
    ConformalMultiTargetPolicy, ConformalRadius, ConformalSmallSamplePolicy,
    RegressionConformalInterval, RegressionIntervalCell, SplitConformalQuantile,
};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/conformal_w0_golden.json"))
        .expect("frozen conformal golden must be valid JSON")
}

fn policy(value: &Value) -> ConformalMultiTargetPolicy {
    match value
        .as_str()
        .expect("multi_target_policy must be a string")
    {
        "marginal" => ConformalMultiTargetPolicy::Marginal,
        "joint_max" => ConformalMultiTargetPolicy::JointMax,
        other => panic!("unexpected golden target policy {other}"),
    }
}

fn small_sample_policy(value: &Value) -> ConformalSmallSamplePolicy {
    match value
        .as_str()
        .expect("small_sample_policy must be a string")
    {
        "error" => ConformalSmallSamplePolicy::Error,
        "unbounded" => ConformalSmallSamplePolicy::Unbounded,
        other => panic!("unexpected golden small-sample policy {other}"),
    }
}

fn matrix(value: &Value) -> Vec<Vec<f64>> {
    value
        .as_array()
        .expect("matrix must be an array")
        .iter()
        .map(|row| {
            row.as_array()
                .expect("matrix row must be an array")
                .iter()
                .map(|cell| cell.as_f64().expect("matrix cell must be binary64"))
                .collect()
        })
        .collect()
}

fn radii(value: &Value) -> Vec<ConformalRadius> {
    value
        .as_array()
        .expect("radii must be an array")
        .iter()
        .map(|radius| {
            radius
                .as_f64()
                .map_or(ConformalRadius::Unbounded, ConformalRadius::Finite)
        })
        .collect()
}

fn quantiles(value: &Value) -> Vec<SplitConformalQuantile> {
    value
        .as_array()
        .expect("quantiles must be an array")
        .iter()
        .map(|record| SplitConformalQuantile {
            coverage: record["coverage"]
                .as_f64()
                .expect("quantile coverage must be binary64"),
            rank: record["rank"].as_u64().expect("quantile rank must be u64"),
            radii: radii(&record["radii"]),
        })
        .collect()
}

fn interval_cells(value: &Value) -> Vec<Vec<RegressionIntervalCell>> {
    value
        .as_array()
        .expect("interval cells must contain rows")
        .iter()
        .map(|row| {
            row.as_array()
                .expect("interval row must be an array")
                .iter()
                .map(|cell| {
                    if cell.is_null() {
                        RegressionIntervalCell::Unbounded
                    } else {
                        let endpoints = cell.as_array().expect("finite cell must be [lo, hi]");
                        assert_eq!(endpoints.len(), 2);
                        RegressionIntervalCell::Finite {
                            lower: endpoints[0].as_f64().expect("lower must be binary64"),
                            upper: endpoints[1].as_f64().expect("upper must be binary64"),
                        }
                    }
                })
                .collect()
        })
        .collect()
}

fn interval_cells_from_hex_bits(value: &Value) -> Vec<Vec<RegressionIntervalCell>> {
    value
        .as_array()
        .expect("interval bit cells must contain rows")
        .iter()
        .map(|row| {
            row.as_array()
                .expect("interval bit row must be an array")
                .iter()
                .map(|cell| {
                    if cell.is_null() {
                        RegressionIntervalCell::Unbounded
                    } else {
                        let endpoints = cell
                            .as_array()
                            .expect("finite bit cell must be [lower_bits, upper_bits]");
                        assert_eq!(endpoints.len(), 2);
                        RegressionIntervalCell::Finite {
                            lower: f64_from_hex_bits(&endpoints[0]),
                            upper: f64_from_hex_bits(&endpoints[1]),
                        }
                    }
                })
                .collect()
        })
        .collect()
}

fn optional_f64(value: &Value) -> Option<f64> {
    (!value.is_null()).then(|| value.as_f64().expect("metric must be binary64"))
}

fn f64_from_hex_bits(value: &Value) -> f64 {
    let encoded = value.as_str().expect("binary64 bits must be hexadecimal");
    assert_eq!(encoded.len(), 16, "binary64 bits must contain 16 digits");
    assert!(
        encoded
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "binary64 bits must use lowercase hexadecimal"
    );
    let bits = u64::from_str_radix(encoded, 16).expect("binary64 bits must fit u64");
    f64::from_bits(bits)
}

fn assert_radii_bits(actual: &[ConformalRadius], expected: &[ConformalRadius]) {
    assert_eq!(actual.len(), expected.len());
    for (actual, expected) in actual.iter().zip(expected) {
        match (actual, expected) {
            (ConformalRadius::Finite(actual), ConformalRadius::Finite(expected)) => {
                assert_eq!(actual.to_bits(), expected.to_bits());
            }
            (ConformalRadius::Unbounded, ConformalRadius::Unbounded) => {}
            _ => panic!("finite and unbounded golden radius statuses differ"),
        }
    }
}

fn assert_interval_cells_bits(
    actual: &[Vec<RegressionIntervalCell>],
    expected: &[Vec<RegressionIntervalCell>],
) {
    assert_eq!(actual.len(), expected.len());
    for (actual_row, expected_row) in actual.iter().zip(expected) {
        assert_eq!(actual_row.len(), expected_row.len());
        for (actual, expected) in actual_row.iter().zip(expected_row) {
            match (actual, expected) {
                (
                    RegressionIntervalCell::Finite {
                        lower: actual_lower,
                        upper: actual_upper,
                    },
                    RegressionIntervalCell::Finite {
                        lower: expected_lower,
                        upper: expected_upper,
                    },
                ) => {
                    assert_eq!(actual_lower.to_bits(), expected_lower.to_bits());
                    assert_eq!(actual_upper.to_bits(), expected_upper.to_bits());
                }
                (RegressionIntervalCell::Unbounded, RegressionIntervalCell::Unbounded) => {}
                _ => panic!("finite and unbounded golden interval statuses differ"),
            }
        }
    }
}

fn assert_optional_f64_bits(actual: Option<f64>, expected: Option<f64>) {
    match (actual, expected) {
        (Some(actual), Some(expected)) => assert_eq!(actual.to_bits(), expected.to_bits()),
        (None, None) => {}
        _ => panic!("available and unavailable golden measurements differ"),
    }
}

#[test]
fn exact_rank_matches_independent_python_decimal_golden() {
    let fixture = fixture();
    assert_eq!(fixture["schema_version"], 1);
    assert_eq!(fixture["fixture_id"], "dag-ml-core.conformal-w0-golden.v1");
    for case in fixture["rank_cases"]
        .as_array()
        .expect("rank_cases must be an array")
    {
        let sample_count = case["sample_count"]
            .as_u64()
            .expect("sample_count must be u64");
        let coverage = f64_from_hex_bits(&case["coverage_bits"]);
        let expected = case["expected_rank"]
            .as_u64()
            .expect("expected_rank must be u64");
        assert_eq!(
            finite_sample_conformal_rank(sample_count, coverage).unwrap(),
            expected,
            "rank case {}",
            case["id"]
        );
        if let Some(naive_rank) = case.get("naive_rank") {
            let naive = (((sample_count + 1) as f64) * coverage).ceil() as u64;
            assert_eq!(naive, naive_rank.as_u64().unwrap());
            assert_ne!(naive, expected);
        }
    }
}

#[test]
fn calibration_matches_independent_w0_golden() {
    let fixture = fixture();
    for case in fixture["calibration_cases"]
        .as_array()
        .expect("calibration_cases must be an array")
    {
        let residuals = matrix(&case["residuals"]);
        let coverages = case["coverages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_f64().unwrap())
            .collect::<Vec<_>>();
        let actual = split_absolute_residual_quantiles(
            &residuals,
            &coverages,
            policy(&case["multi_target_policy"]),
            small_sample_policy(&case["small_sample_policy"]),
        )
        .unwrap();
        let expected = case["expected"].as_array().unwrap();
        assert_eq!(actual.len(), expected.len(), "case {}", case["id"]);
        for ((actual, expected), coverage) in actual.iter().zip(expected).zip(&coverages) {
            assert_eq!(actual.coverage.to_bits(), coverage.to_bits());
            assert_eq!(actual.rank, expected["rank"].as_u64().unwrap());
            assert_radii_bits(&actual.radii, &radii(&expected["radii"]));
        }
    }
}

#[test]
fn interval_application_matches_independent_w0_golden() {
    let fixture = fixture();
    for case in fixture["application_cases"]
        .as_array()
        .expect("application_cases must be an array")
    {
        let quantile_records = quantiles(&case["quantiles"]);
        let actual = apply_split_absolute_residual(
            &matrix(&case["points"]),
            &quantile_records,
            policy(&case["multi_target_policy"]),
        )
        .unwrap();
        let expected = case["expected_cells"].as_array().unwrap();
        let expected_bits = case.get("expected_cell_bits").map(|value| {
            value
                .as_array()
                .expect("expected_cell_bits must be an array")
        });
        assert_eq!(actual.len(), expected.len(), "case {}", case["id"]);
        if let Some(expected_bits) = expected_bits {
            assert_eq!(actual.len(), expected_bits.len(), "case {}", case["id"]);
        }
        for (coverage_index, ((actual, expected), quantile)) in actual
            .iter()
            .zip(expected)
            .zip(&quantile_records)
            .enumerate()
        {
            assert_eq!(actual.coverage.to_bits(), quantile.coverage.to_bits());
            assert_interval_cells_bits(&actual.cells, &interval_cells(expected));
            if let Some(expected_bits) = expected_bits {
                assert_interval_cells_bits(
                    &actual.cells,
                    &interval_cells_from_hex_bits(&expected_bits[coverage_index]),
                );
            }
        }
    }
}

#[test]
fn interval_application_rejects_independent_unrepresentable_golden() {
    let fixture = fixture();
    for case in fixture["application_error_cases"]
        .as_array()
        .expect("application_error_cases must be an array")
    {
        let quantile = SplitConformalQuantile {
            coverage: f64_from_hex_bits(&case["coverage_bits"]),
            rank: 1,
            radii: vec![ConformalRadius::Finite(f64_from_hex_bits(
                &case["radius_bits"],
            ))],
        };
        let error = apply_split_absolute_residual(
            &[vec![f64_from_hex_bits(&case["point_bits"])]],
            &[quantile],
            policy(&case["multi_target_policy"]),
        )
        .unwrap_err();
        assert_eq!(
            error,
            ConformalError::UnrepresentableInterval {
                coverage_index: case["expected_coverage_index"].as_u64().unwrap() as usize,
                row: case["expected_row"].as_u64().unwrap() as usize,
                target: case["expected_target"].as_u64().unwrap() as usize,
            },
            "case {}",
            case["id"]
        );
    }
}

#[test]
fn metrics_match_independent_w0_golden_bit_for_bit() {
    let fixture = fixture();
    for case in fixture["metric_cases"]
        .as_array()
        .expect("metric_cases must be an array")
    {
        let interval = RegressionConformalInterval {
            coverage: case["coverage"].as_f64().unwrap(),
            cells: interval_cells(&case["cells"]),
        };
        let actual = regression_conformal_metrics(
            &matrix(&case["truth"]),
            &interval,
            policy(&case["multi_target_policy"]),
        )
        .unwrap();
        let expected = case["expected"].as_array().unwrap();
        assert_eq!(actual.len(), expected.len(), "case {}", case["id"]);
        for (actual, expected) in actual.iter().zip(expected) {
            assert_eq!(
                actual.target_index,
                expected["target_index"].as_u64().map(|v| v as usize)
            );
            assert_eq!(
                actual.measurement_status,
                match expected["measurement_status"].as_str().unwrap() {
                    "finite" => ConformalMeasurementStatus::Finite,
                    "unbounded" => ConformalMeasurementStatus::Unbounded,
                    other => panic!("unexpected measurement status {other}"),
                }
            );
            assert_eq!(
                actual.empirical_coverage.to_bits(),
                expected["empirical_coverage"].as_f64().unwrap().to_bits()
            );
            assert_eq!(
                actual.coverage_gap.to_bits(),
                f64_from_hex_bits(&expected["coverage_gap_bits"]).to_bits()
            );
            assert_optional_f64_bits(actual.mean_width, optional_f64(&expected["mean_width"]));
            assert_optional_f64_bits(actual.median_width, optional_f64(&expected["median_width"]));
            assert_optional_f64_bits(
                actual.interval_score,
                optional_f64(&expected["interval_score"]),
            );
        }
    }
}
