//! Typed, streamed SHA-256 content hashing for bulk numeric payloads.
//!
//! Buffers and N-D tensors carry a content fingerprint for reproducibility
//! lineage. Hashing must be:
//!
//! * **platform-independent** — every multi-byte field is fed as explicit
//!   little-endian bytes (`*::to_le_bytes()`); there are no `as` casts to byte
//!   widths and no native-endian writes, so the same logical payload yields the
//!   same fingerprint on any host (including WASM);
//! * **unambiguously framed** — variable-length strings are prefixed with a
//!   little-endian `u64` length, so `["ab","c"]` can never produce the same
//!   byte stream as `["a","bc"]`; and
//! * **streamed** — bytes are fed to the hasher through a fixed scratch buffer,
//!   never accumulated into an `O(n_cells)` intermediate `Vec`.
//!
//! This module owns only the framing/streaming primitive. Each payload type
//! (see [`crate::buffer`], [`crate::nd_tensor`]) is responsible for its own
//! domain-separation tag and field order.

use sha2::{Digest, Sha256};

/// Size of the scratch buffer that batches small absorbs before they are fed to
/// the SHA-256 state. Sized so the per-element cell writes (a presence byte
/// plus 8 value bytes) and the largest fixed N-D element (8 bytes) amortize the
/// per-`update` call overhead without holding a payload-sized allocation. The
/// scratch is flushed whenever the next write would not fit, so correctness is
/// independent of this constant.
const SCRATCH_CAPACITY: usize = 8 * 1024;

/// A streaming SHA-256 hasher with length-prefixed, little-endian framing
/// helpers. Construct with a domain-separation tag, absorb the typed fields in
/// a fixed order, then call [`StreamingHasher::finalize_hex`].
pub struct StreamingHasher {
    hasher: Sha256,
    scratch: Vec<u8>,
}

impl StreamingHasher {
    /// Starts a hash, absorbing `domain` (a fixed, ideally NUL-terminated
    /// literal) first so payloads of different kinds never share a preimage.
    pub fn new(domain: &[u8]) -> Self {
        let mut hasher = Self {
            hasher: Sha256::new(),
            scratch: Vec::with_capacity(SCRATCH_CAPACITY),
        };
        // The domain tag is a fixed-length literal; feed it directly.
        hasher.hasher.update(domain);
        hasher
    }

    /// Pushes raw bytes through the scratch buffer, flushing first if they
    /// would not fit. Anything at least as large as the scratch capacity is fed
    /// straight to the hasher to avoid a pointless copy.
    fn push_bytes(&mut self, bytes: &[u8]) {
        if bytes.len() >= SCRATCH_CAPACITY {
            self.flush();
            self.hasher.update(bytes);
            return;
        }
        if self.scratch.len() + bytes.len() > SCRATCH_CAPACITY {
            self.flush();
        }
        self.scratch.extend_from_slice(bytes);
    }

    fn flush(&mut self) {
        if !self.scratch.is_empty() {
            self.hasher.update(&self.scratch);
            self.scratch.clear();
        }
    }

    /// Absorbs a `u64` as 8 little-endian bytes.
    pub fn absorb_u64(&mut self, value: u64) {
        self.push_bytes(&value.to_le_bytes());
    }

    /// Absorbs a length or count as a `u64`, converting from `usize` with a
    /// **checked** cast. A plain `as u64` would silently truncate on a
    /// hypothetical `usize > u64` target, and a truncated length prefix is a
    /// framing hole (two differently sized fields could share a preimage), so
    /// this turns the impossible-overflow case into a loud panic instead. On
    /// every real target `usize <= u64`, so the conversion never fails.
    pub fn absorb_len(&mut self, len: usize) {
        let value = u64::try_from(len)
            .expect("content-hash field length exceeds u64 (impossible on supported targets)");
        self.absorb_u64(value);
    }

    /// Absorbs a length-prefixed UTF-8 string: `len: u64` then the raw bytes.
    pub fn absorb_str(&mut self, value: &str) {
        let bytes = value.as_bytes();
        self.absorb_len(bytes.len());
        self.push_bytes(bytes);
    }

    /// Absorbs an ordered string collection with two levels of framing: first
    /// the element COUNT as a `u64`, then each element through
    /// [`StreamingHasher::absorb_str`] (its own `len`-prefix). Prefixing the
    /// count as well as each string means a collection boundary is never
    /// ambiguous: `["a"]` followed by `["b"]` cannot share a preimage with
    /// `["a","b"]` followed by `[]`, so reordering or moving an element between
    /// two adjacent collections always changes the digest.
    ///
    /// The count is taken from `ExactSizeIterator::len()`. All in-crate callers
    /// pass slice / `slice::Iter::map` iterators whose `len()` is exact; the
    /// helper is crate-private (see the `pub(crate) mod` in `lib.rs`) so an
    /// untrusted custom `ExactSizeIterator` with a dishonest `len()` can never
    /// reach it from outside the crate.
    pub fn absorb_str_collection<'a, I>(&mut self, items: I)
    where
        I: IntoIterator<Item = &'a str>,
        I::IntoIter: ExactSizeIterator,
    {
        let iter = items.into_iter();
        self.absorb_len(iter.len());
        for item in iter {
            self.absorb_str(item);
        }
    }

    /// Absorbs one numeric cell: a presence byte (`1` present, `0` masked)
    /// followed by 8 little-endian `f64` bytes. Masked cells write 8 zero value
    /// bytes; the presence byte alone distinguishes `None` from `Some(0.0)`,
    /// keeping a fixed 9-byte cell stride.
    pub fn absorb_cell(&mut self, cell: Option<f64>) {
        let mut framed = [0u8; 9];
        if let Some(value) = cell {
            framed[0] = 1;
            framed[1..].copy_from_slice(&value.to_le_bytes());
        }
        self.push_bytes(&framed);
    }

    /// Absorbs an already-byte-shaped, contiguous payload (e.g. an N-D tensor's
    /// canonical row-major bytes, whose dtype framing is the caller's
    /// responsibility) directly into the hash stream.
    pub fn absorb_raw(&mut self, bytes: &[u8]) {
        self.push_bytes(bytes);
    }

    /// Flushes any buffered bytes and returns the 64-char lowercase hex digest.
    pub fn finalize_hex(mut self) -> String {
        self.flush();
        let digest = self.hasher.finalize();
        let mut out = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write;
            write!(&mut out, "{byte:02x}").expect("writing to string cannot fail");
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finalize_is_64_lowercase_hex() {
        let hex = StreamingHasher::new(b"domain\0").finalize_hex();
        assert_eq!(hex.len(), 64);
        assert!(hex
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn streaming_matches_a_single_update_over_the_same_bytes() {
        // The scratch buffer must not change the digest vs. one contiguous
        // update over the identical preimage bytes. Build the preimage by hand.
        let mut expected = Vec::new();
        expected.extend_from_slice(b"domain\0");
        expected.extend_from_slice(&3u64.to_le_bytes()); // "abc".len()
        expected.extend_from_slice(b"abc");
        expected.extend_from_slice(&42u64.to_le_bytes());
        // present 1.5
        expected.push(1);
        expected.extend_from_slice(&1.5f64.to_le_bytes());
        // masked
        expected.push(0);
        expected.extend_from_slice(&0.0f64.to_le_bytes());
        let expected_hex = {
            let digest = Sha256::digest(&expected);
            let mut out = String::new();
            for byte in digest {
                use std::fmt::Write;
                write!(&mut out, "{byte:02x}").unwrap();
            }
            out
        };

        let mut hasher = StreamingHasher::new(b"domain\0");
        hasher.absorb_str("abc");
        hasher.absorb_u64(42);
        hasher.absorb_cell(Some(1.5));
        hasher.absorb_cell(None);
        assert_eq!(hasher.finalize_hex(), expected_hex);
    }

    #[test]
    fn large_absorb_bypasses_scratch_without_changing_digest() {
        // A payload larger than the scratch capacity is fed straight through;
        // it must hash identically to the same bytes split across two absorbs.
        let big = vec![0xABu8; SCRATCH_CAPACITY * 2 + 7];
        let mut one = StreamingHasher::new(b"d");
        one.absorb_raw(&big);
        let mut two = StreamingHasher::new(b"d");
        two.absorb_raw(&big[..5]);
        two.absorb_raw(&big[5..]);
        assert_eq!(one.finalize_hex(), two.finalize_hex());
    }

    #[test]
    fn masked_cell_differs_from_zero_cell() {
        let mut masked = StreamingHasher::new(b"d");
        masked.absorb_cell(None);
        let mut zero = StreamingHasher::new(b"d");
        zero.absorb_cell(Some(0.0));
        assert_ne!(masked.finalize_hex(), zero.finalize_hex());
    }

    #[test]
    fn string_framing_prevents_concatenation_collision() {
        let mut ab_c = StreamingHasher::new(b"d");
        ab_c.absorb_str("ab");
        ab_c.absorb_str("c");
        let mut a_bc = StreamingHasher::new(b"d");
        a_bc.absorb_str("a");
        a_bc.absorb_str("bc");
        assert_ne!(ab_c.finalize_hex(), a_bc.finalize_hex());
    }

    #[test]
    fn collection_count_prefix_prevents_boundary_collision() {
        // The element-count prefix means an element cannot migrate between two
        // adjacent collections without changing the digest: ["a"] then ["b"]
        // must differ from ["a","b"] then [].
        let mut split = StreamingHasher::new(b"d");
        split.absorb_str_collection(["a"]);
        split.absorb_str_collection(["b"]);
        let mut merged = StreamingHasher::new(b"d");
        merged.absorb_str_collection(["a", "b"]);
        merged.absorb_str_collection(std::iter::empty::<&str>());
        assert_ne!(split.finalize_hex(), merged.finalize_hex());
    }

    #[test]
    fn collection_order_changes_digest() {
        let mut forward = StreamingHasher::new(b"d");
        forward.absorb_str_collection(["a", "b"]);
        let mut reversed = StreamingHasher::new(b"d");
        reversed.absorb_str_collection(["b", "a"]);
        assert_ne!(forward.finalize_hex(), reversed.finalize_hex());
    }
}
