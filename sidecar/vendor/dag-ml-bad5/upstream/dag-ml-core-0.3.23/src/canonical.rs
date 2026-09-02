//! DAG-ML Typed Canonical Value v1 (TCV1).
//!
//! TCV1 is deliberately distinct from the historical JSON fingerprints used
//! elsewhere in this crate. It preserves the JSON token distinction between
//! integers and binary64 values, normalizes text to Unicode NFC, orders object
//! keys by normalized UTF-8 bytes, and hashes a domain-separated binary
//! preimage. Existing callers of `stable_json_fingerprint` are intentionally
//! unaffected.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use crate::error::{DagMlError, Result as DagMlResult};

/// Domain separator prepended to every TCV1 value before hashing.
pub const TCV1_PREFIX: &[u8] = b"DAGML-TCV1\0";

const MAX_NESTING_DEPTH: usize = 128;

/// An integer parsed without passing through binary64.
///
/// During JSON parsing, tokens with a leading minus sign use the signed domain
/// and all other integer tokens use the unsigned domain. The public variants
/// also allow direct construction with any `i64` or `u64`; their common values
/// intentionally have the same TCV1 decimal encoding. Lexical `-0` parses as
/// signed zero and has the same TCV1 encoding as unsigned zero.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CanonicalInteger {
    Signed(i64),
    Unsigned(u64),
}

impl CanonicalInteger {
    fn decimal(&self) -> String {
        match self {
            Self::Signed(value) => value.to_string(),
            Self::Unsigned(value) => value.to_string(),
        }
    }
}

/// A strict JSON value that retains integer-versus-binary64 token kind.
///
/// [`TypedCanonicalValue::Object`] retains input order for diagnostics and
/// representation equality, but object order is not significant to TCV1.
/// Encoding validates raw and NFC-normalized key uniqueness and then sorts keys
/// by normalized UTF-8 bytes. Public variants permit construction without a
/// JSON round-trip;
/// [`tcv1_encode`] performs the same finite-number and object-key checks for
/// such values as [`parse_typed_json`].
#[derive(Clone, Debug, PartialEq)]
pub enum TypedCanonicalValue {
    Null,
    Bool(bool),
    Integer(CanonicalInteger),
    Binary64(f64),
    String(String),
    Array(Vec<TypedCanonicalValue>),
    Object(Vec<(String, TypedCanonicalValue)>),
}

impl TypedCanonicalValue {
    /// Return the lowercase SHA-256 fingerprint of this value's TCV1 preimage.
    pub fn fingerprint(&self) -> Result<String, Tcv1Error> {
        tcv1_sha256(self)
    }

    /// Fingerprint an object after removing exactly one normalized key.
    ///
    /// This supports self-fingerprinted contracts without accepting ambiguous
    /// NFC aliases. The receiver must be an object and the requested key must
    /// occur exactly once after NFC normalization.
    pub fn fingerprint_without(&self, key: &str) -> Result<String, Tcv1Error> {
        let Self::Object(entries) = self else {
            return Err(Tcv1Error::ExpectedObject);
        };
        let normalized_key = normalize(key);
        let mut removed = 0_usize;
        let mut filtered = Vec::with_capacity(entries.len().saturating_sub(1));
        for (member_key, member_value) in entries {
            if normalize(member_key) == normalized_key {
                removed += 1;
            } else {
                filtered.push((member_key.clone(), member_value.clone()));
            }
        }
        match removed {
            0 => Err(Tcv1Error::MissingObjectKey(normalized_key)),
            1 => tcv1_sha256(&Self::Object(filtered)),
            _ => Err(Tcv1Error::AmbiguousObjectKey(normalized_key)),
        }
    }
}

/// Parse or encoding failure for the strict TCV1 domain.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum Tcv1Error {
    #[error("input is not valid UTF-8 at byte {valid_up_to}")]
    InvalidUtf8 {
        valid_up_to: usize,
        error_len: Option<usize>,
    },

    #[error("invalid JSON at UTF-8 byte {offset}: {message}")]
    InvalidJson {
        offset: usize,
        message: &'static str,
    },

    #[error("duplicate JSON object key `{key}` at UTF-8 byte {offset}")]
    DuplicateObjectKey { key: String, offset: usize },

    #[error("NFC-colliding JSON object keys `{first}` and `{second}` at UTF-8 byte {offset}")]
    NfcKeyCollision {
        first: String,
        second: String,
        offset: usize,
    },

    #[error("integer token at UTF-8 byte {offset} is outside the TCV1 {domain} range")]
    IntegerOutOfRange { offset: usize, domain: &'static str },

    #[error("number token at UTF-8 byte {offset} is outside finite binary64 range")]
    Binary64OutOfRange { offset: usize },

    #[error("TCV1 value nesting exceeds {MAX_NESTING_DEPTH} levels")]
    NestingTooDeep,

    #[error("TCV1 collection length does not fit u64")]
    LengthOverflow,

    #[error("programmatically constructed TCV1 binary64 must be finite")]
    NonFiniteBinary64,

    #[error("fingerprint_without requires a TCV1 object")]
    ExpectedObject,

    #[error("object does not contain normalized key `{0}`")]
    MissingObjectKey(String),

    #[error("object contains more than one key normalized as `{0}`")]
    AmbiguousObjectKey(String),
}

/// Parse exactly one strict JSON document while retaining numeric token kind.
///
/// Only RFC 8259 whitespace is accepted. Duplicate decoded keys, NFC-colliding
/// keys, unpaired UTF-16 surrogate escapes, out-of-range integer tokens,
/// non-finite binary64 conversions, and trailing data are rejected.
pub fn parse_typed_json(input: &str) -> Result<TypedCanonicalValue, Tcv1Error> {
    let mut parser = Parser::new(input);
    let value = parser.parse_value(0)?;
    parser.skip_whitespace();
    if parser.offset != input.len() {
        return Err(parser.invalid("trailing data after the JSON value"));
    }
    Ok(value)
}

/// Parse exactly one strict UTF-8 JSON document while retaining numeric kind.
pub fn parse_typed_json_bytes(input: &[u8]) -> Result<TypedCanonicalValue, Tcv1Error> {
    let input = std::str::from_utf8(input).map_err(|error| Tcv1Error::InvalidUtf8 {
        valid_up_to: error.valid_up_to(),
        error_len: error.error_len(),
    })?;
    parse_typed_json(input)
}

/// Validate a structured `serde_json` value against the same finite-number,
/// nesting and NFC-key rules as a raw TCV1 document.
///
/// A `serde_json::Value` has already lost duplicate raw object members, so raw
/// JSON boundaries must still call [`parse_typed_json`] before decoding. This
/// helper is for structured host boundaries (for example Python mappings),
/// where distinct keys can still collide after Unicode normalization.
pub fn validate_typed_serde_value(value: &serde_json::Value) -> Result<(), Tcv1Error> {
    fn convert(value: &serde_json::Value) -> TypedCanonicalValue {
        match value {
            serde_json::Value::Null => TypedCanonicalValue::Null,
            serde_json::Value::Bool(value) => TypedCanonicalValue::Bool(*value),
            serde_json::Value::Number(value) => {
                if let Some(value) = value.as_u64() {
                    TypedCanonicalValue::Integer(CanonicalInteger::Unsigned(value))
                } else if let Some(value) = value.as_i64() {
                    TypedCanonicalValue::Integer(CanonicalInteger::Signed(value))
                } else {
                    TypedCanonicalValue::Binary64(
                        value
                            .as_f64()
                            .expect("serde_json numbers are integer or finite binary64"),
                    )
                }
            }
            serde_json::Value::String(value) => TypedCanonicalValue::String(value.clone()),
            serde_json::Value::Array(values) => {
                TypedCanonicalValue::Array(values.iter().map(convert).collect())
            }
            serde_json::Value::Object(values) => TypedCanonicalValue::Object(
                values
                    .iter()
                    .map(|(key, value)| (key.clone(), convert(value)))
                    .collect(),
            ),
        }
    }

    tcv1_encode(&convert(value)).map(|_| ())
}

/// Encode one value using the DAG-ML TCV1 binary grammar.
///
/// The returned bytes begin with the value tag, not the domain separator. Use
/// [`tcv1_preimage`] for bytes suitable for hashing.
pub fn tcv1_encode(value: &TypedCanonicalValue) -> Result<Vec<u8>, Tcv1Error> {
    let mut output = Vec::new();
    encode_value(value, &mut output, 0)?;
    Ok(output)
}

/// Return the domain-separated preimage `DAGML-TCV1\0 || encode(value)`.
pub fn tcv1_preimage(value: &TypedCanonicalValue) -> Result<Vec<u8>, Tcv1Error> {
    let mut output = Vec::from(TCV1_PREFIX);
    encode_value(value, &mut output, 0)?;
    Ok(output)
}

/// Return lowercase SHA-256 of [`tcv1_preimage`].
pub fn tcv1_sha256(value: &TypedCanonicalValue) -> Result<String, Tcv1Error> {
    let digest = Sha256::digest(tcv1_preimage(value)?);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(output)
}

fn normalize(value: &str) -> String {
    value.nfc().collect()
}

fn encode_value(
    value: &TypedCanonicalValue,
    output: &mut Vec<u8>,
    depth: usize,
) -> Result<(), Tcv1Error> {
    if depth > MAX_NESTING_DEPTH {
        return Err(Tcv1Error::NestingTooDeep);
    }
    match value {
        TypedCanonicalValue::Null => output.push(b'N'),
        TypedCanonicalValue::Bool(false) => output.push(b'F'),
        TypedCanonicalValue::Bool(true) => output.push(b'T'),
        TypedCanonicalValue::Integer(value) => {
            output.push(b'I');
            let payload = value.decimal();
            encode_length(payload.len(), output)?;
            output.extend_from_slice(payload.as_bytes());
        }
        TypedCanonicalValue::Binary64(value) => {
            if !value.is_finite() {
                return Err(Tcv1Error::NonFiniteBinary64);
            }
            output.push(b'D');
            let normalized = if *value == 0.0 { 0.0 } else { *value };
            output.extend_from_slice(&normalized.to_bits().to_be_bytes());
        }
        TypedCanonicalValue::String(value) => encode_string(value, output)?,
        TypedCanonicalValue::Array(values) => {
            output.push(b'A');
            encode_length(values.len(), output)?;
            for value in values {
                encode_value(value, output, depth + 1)?;
            }
        }
        TypedCanonicalValue::Object(entries) => {
            output.push(b'O');
            encode_length(entries.len(), output)?;

            let mut raw_keys = HashSet::with_capacity(entries.len());
            let mut normalized_keys = HashMap::with_capacity(entries.len());
            let mut sorted = Vec::with_capacity(entries.len());
            for (key, value) in entries {
                if !raw_keys.insert(key.as_str()) {
                    return Err(Tcv1Error::DuplicateObjectKey {
                        key: key.clone(),
                        offset: 0,
                    });
                }
                let normalized = normalize(key);
                if let Some(first) = normalized_keys.insert(normalized.clone(), key.as_str()) {
                    return Err(Tcv1Error::NfcKeyCollision {
                        first: first.to_string(),
                        second: key.clone(),
                        offset: 0,
                    });
                }
                sorted.push((normalized.into_bytes(), value));
            }
            sorted.sort_by(|left, right| left.0.cmp(&right.0));
            for (normalized_key, value) in sorted {
                encode_normalized_string(&normalized_key, output)?;
                encode_value(value, output, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn encode_string(value: &str, output: &mut Vec<u8>) -> Result<(), Tcv1Error> {
    let normalized = normalize(value);
    encode_normalized_string(normalized.as_bytes(), output)
}

fn encode_normalized_string(payload: &[u8], output: &mut Vec<u8>) -> Result<(), Tcv1Error> {
    output.push(b'S');
    encode_length(payload.len(), output)?;
    output.extend_from_slice(payload);
    Ok(())
}

fn encode_length(length: usize, output: &mut Vec<u8>) -> Result<(), Tcv1Error> {
    let length = u64::try_from(length).map_err(|_| Tcv1Error::LengthOverflow)?;
    output.extend_from_slice(&length.to_be_bytes());
    Ok(())
}

struct Parser<'a> {
    input: &'a str,
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input,
            bytes: input.as_bytes(),
            offset: 0,
        }
    }

    fn parse_value(&mut self, depth: usize) -> Result<TypedCanonicalValue, Tcv1Error> {
        if depth > MAX_NESTING_DEPTH {
            return Err(Tcv1Error::NestingTooDeep);
        }
        self.skip_whitespace();
        match self.peek() {
            Some(b'n') => {
                self.consume_literal(b"null")?;
                Ok(TypedCanonicalValue::Null)
            }
            Some(b'f') => {
                self.consume_literal(b"false")?;
                Ok(TypedCanonicalValue::Bool(false))
            }
            Some(b't') => {
                self.consume_literal(b"true")?;
                Ok(TypedCanonicalValue::Bool(true))
            }
            Some(b'"') => Ok(TypedCanonicalValue::String(self.parse_string()?)),
            Some(b'[') => self.parse_array(depth),
            Some(b'{') => self.parse_object(depth),
            Some(b'-' | b'0'..=b'9') => self.parse_number(),
            Some(_) => Err(self.invalid("expected a JSON value")),
            None => Err(self.invalid("unexpected end of input")),
        }
    }

    fn parse_array(&mut self, depth: usize) -> Result<TypedCanonicalValue, Tcv1Error> {
        self.offset += 1;
        self.skip_whitespace();
        let mut values = Vec::new();
        if self.consume_if(b']') {
            return Ok(TypedCanonicalValue::Array(values));
        }
        loop {
            values.push(self.parse_value(depth + 1)?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.offset += 1,
                Some(b']') => {
                    self.offset += 1;
                    return Ok(TypedCanonicalValue::Array(values));
                }
                Some(_) => return Err(self.invalid("expected `,` or `]` in array")),
                None => return Err(self.invalid("unterminated array")),
            }
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<TypedCanonicalValue, Tcv1Error> {
        self.offset += 1;
        self.skip_whitespace();
        let mut entries = Vec::new();
        let mut raw_keys = HashSet::new();
        let mut normalized_keys: HashMap<String, String> = HashMap::new();
        if self.consume_if(b'}') {
            return Ok(TypedCanonicalValue::Object(entries));
        }
        loop {
            self.skip_whitespace();
            if self.peek() != Some(b'"') {
                return Err(self.invalid("expected a string object key"));
            }
            let key_offset = self.offset;
            let key = self.parse_string()?;
            if !raw_keys.insert(key.clone()) {
                return Err(Tcv1Error::DuplicateObjectKey {
                    key,
                    offset: key_offset,
                });
            }
            let normalized = normalize(&key);
            if let Some(first) = normalized_keys.insert(normalized, key.clone()) {
                return Err(Tcv1Error::NfcKeyCollision {
                    first,
                    second: key,
                    offset: key_offset,
                });
            }
            self.skip_whitespace();
            self.expect(b':', "expected `:` after object key")?;
            let value = self.parse_value(depth + 1)?;
            entries.push((key, value));
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.offset += 1,
                Some(b'}') => {
                    self.offset += 1;
                    return Ok(TypedCanonicalValue::Object(entries));
                }
                Some(_) => return Err(self.invalid("expected `,` or `}` in object")),
                None => return Err(self.invalid("unterminated object")),
            }
        }
    }

    fn parse_number(&mut self) -> Result<TypedCanonicalValue, Tcv1Error> {
        let start = self.offset;
        let negative = self.consume_if(b'-');

        match self.peek() {
            Some(b'0') => {
                self.offset += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return Err(self.invalid("leading zero in JSON number"));
                }
            }
            Some(b'1'..=b'9') => {
                self.offset += 1;
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.offset += 1;
                }
            }
            _ => return Err(self.invalid("expected integer digits")),
        }

        let mut binary64 = false;
        if self.consume_if(b'.') {
            binary64 = true;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.invalid("expected digit after decimal point"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            binary64 = true;
            self.offset += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.invalid("expected exponent digits"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
        }

        let token = &self.input[start..self.offset];
        if binary64 {
            let value = token
                .parse::<f64>()
                .map_err(|_| Tcv1Error::Binary64OutOfRange { offset: start })?;
            if !value.is_finite() {
                return Err(Tcv1Error::Binary64OutOfRange { offset: start });
            }
            Ok(TypedCanonicalValue::Binary64(value))
        } else if negative {
            token
                .parse::<i64>()
                .map(|value| TypedCanonicalValue::Integer(CanonicalInteger::Signed(value)))
                .map_err(|_| Tcv1Error::IntegerOutOfRange {
                    offset: start,
                    domain: "i64",
                })
        } else {
            token
                .parse::<u64>()
                .map(|value| TypedCanonicalValue::Integer(CanonicalInteger::Unsigned(value)))
                .map_err(|_| Tcv1Error::IntegerOutOfRange {
                    offset: start,
                    domain: "u64",
                })
        }
    }

    fn parse_string(&mut self) -> Result<String, Tcv1Error> {
        debug_assert_eq!(self.peek(), Some(b'"'));
        self.offset += 1;
        let mut output = String::new();
        let mut chunk_start = self.offset;
        loop {
            match self.peek() {
                Some(b'"') => {
                    output.push_str(&self.input[chunk_start..self.offset]);
                    self.offset += 1;
                    return Ok(output);
                }
                Some(b'\\') => {
                    output.push_str(&self.input[chunk_start..self.offset]);
                    self.offset += 1;
                    self.parse_escape(&mut output)?;
                    chunk_start = self.offset;
                }
                Some(0x00..=0x1f) => {
                    return Err(self.invalid("unescaped control character in JSON string"));
                }
                Some(byte) if byte.is_ascii() => self.offset += 1,
                Some(_) => {
                    let character = self.input[self.offset..]
                        .chars()
                        .next()
                        .expect("offset is on a valid UTF-8 boundary");
                    self.offset += character.len_utf8();
                }
                None => return Err(self.invalid("unterminated JSON string")),
            }
        }
    }

    fn parse_escape(&mut self, output: &mut String) -> Result<(), Tcv1Error> {
        match self.peek() {
            Some(b'"') => output.push('"'),
            Some(b'\\') => output.push('\\'),
            Some(b'/') => output.push('/'),
            Some(b'b') => output.push('\u{0008}'),
            Some(b'f') => output.push('\u{000c}'),
            Some(b'n') => output.push('\n'),
            Some(b'r') => output.push('\r'),
            Some(b't') => output.push('\t'),
            Some(b'u') => {
                self.offset += 1;
                return self.parse_unicode_escape(output);
            }
            Some(_) => return Err(self.invalid("invalid JSON string escape")),
            None => return Err(self.invalid("unterminated JSON string escape")),
        }
        self.offset += 1;
        Ok(())
    }

    fn parse_unicode_escape(&mut self, output: &mut String) -> Result<(), Tcv1Error> {
        let first_offset = self.offset;
        let first = self.parse_hex_quad()?;
        let scalar = if (0xd800..=0xdbff).contains(&first) {
            if self.peek() != Some(b'\\') || self.bytes.get(self.offset + 1) != Some(&b'u') {
                return Err(Tcv1Error::InvalidJson {
                    offset: first_offset,
                    message: "high surrogate is not followed by a low surrogate",
                });
            }
            self.offset += 2;
            let low_offset = self.offset;
            let low = self.parse_hex_quad()?;
            if !(0xdc00..=0xdfff).contains(&low) {
                return Err(Tcv1Error::InvalidJson {
                    offset: low_offset,
                    message: "high surrogate is not followed by a low surrogate",
                });
            }
            0x10000 + ((u32::from(first) - 0xd800) << 10) + (u32::from(low) - 0xdc00)
        } else if (0xdc00..=0xdfff).contains(&first) {
            return Err(Tcv1Error::InvalidJson {
                offset: first_offset,
                message: "isolated low surrogate in JSON string",
            });
        } else {
            u32::from(first)
        };
        output.push(char::from_u32(scalar).expect("validated Unicode scalar value"));
        Ok(())
    }

    fn parse_hex_quad(&mut self) -> Result<u16, Tcv1Error> {
        if self.offset + 4 > self.bytes.len() {
            return Err(self.invalid("incomplete Unicode escape"));
        }
        let mut value = 0_u16;
        for _ in 0..4 {
            let digit = match self.peek() {
                Some(b'0'..=b'9') => u16::from(self.bytes[self.offset] - b'0'),
                Some(b'a'..=b'f') => u16::from(self.bytes[self.offset] - b'a' + 10),
                Some(b'A'..=b'F') => u16::from(self.bytes[self.offset] - b'A' + 10),
                _ => return Err(self.invalid("invalid hexadecimal digit in Unicode escape")),
            };
            value = (value << 4) | digit;
            self.offset += 1;
        }
        Ok(value)
    }

    fn consume_literal(&mut self, literal: &[u8]) -> Result<(), Tcv1Error> {
        if self.bytes.get(self.offset..self.offset + literal.len()) == Some(literal) {
            self.offset += literal.len();
            Ok(())
        } else {
            Err(self.invalid("invalid JSON literal"))
        }
    }

    fn expect(&mut self, expected: u8, message: &'static str) -> Result<(), Tcv1Error> {
        if self.consume_if(expected) {
            Ok(())
        } else {
            Err(self.invalid(message))
        }
    }

    fn consume_if(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.offset += 1;
            true
        } else {
            false
        }
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.offset += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }

    fn invalid(&self, message: &'static str) -> Tcv1Error {
        Tcv1Error::InvalidJson {
            offset: self.offset,
            message,
        }
    }
}

/// Require external JSON to use the same object/array container kinds as its
/// typed serde representation, without requiring byte-canonical field presence
/// or ordering. This closes serde's internal positional-sequence representation
/// for structs while preserving defaults, skipped fields and BTree ordering.
fn validate_external_container_shapes(
    raw: &serde_json::Value,
    typed: &serde_json::Value,
    path: &str,
) -> std::result::Result<(), String> {
    match (raw, typed) {
        (serde_json::Value::Object(raw), serde_json::Value::Object(typed)) => {
            for (key, raw_value) in raw {
                if let Some(typed_value) = typed.get(key) {
                    validate_external_container_shapes(
                        raw_value,
                        typed_value,
                        &format!("{path}.{key}"),
                    )?;
                }
            }
            Ok(())
        }
        (serde_json::Value::Array(raw), serde_json::Value::Array(typed)) => {
            for (index, (raw_value, typed_value)) in raw.iter().zip(typed).enumerate() {
                validate_external_container_shapes(
                    raw_value,
                    typed_value,
                    &format!("{path}[{index}]"),
                )?;
            }
            Ok(())
        }
        (_, serde_json::Value::Object(_)) => Err(format!(
            "{path} must use a JSON object at the external contract boundary"
        )),
        (_, serde_json::Value::Array(_)) => Err(format!(
            "{path} must use a JSON array at the external contract boundary"
        )),
        (serde_json::Value::Object(_) | serde_json::Value::Array(_), _) => Err(format!(
            "{path} has the wrong JSON container kind at the external contract boundary"
        )),
        _ => Ok(()),
    }
}

/// Deserialize one public JSON contract while rejecting serde's positional
/// sequence representation for structs. Semantic validation remains the owning
/// type's responsibility after this shape-preserving decode.
pub fn deserialize_external_contract<T, F>(
    json: &str,
    label: &str,
    shape_error: F,
) -> DagMlResult<T>
where
    T: DeserializeOwned + Serialize,
    F: Fn(String) -> DagMlError,
{
    parse_typed_json(json).map_err(|error| {
        shape_error(format!(
            "{label} is not a strict TCV1 JSON document: {error}"
        ))
    })?;
    let raw: serde_json::Value = serde_json::from_str(json)?;
    deserialize_external_value(raw, label, shape_error)
}

/// Deserialize a public contract that has already crossed a structured host
/// boundary (for example a Python mapping), while preserving the same
/// object/array rules as [`deserialize_external_contract`].
pub fn deserialize_external_value<T, F>(
    raw: serde_json::Value,
    label: &str,
    shape_error: F,
) -> DagMlResult<T>
where
    T: DeserializeOwned + Serialize,
    F: Fn(String) -> DagMlError,
{
    validate_typed_serde_value(&raw).map_err(|error| {
        shape_error(format!(
            "{label} is not a strict TCV1 structured value: {error}"
        ))
    })?;
    let value: T = serde_json::from_value(raw.clone())?;
    let typed = serde_json::to_value(&value)?;
    validate_external_container_shapes(&raw, &typed, label).map_err(shape_error)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn parse(input: &str) -> TypedCanonicalValue {
        parse_typed_json(input).expect("valid strict JSON")
    }

    #[test]
    fn serde_json_preserves_the_tcv1_binary64_round_trip() {
        // This boundary decimal used to alternate between adjacent f64 values
        // when serde_json's fast parser was enabled. TCV1 fingerprints the
        // binary64 token, so the exact round-trip parser is a contract
        // requirement, not merely a formatting preference.
        let raw = "4.6222270443732795e-16";
        let first: f64 = serde_json::from_str(raw).unwrap();
        let encoded = serde_json::to_string(&first).unwrap();
        let second: f64 = serde_json::from_str(&encoded).unwrap();
        assert_eq!(first.to_bits(), second.to_bits());
        assert_eq!(parse(raw), parse(&encoded));
    }

    fn hex(bytes: &[u8]) -> String {
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            write!(&mut output, "{byte:02x}").unwrap();
        }
        output
    }

    fn assert_vector(input: &str, expected_preimage: &str, expected_sha256: &str) {
        let value = parse(input);
        assert_eq!(hex(&tcv1_preimage(&value).unwrap()), expected_preimage);
        assert_eq!(tcv1_sha256(&value).unwrap(), expected_sha256);
    }

    #[test]
    fn golden_map_order_preimage_and_digest() {
        const PREIMAGE: &str = "4441474d4c2d54435631004f000000000000000253000000000000000161490000000000000001325300000000000000017a49000000000000000131";
        const DIGEST: &str = "5441a8df23725b4a60e16316f3034a7ec8b25b853ce75600fa71dda19c8a16e1";
        assert_vector(r#"{"z":1,"a":2}"#, PREIMAGE, DIGEST);
        assert_vector(r#"{"a":2,"z":1}"#, PREIMAGE, DIGEST);
    }

    #[test]
    fn object_order_uses_normalized_utf8_not_utf16() {
        assert_vector(
            r#"{"\ue000":1,"\ud800\udc00":2}"#,
            "4441474d4c2d54435631004f0000000000000002530000000000000003ee808049000000000000000131530000000000000004f090808049000000000000000132",
            "7c212789a6d362b8a34e8c271d5fe003c2026a828712eef6469610eedda79bc7",
        );
    }

    #[test]
    fn nfc_normalizes_strings_and_keys() {
        let decomposed = parse(r#""e\u0301""#);
        let composed = parse(r#""é""#);
        // PartialEq deliberately retains source representation; TCV1 bytes are
        // the canonical equivalence relation.
        assert_ne!(decomposed, composed);
        assert_eq!(
            tcv1_preimage(&decomposed).unwrap(),
            tcv1_preimage(&composed).unwrap()
        );
        assert_eq!(
            tcv1_sha256(&decomposed).unwrap(),
            "a4af538cebb2c18fed88a1ad4245509500d201e68802a217e4e8500ef61c0e86"
        );

        let error = parse_typed_json(r#"{"é":1,"e\u0301":2}"#).unwrap_err();
        assert!(matches!(error, Tcv1Error::NfcKeyCollision { .. }));
    }

    #[test]
    fn signed_zero_normalizes_only_within_binary64_kind() {
        let negative = parse("-0.0");
        let positive = parse("0.0");
        assert_eq!(
            tcv1_preimage(&negative).unwrap(),
            tcv1_preimage(&positive).unwrap()
        );
        assert_vector(
            "-0.0",
            "4441474d4c2d5443563100440000000000000000",
            "c01f83d2f6a8e96eb7f50c4794eef0dbae68ad4d20ed116af013ae5cd4ffa49d",
        );
        assert_ne!(
            tcv1_preimage(&parse("-0")).unwrap(),
            tcv1_preimage(&negative).unwrap()
        );
        assert_eq!(
            tcv1_preimage(&parse("-0")).unwrap(),
            tcv1_preimage(&parse("0")).unwrap()
        );
    }

    #[test]
    fn integer_and_binary64_tokens_remain_distinct() {
        assert_eq!(
            parse("2"),
            TypedCanonicalValue::Integer(CanonicalInteger::Unsigned(2))
        );
        assert_eq!(parse("2.0"), TypedCanonicalValue::Binary64(2.0));
        assert_ne!(
            tcv1_preimage(&parse("2")).unwrap(),
            tcv1_preimage(&parse("2.0")).unwrap()
        );
        assert_vector(
            "2",
            "4441474d4c2d544356310049000000000000000132",
            "3940883272509c80c7bbff602794dce0f62dfa7850bc3041b37c56d36bc94701",
        );
        let float_preimage = tcv1_preimage(&parse("2.0")).unwrap();
        assert_eq!(float_preimage, tcv1_preimage(&parse("2e0")).unwrap());
        assert_eq!(
            hex(&float_preimage),
            "4441474d4c2d5443563100444000000000000000"
        );
    }

    #[test]
    fn frozen_binary64_boundary_vectors() {
        let vectors = [
            (
                "5e-324",
                "4441474d4c2d5443563100440000000000000001",
                "88a7b6becacc6cf0bf2473332aa17d9f3ed513b4024d69684458a275b5c39c24",
            ),
            (
                "2.2250738585072009e-308",
                "4441474d4c2d544356310044000fffffffffffff",
                "78c8b93679333797971ff7ef4dba4b284adb03da7a7379bf814f635b69164765",
            ),
            (
                "2.2250738585072014e-308",
                "4441474d4c2d5443563100440010000000000000",
                "6ea1aeba7ec435fd15165511f602295eedd7de82832713f35891600a0f552702",
            ),
            (
                "9007199254740992.0",
                "4441474d4c2d5443563100444340000000000000",
                "8e276db087fa6f18be879c6e32a034e44ff075c66c76ff8e43cbd3dc20e0673a",
            ),
            (
                "1.7976931348623157e308",
                "4441474d4c2d5443563100447fefffffffffffff",
                "e9231aadbc74db0fd07f62e1b04c67ab93a73c30b756e85e36f80edd3766bf5a",
            ),
        ];
        for (input, preimage, digest) in vectors {
            assert_vector(input, preimage, digest);
        }
        assert_eq!(
            tcv1_preimage(&parse("5e-324")).unwrap(),
            tcv1_preimage(&parse("4.9406564584124654e-324")).unwrap()
        );
        assert_eq!(
            tcv1_preimage(&parse("9007199254740992.0")).unwrap(),
            tcv1_preimage(&parse("9.007199254740992e15")).unwrap()
        );
    }

    #[test]
    fn all_tags_and_big_endian_lengths_are_explicit() {
        let value = parse(r#"[null,false,true,"x",-1,1.5]"#);
        assert_eq!(
            hex(&tcv1_encode(&value).unwrap()),
            "4100000000000000064e4654530000000000000001784900000000000000022d31443ff8000000000000"
        );
        assert_vector(
            "[]",
            "4441474d4c2d5443563100410000000000000000",
            "cea5f239e81001721b763cebf40cd71bca04972c51313fba335e0a96d7e81979",
        );
        assert_vector(
            "{}",
            "4441474d4c2d54435631004f0000000000000000",
            "05fb75f2c266555e97a65becbafc84f8dc52b9f4cb2da8f7b7c5bfc8073325f2",
        );
    }

    #[test]
    fn integer_bounds_are_lexical_and_exact() {
        assert_eq!(
            parse("-9223372036854775808"),
            TypedCanonicalValue::Integer(CanonicalInteger::Signed(i64::MIN))
        );
        assert_eq!(
            parse("18446744073709551615"),
            TypedCanonicalValue::Integer(CanonicalInteger::Unsigned(u64::MAX))
        );
        assert!(matches!(
            parse_typed_json("-9223372036854775809"),
            Err(Tcv1Error::IntegerOutOfRange { domain: "i64", .. })
        ));
        assert!(matches!(
            parse_typed_json("18446744073709551616"),
            Err(Tcv1Error::IntegerOutOfRange { domain: "u64", .. })
        ));
    }

    #[test]
    fn strict_parser_rejects_invalid_documents() {
        assert!(matches!(
            parse_typed_json(r#"{"a":1,"a":2}"#),
            Err(Tcv1Error::DuplicateObjectKey { .. })
        ));
        assert!(matches!(
            parse_typed_json(r#"{"a":1,"\u0061":2}"#),
            Err(Tcv1Error::DuplicateObjectKey { .. })
        ));
        for document in [r#""\ud800""#, r#""\udc00""#, r#""\ud800\u0061""#] {
            assert!(matches!(
                parse_typed_json(document),
                Err(Tcv1Error::InvalidJson { .. })
            ));
        }
        assert!(matches!(
            parse_typed_json("1e400"),
            Err(Tcv1Error::Binary64OutOfRange { .. })
        ));
        assert!(matches!(
            parse_typed_json_bytes(&[b'"', 0xff, b'"']),
            Err(Tcv1Error::InvalidUtf8 { .. })
        ));
        for document in ["null true", "01", "1.", "1e", "[1,]", r#"{"a":1,}"#] {
            assert!(parse_typed_json(document).is_err(), "accepted {document:?}");
        }
    }

    #[test]
    fn programmatic_values_receive_the_same_safety_checks() {
        assert_eq!(
            tcv1_encode(&TypedCanonicalValue::Binary64(f64::INFINITY)),
            Err(Tcv1Error::NonFiniteBinary64)
        );
        assert_eq!(
            tcv1_encode(&TypedCanonicalValue::Binary64(f64::NAN)),
            Err(Tcv1Error::NonFiniteBinary64)
        );
        let collision = TypedCanonicalValue::Object(vec![
            ("é".to_string(), TypedCanonicalValue::Null),
            ("e\u{301}".to_string(), TypedCanonicalValue::Null),
        ]);
        assert!(matches!(
            tcv1_encode(&collision),
            Err(Tcv1Error::NfcKeyCollision { .. })
        ));
        let mut structured_collision = serde_json::Map::new();
        structured_collision.insert("é".to_string(), serde_json::Value::Null);
        structured_collision.insert("e\u{301}".to_string(), serde_json::Value::Null);
        assert!(matches!(
            validate_typed_serde_value(&serde_json::Value::Object(structured_collision)),
            Err(Tcv1Error::NfcKeyCollision { .. })
        ));
    }

    #[test]
    fn self_fingerprint_omits_exactly_one_normalized_key() {
        let with_fingerprint = parse(r#"{"payload":2,"fingerprint":"pending"}"#);
        let payload_only = parse(r#"{"payload":2}"#);
        assert_eq!(
            with_fingerprint.fingerprint_without("fingerprint").unwrap(),
            payload_only.fingerprint().unwrap()
        );
        assert!(matches!(
            payload_only.fingerprint_without("fingerprint"),
            Err(Tcv1Error::MissingObjectKey(_))
        ));
        assert!(matches!(
            parse("[]").fingerprint_without("fingerprint"),
            Err(Tcv1Error::ExpectedObject)
        ));

        let decomposed_key = parse(r#"{"empreinte\u0301":"pending","payload":2}"#);
        assert_eq!(
            decomposed_key.fingerprint_without("empreinté").unwrap(),
            payload_only.fingerprint().unwrap()
        );
        let ambiguous = TypedCanonicalValue::Object(vec![
            ("é".to_string(), TypedCanonicalValue::Null),
            ("e\u{301}".to_string(), TypedCanonicalValue::Null),
        ]);
        assert!(matches!(
            ambiguous.fingerprint_without("é"),
            Err(Tcv1Error::AmbiguousObjectKey(_))
        ));
    }

    #[test]
    fn parser_and_encoder_enforce_the_nesting_limit() {
        let accepted = format!(
            "{}0{}",
            "[".repeat(MAX_NESTING_DEPTH),
            "]".repeat(MAX_NESTING_DEPTH)
        );
        let accepted = parse_typed_json(&accepted).expect("boundary depth is accepted");
        tcv1_encode(&accepted).expect("encoder accepts the same boundary depth");

        let rejected = format!(
            "{}0{}",
            "[".repeat(MAX_NESTING_DEPTH + 1),
            "]".repeat(MAX_NESTING_DEPTH + 1)
        );
        assert_eq!(parse_typed_json(&rejected), Err(Tcv1Error::NestingTooDeep));

        let mut programmatic = TypedCanonicalValue::Null;
        for _ in 0..=MAX_NESTING_DEPTH {
            programmatic = TypedCanonicalValue::Array(vec![programmatic]);
        }
        assert_eq!(tcv1_encode(&programmatic), Err(Tcv1Error::NestingTooDeep));

        let accepted_objects = format!(
            "{}0{}",
            r#"{"a":"#.repeat(MAX_NESTING_DEPTH),
            "}".repeat(MAX_NESTING_DEPTH)
        );
        let accepted_objects =
            parse_typed_json(&accepted_objects).expect("object boundary depth is accepted");
        tcv1_encode(&accepted_objects).expect("encoder accepts object boundary depth");

        let rejected_objects = format!(
            "{}0{}",
            r#"{"a":"#.repeat(MAX_NESTING_DEPTH + 1),
            "}".repeat(MAX_NESTING_DEPTH + 1)
        );
        assert_eq!(
            parse_typed_json(&rejected_objects),
            Err(Tcv1Error::NestingTooDeep)
        );
    }

    #[test]
    fn historical_stable_json_fingerprint_does_not_drift() {
        let value = json!({"a": 2, "z": [true, null]});
        assert_eq!(
            crate::campaign::stable_json_fingerprint(&value).unwrap(),
            "b4f8d6fce8a1198ebca7d0206f8c229dfe7a0c663929b0df2d72053d3d34624a"
        );
    }
}
