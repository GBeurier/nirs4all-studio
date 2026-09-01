// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
// R <-> nirs4all-io C ABI glue (EPIC 11.2). Each .Call entry drives the stable
// n4io_ JSON surface: a per-call context carries the error buffer; on a non-OK
// status the message is raised as an R error; owned result strings are copied
// into an R string and freed with n4io_string_free.
#include <R.h>
#include <Rinternals.h>
#include <R_ext/Rdynload.h>
#include <string.h>

#include "nirs4all_io.h"

// Read element 0 of an R character vector, or NULL for NULL / NA / empty.
static const char *opt_cstr(SEXP s) {
    if (s == R_NilValue || TYPEOF(s) != STRSXP || LENGTH(s) == 0)
        return NULL;
    SEXP e = STRING_ELT(s, 0);
    if (e == NA_STRING)
        return NULL;
    return CHAR(e);
}

static const char *req_cstr(SEXP s, const char *what) {
    const char *p = opt_cstr(s);
    if (p == NULL)
        Rf_error("%s must be a non-NA character scalar", what);
    return p;
}

// Run an n4io JSON-surface call returning an owned string; raise on non-OK.
typedef n4io_status_t (*json_fn)(n4io_context_t *, const char *, const char *, char **);

static SEXP call_json(json_fn fn, SEXP input_json, SEXP conventions_json) {
    const char *inp = req_cstr(input_json, "input_json");
    const char *conv = opt_cstr(conventions_json);
    n4io_context_t *ctx = NULL;
    if (n4io_context_create(&ctx) != N4IO_OK)
        Rf_error("n4io: failed to create context");
    char *out = NULL;
    n4io_status_t st = fn(ctx, inp, conv, &out);
    if (st != N4IO_OK) {
        // Copy the context error before destroying it.
        const char *msg = n4io_context_last_error(ctx);
        char buf[1024];
        snprintf(buf, sizeof(buf), "%s", msg ? msg : "unknown error");
        n4io_context_destroy(ctx);
        Rf_error("n4io error: %s", buf);
    }
    SEXP res = PROTECT(Rf_mkString(out ? out : ""));
    n4io_string_free(out);
    n4io_context_destroy(ctx);
    UNPROTECT(1);
    return res;
}

SEXP r_n4io_to_spec(SEXP input_json, SEXP conventions_json) {
    return call_json(n4io_to_spec, input_json, conventions_json);
}

SEXP r_n4io_infer(SEXP input_json, SEXP conventions_json) {
    return call_json(n4io_infer, input_json, conventions_json);
}

SEXP r_n4io_load_summary(SEXP input_json, SEXP conventions_json) {
    return call_json(n4io_load_summary, input_json, conventions_json);
}

SEXP r_n4io_validate(SEXP spec_json) {
    const char *spec = req_cstr(spec_json, "spec_json");
    n4io_context_t *ctx = NULL;
    if (n4io_context_create(&ctx) != N4IO_OK)
        Rf_error("n4io: failed to create context");
    n4io_status_t st = n4io_validate(ctx, spec);
    if (st != N4IO_OK) {
        const char *msg = n4io_context_last_error(ctx);
        char buf[1024];
        snprintf(buf, sizeof(buf), "%s", msg ? msg : "unknown error");
        n4io_context_destroy(ctx);
        Rf_error("n4io error: %s", buf);
    }
    n4io_context_destroy(ctx);
    return R_NilValue;
}

SEXP r_n4io_abi_version(void) {
    char *v = n4io_abi_version();
    SEXP res = PROTECT(Rf_mkString(v ? v : ""));
    n4io_string_free(v);
    UNPROTECT(1);
    return res;
}

static const R_CallMethodDef call_methods[] = {
    {"r_n4io_to_spec", (DL_FUNC)&r_n4io_to_spec, 2},
    {"r_n4io_infer", (DL_FUNC)&r_n4io_infer, 2},
    {"r_n4io_load_summary", (DL_FUNC)&r_n4io_load_summary, 2},
    {"r_n4io_validate", (DL_FUNC)&r_n4io_validate, 1},
    {"r_n4io_abi_version", (DL_FUNC)&r_n4io_abi_version, 0},
    {NULL, NULL, 0}};

void R_init_nirs4allio(DllInfo *info) {
    R_registerRoutines(info, NULL, call_methods, NULL, NULL);
    R_useDynamicSymbols(info, FALSE);
}
