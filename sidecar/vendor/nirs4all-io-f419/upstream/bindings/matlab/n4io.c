/* SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
 * MATLAB/Octave MEX glue for the nirs4all-io C ABI (EPIC 11.3).
 *
 *   n4io('to_spec',  input_json[, conventions_json]) -> char  (canonical spec)
 *   n4io('infer',    input_json[, conventions_json]) -> char  (DatasetPlan)
 *   n4io('validate', spec_json)                      -> [] (errors if invalid)
 *   n4io('abi_version')                              -> char
 *
 * Mirrors the verified R glue (bindings/r/src/n4io.c) against the same frozen
 * header: a per-call context carries the error buffer; a non-OK status becomes a
 * MATLAB error; owned result strings are copied out and freed with
 * n4io_string_free. Build with bindings/matlab/build.m (needs the prebuilt
 * libnirs4all_io_capi); the Octave CI leg (.github/workflows/octave-binding.yml)
 * compiles and smoke-tests it. */
#include "mex.h"
#include "nirs4all_io.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *opt_arg(int nrhs, const mxArray *prhs[], int idx) {
    if (idx >= nrhs || mxIsEmpty(prhs[idx]) || !mxIsChar(prhs[idx]))
        return NULL;
    return mxArrayToString(prhs[idx]); /* leaks per call; MEX process is short-lived */
}

static void raise_ctx(n4io_context_t *ctx) {
    const char *msg = n4io_context_last_error(ctx);
    char buf[1024];
    snprintf(buf, sizeof(buf), "%s", msg ? msg : "unknown error");
    n4io_context_destroy(ctx);
    mexErrMsgIdAndTxt("n4io:error", "%s", buf);
}

static mxArray *owned_to_mx(char *owned) {
    mxArray *out = mxCreateString(owned ? owned : "");
    n4io_string_free(owned);
    return out;
}

void mexFunction(int nlhs, mxArray *plhs[], int nrhs, const mxArray *prhs[]) {
    (void)nlhs;
    if (nrhs < 1 || !mxIsChar(prhs[0]))
        mexErrMsgIdAndTxt("n4io:arg", "first argument must be a command string");
    char *cmd = mxArrayToString(prhs[0]);

    n4io_context_t *ctx = NULL;
    if (n4io_context_create(&ctx) != N4IO_OK)
        mexErrMsgIdAndTxt("n4io:ctx", "failed to create context");

    if (strcmp(cmd, "abi_version") == 0) {
        n4io_context_destroy(ctx);
        plhs[0] = owned_to_mx(n4io_abi_version());
        return;
    }

    if (strcmp(cmd, "validate") == 0) {
        const char *spec = opt_arg(nrhs, prhs, 1);
        if (spec == NULL) {
            n4io_context_destroy(ctx);
            mexErrMsgIdAndTxt("n4io:arg", "validate requires a spec JSON string");
        }
        if (n4io_validate(ctx, spec) != N4IO_OK)
            raise_ctx(ctx);
        n4io_context_destroy(ctx);
        plhs[0] = mxCreateDoubleMatrix(0, 0, mxREAL);
        return;
    }

    const char *input = opt_arg(nrhs, prhs, 1);
    const char *conv = opt_arg(nrhs, prhs, 2);
    if (input == NULL) {
        n4io_context_destroy(ctx);
        mexErrMsgIdAndTxt("n4io:arg", "%s requires an input JSON string", cmd);
    }
    char *out = NULL;
    n4io_status_t st;
    if (strcmp(cmd, "to_spec") == 0)
        st = n4io_to_spec(ctx, input, conv, &out);
    else if (strcmp(cmd, "infer") == 0)
        st = n4io_infer(ctx, input, conv, &out);
    else if (strcmp(cmd, "load_summary") == 0)
        st = n4io_load_summary(ctx, input, conv, &out);
    else {
        n4io_context_destroy(ctx);
        mexErrMsgIdAndTxt("n4io:cmd", "unknown command '%s'", cmd);
        return;
    }
    if (st != N4IO_OK)
        raise_ctx(ctx);
    n4io_context_destroy(ctx);
    plhs[0] = owned_to_mx(out);
}
