// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! C-ABI mechanics: status codes, context error buffer, string ownership, and
//! the three JSON-surface functions. Parity of the *content* is proven by the
//! facade contract goldens; this test proves the ABI plumbing around them.

use std::ffi::{c_char, CStr, CString};
use std::path::PathBuf;

use nirs4all_io_capi::*;

fn corpus_case(case: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract/corpus")
        .join(case)
        .to_string_lossy()
        .into_owned()
}

/// Call a `(ctx, input, conventions, out)` JSON function and take the owned
/// result string (freeing the C allocation).
unsafe fn call2(
    f: unsafe extern "C" fn(
        *mut n4io_context_t,
        *const c_char,
        *const c_char,
        *mut *mut c_char,
    ) -> n4io_status_t,
    ctx: *mut n4io_context_t,
    input: &str,
) -> (n4io_status_t, Option<String>) {
    let c_input = CString::new(input).unwrap();
    let mut out: *mut c_char = std::ptr::null_mut();
    let status = f(ctx, c_input.as_ptr(), std::ptr::null(), &mut out);
    let result = if out.is_null() {
        None
    } else {
        let s = CStr::from_ptr(out).to_str().unwrap().to_owned();
        n4io_string_free(out);
        Some(s)
    };
    (status, result)
}

unsafe fn last_error(ctx: *const n4io_context_t) -> String {
    CStr::from_ptr(n4io_context_last_error(ctx))
        .to_str()
        .unwrap()
        .to_owned()
}

#[test]
fn abi_version_round_trips() {
    unsafe {
        let p = n4io_abi_version();
        assert!(!p.is_null());
        assert_eq!(CStr::from_ptr(p).to_str().unwrap(), "0.2.0");
        n4io_string_free(p);
    }
}

#[test]
fn abi_compatibility_matrix() {
    assert_eq!(n4io_check_abi_compatibility(0, 0), n4io_status_t::N4IO_OK);
    assert_eq!(n4io_check_abi_compatibility(0, 1), n4io_status_t::N4IO_OK);
    assert_eq!(n4io_check_abi_compatibility(0, 2), n4io_status_t::N4IO_OK);
    // header wants a newer minor than the library exposes
    assert_eq!(
        n4io_check_abi_compatibility(0, 3),
        n4io_status_t::N4IO_ERR_VERSION_INCOMPATIBLE
    );
    // major mismatch
    assert_eq!(
        n4io_check_abi_compatibility(1, 0),
        n4io_status_t::N4IO_ERR_ABI_MISMATCH
    );
}

#[test]
fn string_free_tolerates_null() {
    unsafe { n4io_string_free(std::ptr::null_mut()) };
}

#[test]
fn context_lifecycle_and_null_last_error() {
    unsafe {
        // null ctx → empty (never null) error string
        assert_eq!(last_error(std::ptr::null()), "");
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        assert_eq!(n4io_context_create(&mut ctx), n4io_status_t::N4IO_OK);
        assert!(!ctx.is_null());
        assert_eq!(last_error(ctx), ""); // fresh context: no error
        n4io_context_destroy(ctx);
        n4io_context_destroy(std::ptr::null_mut()); // no-op on null
    }
}

#[test]
fn to_spec_then_validate_round_trip() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);

        // path input (JSON string) → canonical DatasetSpec (train_test matches the convention)
        let path_json = serde_json::to_string(&corpus_case("train_test")).unwrap();
        let (st, spec) = call2(n4io_to_spec, ctx, &path_json);
        assert_eq!(st, n4io_status_t::N4IO_OK, "err: {}", last_error(ctx));
        let spec = spec.expect("spec output");
        assert!(spec.contains("\"schema_version\""));
        assert!(spec.ends_with('\n'), "canonical JSON ends with newline");

        // the produced spec must itself validate OK
        let c_spec = CString::new(spec).unwrap();
        assert_eq!(n4io_validate(ctx, c_spec.as_ptr()), n4io_status_t::N4IO_OK);

        n4io_context_destroy(ctx);
    }
}

#[test]
fn infer_path_returns_plan() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let path_json = serde_json::to_string(&corpus_case("train_test")).unwrap();
        let (st, plan) = call2(n4io_infer, ctx, &path_json);
        assert_eq!(st, n4io_status_t::N4IO_OK, "err: {}", last_error(ctx));
        let plan = plan.expect("plan output");
        assert!(plan.contains("\"resolved_spec\""));
        n4io_context_destroy(ctx);
    }
}

#[test]
fn load_summary_returns_assembled_summary() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let path_json = serde_json::to_string(&corpus_case("x_y_separate")).unwrap();
        let (st, summary) = call2(n4io_load_summary, ctx, &path_json);
        assert_eq!(st, n4io_status_t::N4IO_OK, "err: {}", last_error(ctx));
        let summary = summary.expect("summary output");
        assert!(summary.contains("\"blocks\""));
        assert!(summary.ends_with('\n'), "canonical JSON ends with newline");
        n4io_context_destroy(ctx);
    }
}

#[test]
fn invalid_spec_sets_error() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        // "random" is not a valid partition mode → SpecError on coerce
        let bad = CString::new(r#"{"partitions": {"by": "random"}}"#).unwrap();
        assert_eq!(
            n4io_validate(ctx, bad.as_ptr()),
            n4io_status_t::N4IO_ERR_SPEC
        );
        assert!(!last_error(ctx).is_empty(), "error buffer populated");
        n4io_context_destroy(ctx);
    }
}

#[test]
fn infer_rejects_spec_input() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let (st, out) = call2(n4io_infer, ctx, r#"{"X": "data.csv"}"#);
        assert_eq!(st, n4io_status_t::N4IO_ERR_INVALID_ARGUMENT);
        assert!(out.is_none());
        assert!(last_error(ctx).contains("data input"));
        n4io_context_destroy(ctx);
    }
}

#[test]
fn null_and_malformed_arguments_are_rejected() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);

        // null input_json
        let mut out: *mut c_char = std::ptr::null_mut();
        assert_eq!(
            n4io_to_spec(ctx, std::ptr::null(), std::ptr::null(), &mut out),
            n4io_status_t::N4IO_ERR_INVALID_ARGUMENT
        );
        assert!(out.is_null());

        // null out pointer
        assert_eq!(
            n4io_to_spec(
                ctx,
                c"\"x\"".as_ptr(),
                std::ptr::null(),
                std::ptr::null_mut()
            ),
            n4io_status_t::N4IO_ERR_INVALID_ARGUMENT
        );

        // malformed JSON input
        let (st, _) = call2(n4io_to_spec, ctx, "{not json");
        assert_eq!(st, n4io_status_t::N4IO_ERR_INVALID_ARGUMENT);
        assert!(last_error(ctx).contains("input JSON"));

        n4io_context_destroy(ctx);
    }
}

#[test]
fn file_list_rejects_non_string_entries() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let (st, out) = call2(n4io_to_spec, ctx, r#"["X.csv", 42]"#);
        assert_eq!(st, n4io_status_t::N4IO_ERR_INVALID_ARGUMENT);
        assert!(out.is_none());
        assert!(last_error(ctx).contains("input file list"));
        n4io_context_destroy(ctx);
    }
}

#[test]
fn non_utf8_conventions_are_rejected() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let input = CString::new("\"x\"").unwrap();
        // a non-null but non-UTF-8 conventions buffer must NOT be treated as omitted
        let bad_conv = CString::new(vec![0xff_u8, 0xfe_u8]).unwrap();
        let mut out: *mut c_char = std::ptr::null_mut();
        let st = n4io_to_spec(ctx, input.as_ptr(), bad_conv.as_ptr(), &mut out);
        assert_eq!(st, n4io_status_t::N4IO_ERR_INVALID_ARGUMENT);
        assert!(out.is_null());
        assert!(last_error(ctx).contains("not UTF-8"));
        n4io_context_destroy(ctx);
    }
}

#[test]
fn null_out_pointer_populates_error() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        let input = CString::new("\"x\"").unwrap();
        let st = n4io_to_spec(ctx, input.as_ptr(), std::ptr::null(), std::ptr::null_mut());
        assert_eq!(st, n4io_status_t::N4IO_ERR_INVALID_ARGUMENT);
        assert!(last_error(ctx).contains("out pointer is null"));
        n4io_context_destroy(ctx);
    }
}

#[test]
fn success_clears_stale_error() {
    unsafe {
        let mut ctx: *mut n4io_context_t = std::ptr::null_mut();
        n4io_context_create(&mut ctx);
        // first a failure populates the buffer
        let bad = CString::new(r#"{"partitions": {"by": "random"}}"#).unwrap();
        assert_eq!(
            n4io_validate(ctx, bad.as_ptr()),
            n4io_status_t::N4IO_ERR_SPEC
        );
        assert!(!last_error(ctx).is_empty());
        // a subsequent successful call must clear it (never report a stale message on OK)
        let path_json = serde_json::to_string(&corpus_case("train_test")).unwrap();
        let (st, _) = call2(n4io_to_spec, ctx, &path_json);
        assert_eq!(st, n4io_status_t::N4IO_OK, "err: {}", last_error(ctx));
        assert_eq!(
            last_error(ctx),
            "",
            "OK path must leave an empty error buffer"
        );
        n4io_context_destroy(ctx);
    }
}
