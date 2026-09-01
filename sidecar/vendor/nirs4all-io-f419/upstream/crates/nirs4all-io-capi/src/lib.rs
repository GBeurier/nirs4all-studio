// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Stable C ABI for `nirs4all-io` (symbol prefix `n4io_`).
//!
//! v0 surface is JSON-string in / JSON-string out (`to_spec` / `infer` /
//! `validate`); no materialized arrays cross the ABI in v0 (D-R7). Memory:
//! callers free strings returned by the library with [`n4io_string_free`] and
//! contexts with [`n4io_context_destroy`]; never free a library pointer with the
//! host allocator (`bindings/SPEC.md` §4). All fallible calls return an
//! [`n4io_status_t`]; on a non-OK status the message is in the context's error
//! buffer (copy it out before the next call on that context).
#![allow(non_camel_case_types)] // C-ABI snake_case type names + N4IO_* variants are intentional.

use std::ffi::{c_char, CStr, CString};

use nirs4all_io::api::{load_assembled, to_spec, Input};
use nirs4all_io::canonical_json;
use nirs4all_io::core::spec::{validate_spec, DatasetSpec};
use serde_json::Value;

/// ABI version string. Independent of crate semver (D-R6); bump on ABI change.
pub const N4IO_ABI_VERSION: &str = "0.2.0";
const ABI_MAJOR: u32 = 0;
const ABI_MINOR: u32 = 2;

/// Status code returned by every fallible call. `N4IO_OK == 0`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum n4io_status_t {
    N4IO_OK = 0,
    /// A malformed/invalid `DatasetSpec` or input (a `SpecError`).
    N4IO_ERR_SPEC = 1,
    /// A null pointer or non-UTF-8 / non-JSON argument.
    N4IO_ERR_INVALID_ARGUMENT = 2,
    /// ABI major mismatch.
    N4IO_ERR_ABI_MISMATCH = 12,
    /// Library minor older than the header requested.
    N4IO_ERR_VERSION_INCOMPATIBLE = 15,
    /// Unexpected internal error.
    N4IO_ERR_INTERNAL = 255,
}

/// Opaque per-context handle carrying the last error message. Not `repr(C)` and
/// only ever used behind a pointer, so cbindgen emits it as opaque.
pub struct n4io_context_t {
    last_error: CString,
}

/// Return the ABI version as a freshly allocated C string (free with [`n4io_string_free`]).
///
/// # Safety
/// The returned pointer is non-null and owned by the caller.
#[no_mangle]
pub extern "C" fn n4io_abi_version() -> *mut c_char {
    CString::new(N4IO_ABI_VERSION)
        .expect("static version contains no nul")
        .into_raw()
}

/// Check ABI compatibility: header MAJOR must equal the library MAJOR and the
/// library MINOR must be `>=` the header MINOR (forward-compatible additions).
#[no_mangle]
pub extern "C" fn n4io_check_abi_compatibility(
    header_major: u32,
    header_minor: u32,
) -> n4io_status_t {
    if header_major != ABI_MAJOR {
        n4io_status_t::N4IO_ERR_ABI_MISMATCH
    } else if header_minor > ABI_MINOR {
        n4io_status_t::N4IO_ERR_VERSION_INCOMPATIBLE
    } else {
        n4io_status_t::N4IO_OK
    }
}

/// Free a string previously returned by this library.
///
/// # Safety
/// `ptr` must be a pointer returned by an `n4io_*` function that transfers
/// ownership, or null. Each such pointer must be freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn n4io_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

/// Create a context (carries the last error buffer). Returns `N4IO_OK` and sets
/// `*out`; on failure sets `*out` to null.
///
/// # Safety
/// `out` must be a valid, writable `*mut n4io_context_t` location.
#[no_mangle]
pub unsafe extern "C" fn n4io_context_create(out: *mut *mut n4io_context_t) -> n4io_status_t {
    if out.is_null() {
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    }
    let ctx = Box::new(n4io_context_t {
        last_error: CString::default(),
    });
    *out = Box::into_raw(ctx);
    n4io_status_t::N4IO_OK
}

/// Destroy a context. No-op on null.
///
/// # Safety
/// `ctx` must have come from [`n4io_context_create`] and not been destroyed.
#[no_mangle]
pub unsafe extern "C" fn n4io_context_destroy(ctx: *mut n4io_context_t) {
    if !ctx.is_null() {
        drop(Box::from_raw(ctx));
    }
}

/// Return the context's last error message (context-owned; copy before the next
/// call on this context). Never null: empty string when no error / null ctx.
///
/// # Safety
/// `ctx` must be a valid context pointer or null.
#[no_mangle]
pub unsafe extern "C" fn n4io_context_last_error(ctx: *const n4io_context_t) -> *const c_char {
    if ctx.is_null() {
        return c"".as_ptr();
    }
    (*ctx).last_error.as_ptr()
}

unsafe fn set_error(ctx: *mut n4io_context_t, msg: &str) {
    if !ctx.is_null() {
        (*ctx).last_error = CString::new(msg.replace('\0', " ")).unwrap_or_default();
    }
}

/// Reset the context error buffer (called at entry so a successful call leaves
/// it empty, per the ABI contract — never reports a stale message on `N4IO_OK`).
unsafe fn clear_error(ctx: *mut n4io_context_t) {
    if !ctx.is_null() {
        (*ctx).last_error = CString::default();
    }
}

unsafe fn cstr_to_str<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok()
}

/// Collect a JSON array of strings, rejecting any non-string element. `what`
/// names the field for the error message.
fn string_array(values: &[Value], what: &str) -> Result<Vec<String>, String> {
    values
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{what} must contain only strings"))
        })
        .collect()
}

/// Parse the `conventions_json` argument directly from its pointer so that a
/// non-null but non-UTF-8 buffer is rejected (distinct from an omitted pointer).
unsafe fn parse_conventions(ptr: *const c_char) -> Result<Option<Vec<String>>, String> {
    if ptr.is_null() {
        return Ok(None);
    }
    let s = CStr::from_ptr(ptr)
        .to_str()
        .map_err(|_| "conventions_json is not UTF-8".to_string())?;
    if s.trim().is_empty() {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(s).map_err(|e| format!("conventions JSON: {e}"))?;
    match v {
        Value::Null => Ok(None),
        Value::Array(a) => Ok(Some(string_array(&a, "conventions")?)),
        _ => Err("conventions must be a JSON array of strings or null".into()),
    }
}

fn input_from_json(input_json: &str) -> Result<Input, String> {
    let v: Value = serde_json::from_str(input_json).map_err(|e| format!("input JSON: {e}"))?;
    match v {
        Value::String(s) => Ok(Input::Path(s)),
        Value::Array(a) => Ok(Input::Paths(string_array(&a, "input file list")?)),
        Value::Object(_) => Ok(Input::Spec(v)),
        _ => Err("input must be a JSON object (spec), string (path), or array (file list)".into()),
    }
}

unsafe fn write_out(ctx: *mut n4io_context_t, out: *mut *mut c_char, s: String) -> n4io_status_t {
    match CString::new(s) {
        Ok(c) => {
            *out = c.into_raw();
            n4io_status_t::N4IO_OK
        }
        Err(_) => {
            set_error(ctx, "result contained an interior NUL byte");
            n4io_status_t::N4IO_ERR_INTERNAL
        }
    }
}

/// Normalize an input into a canonical `DatasetSpec` JSON.
///
/// `input_json`: a spec object, a path string, or a file-list array.
/// `conventions_json`: a JSON string array or null. Writes the canonical spec to
/// `*out` (owned; free with [`n4io_string_free`]).
///
/// # Safety
/// All pointers must be valid for the call; `out` writable.
#[no_mangle]
pub unsafe extern "C" fn n4io_to_spec(
    ctx: *mut n4io_context_t,
    input_json: *const c_char,
    conventions_json: *const c_char,
    out: *mut *mut c_char,
) -> n4io_status_t {
    clear_error(ctx);
    if out.is_null() {
        set_error(ctx, "out pointer is null");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    }
    *out = std::ptr::null_mut();
    let Some(input_json) = cstr_to_str(input_json) else {
        set_error(ctx, "input_json is null or not UTF-8");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    };
    let conv = match parse_conventions(conventions_json) {
        Ok(c) => c,
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    let input = match input_from_json(input_json) {
        Ok(i) => i,
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    match to_spec(&input, conv.as_deref(), None) {
        Ok((spec, _base)) => match canonical_json(&spec.to_value()) {
            Ok(s) => write_out(ctx, out, s),
            Err(e) => {
                set_error(ctx, &e.to_string());
                n4io_status_t::N4IO_ERR_INTERNAL
            }
        },
        Err(e) => {
            set_error(ctx, &e.message);
            n4io_status_t::N4IO_ERR_SPEC
        }
    }
}

/// Inspect a data input (path string or file-list array) and write the scored
/// `DatasetPlan` JSON to `*out` (owned).
///
/// # Safety
/// All pointers must be valid for the call; `out` writable.
#[no_mangle]
pub unsafe extern "C" fn n4io_infer(
    ctx: *mut n4io_context_t,
    input_json: *const c_char,
    conventions_json: *const c_char,
    out: *mut *mut c_char,
) -> n4io_status_t {
    clear_error(ctx);
    if out.is_null() {
        set_error(ctx, "out pointer is null");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    }
    *out = std::ptr::null_mut();
    let Some(input_json) = cstr_to_str(input_json) else {
        set_error(ctx, "input_json is null or not UTF-8");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    };
    let conv = match parse_conventions(conventions_json) {
        Ok(c) => c,
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    let plan = match input_from_json(input_json) {
        Ok(Input::Path(p)) => nirs4all_io::infer::infer_path(&p, conv.as_deref()),
        Ok(Input::Paths(ps)) => nirs4all_io::infer::infer_paths(&ps, conv.as_deref()),
        Ok(Input::Spec(_)) => {
            set_error(
                ctx,
                "infer needs a data input (path or file list), not a spec",
            );
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    match plan {
        Ok(plan) => match canonical_json(&plan.to_value()) {
            Ok(s) => write_out(ctx, out, s),
            Err(e) => {
                set_error(ctx, &e.to_string());
                n4io_status_t::N4IO_ERR_INTERNAL
            }
        },
        Err(e) => {
            set_error(ctx, &e.message);
            n4io_status_t::N4IO_ERR_SPEC
        }
    }
}

/// Materialize an input and write the assembled-dataset structural summary JSON
/// to `*out` (owned).
///
/// # Safety
/// All pointers must be valid for the call; `out` writable.
#[no_mangle]
pub unsafe extern "C" fn n4io_load_summary(
    ctx: *mut n4io_context_t,
    input_json: *const c_char,
    conventions_json: *const c_char,
    out: *mut *mut c_char,
) -> n4io_status_t {
    clear_error(ctx);
    if out.is_null() {
        set_error(ctx, "out pointer is null");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    }
    *out = std::ptr::null_mut();
    let Some(input_json) = cstr_to_str(input_json) else {
        set_error(ctx, "input_json is null or not UTF-8");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    };
    let conv = match parse_conventions(conventions_json) {
        Ok(c) => c,
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    let input = match input_from_json(input_json) {
        Ok(i) => i,
        Err(e) => {
            set_error(ctx, &e);
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    match load_assembled(&input, conv.as_deref(), None) {
        Ok(assembled) => match canonical_json(&assembled.to_summary_value()) {
            Ok(s) => write_out(ctx, out, s),
            Err(e) => {
                set_error(ctx, &e.to_string());
                n4io_status_t::N4IO_ERR_INTERNAL
            }
        },
        Err(e) => {
            set_error(ctx, &e.message);
            n4io_status_t::N4IO_ERR_SPEC
        }
    }
}

/// Validate a `DatasetSpec` JSON. Returns `N4IO_OK` if valid, else
/// `N4IO_ERR_SPEC` with the aggregate message in the context error buffer.
///
/// # Safety
/// All pointers must be valid for the call.
#[no_mangle]
pub unsafe extern "C" fn n4io_validate(
    ctx: *mut n4io_context_t,
    spec_json: *const c_char,
) -> n4io_status_t {
    clear_error(ctx);
    let Some(spec_json) = cstr_to_str(spec_json) else {
        set_error(ctx, "spec_json is null or not UTF-8");
        return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
    };
    let value: Value = match serde_json::from_str(spec_json) {
        Ok(v) => v,
        Err(e) => {
            set_error(ctx, &format!("spec JSON: {e}"));
            return n4io_status_t::N4IO_ERR_INVALID_ARGUMENT;
        }
    };
    let spec = match DatasetSpec::from_value(&value) {
        Ok(s) => s,
        Err(e) => {
            set_error(ctx, &e.message);
            return n4io_status_t::N4IO_ERR_SPEC;
        }
    };
    match validate_spec(&spec) {
        Ok(()) => n4io_status_t::N4IO_OK,
        Err(e) => {
            set_error(ctx, &e.message);
            n4io_status_t::N4IO_ERR_SPEC
        }
    }
}
