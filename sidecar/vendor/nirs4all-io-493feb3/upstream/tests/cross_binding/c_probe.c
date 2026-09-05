// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
// Direct C-ABI leg for IO-XLG-001. Prints the core-owned canonical summary.
#include "nirs4all_io.h"

#include <stdio.h>

int main(int argc, char **argv) {
  n4io_context_t *ctx = NULL;
  char *out = NULL;
  n4io_status_t status;

  if (argc != 2) {
    fputs("usage: c_probe <input-json>\n", stderr);
    return 64;
  }
  if (n4io_context_create(&ctx) != N4IO_OK || ctx == NULL) {
    fputs("n4io_context_create failed\n", stderr);
    return 1;
  }
  status = n4io_load_summary(ctx, argv[1], NULL, &out);
  if (status != N4IO_OK) {
    fprintf(stderr, "%s\n", n4io_context_last_error(ctx));
    n4io_context_destroy(ctx);
    return 1;
  }
  fputs(out, stdout);
  n4io_string_free(out);
  n4io_context_destroy(ctx);
  return 0;
}
