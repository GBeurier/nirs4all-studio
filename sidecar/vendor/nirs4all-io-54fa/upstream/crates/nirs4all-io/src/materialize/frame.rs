// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! The typed materialization frame now lives in `nirs4all-io-core` so the WASM
//! binding can reach it. Re-exported here for the facade's path-based callers.

pub use nirs4all_io_core::materialize::frame::{Cell, Column, Frame, JoinKey, Matrix};
