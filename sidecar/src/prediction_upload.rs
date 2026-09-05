//! Bounded HTTP form transport, never a numerical file parser.

use serde_json::{json, Map, Value};
use std::io::Write;

pub struct PredictionUpload {
    pub(crate) fields: Value,
    pub(crate) file: tempfile::NamedTempFile,
}

pub fn boundary(content_type: &str) -> Result<String, String> {
    let mut parts = content_type.split(';');
    if !parts
        .next()
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("multipart/form-data"))
    {
        return Err("Expected multipart/form-data".into());
    }
    let mut boundary = None;
    for part in parts {
        let (key, value) = part
            .trim()
            .split_once('=')
            .ok_or("Malformed multipart content type")?;
        if key != "boundary" || boundary.is_some() {
            return Err("Unexpected or duplicate multipart parameter".into());
        }
        let value = value.trim();
        let value = if value.starts_with('"') {
            value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
                .ok_or("Unclosed multipart boundary quote")?
        } else {
            value
        };
        if value.is_empty()
            || value.len() > 70
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"'()+_,-./:=?".contains(&byte))
        {
            return Err("Invalid multipart boundary".into());
        }
        boundary = Some(value.to_owned());
    }
    boundary.ok_or_else(|| "Missing multipart boundary".into())
}

fn disposition(value: &str) -> Result<(String, Option<String>), String> {
    let mut fields = parameter_fields(value)?.into_iter();
    if fields.next() != Some("form-data") {
        return Err("Invalid form disposition".into());
    }
    let mut name = None;
    let mut filename = None;
    for field in fields {
        let (key, value) = field
            .trim()
            .split_once('=')
            .ok_or("Invalid form attribute")?;
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .ok_or("Form attributes must be quoted")?;
        if value.contains(['"', '\r', '\n', '\0']) {
            return Err("Invalid form attribute value".into());
        }
        match key {
            "name" if name.is_none() => name = Some(value.to_owned()),
            "filename" if filename.is_none() => filename = Some(value.to_owned()),
            _ => return Err("Unexpected or duplicate form attribute".into()),
        }
    }
    Ok((name.ok_or("Form field has no name")?, filename))
}

fn parameter_fields(value: &str) -> Result<Vec<&str>, String> {
    let mut quoted = false;
    let mut start = 0;
    let mut fields = Vec::new();
    for (index, character) in value.char_indices() {
        if character == '"' {
            quoted = !quoted;
        }
        if character == ';' && !quoted {
            fields.push(&value[start..index]);
            start = index + 1;
        }
    }
    if quoted {
        return Err("Unclosed form attribute quote".into());
    }
    fields.push(&value[start..]);
    Ok(fields)
}

fn part_headers(headers: &[u8]) -> Result<(String, Option<String>), String> {
    let headers = std::str::from_utf8(headers).map_err(|_| "Invalid upload headers")?;
    let mut form = None;
    let mut content_type_seen = false;
    for header in headers.split("\r\n") {
        let (key, value) = header.split_once(':').ok_or("Malformed upload header")?;
        match key.to_ascii_lowercase().as_str() {
            "content-disposition" if form.is_none() => form = Some(disposition(value.trim())?),
            "content-type" if !content_type_seen => content_type_seen = true,
            _ => return Err("Unexpected or duplicate upload header".into()),
        }
    }
    form.ok_or_else(|| "Missing upload disposition".into())
}

fn temporary_upload(suffix: &str, payload: &[u8]) -> Result<tempfile::NamedTempFile, String> {
    let mut upload = tempfile::Builder::new()
        .prefix("studio-predict-")
        .suffix(suffix)
        .tempfile()
        .map_err(|error| error.to_string())?;
    upload
        .write_all(payload)
        .map_err(|error| error.to_string())?;
    upload.flush().map_err(|error| error.to_string())?;
    Ok(upload)
}

pub fn parse(content_type: &str, body: &[u8]) -> Result<PredictionUpload, String> {
    if body.len() > crate::matrix_limits::MAX_PREDICTION_BODY_BYTES {
        return Err("Upload exceeds 32 MiB".into());
    }
    let boundary = boundary(content_type)?;
    let first = format!("--{boundary}\r\n");
    let delimiter = format!("\r\n--{boundary}");
    let mut remaining = body
        .strip_prefix(first.as_bytes())
        .ok_or("Missing multipart opening boundary")?;
    let mut values = Map::new();
    let mut file = None;
    let mut parts = 0;
    loop {
        parts += 1;
        if parts > 8 {
            return Err("Too many upload fields".into());
        }
        let header_end = remaining
            .windows(4)
            .position(|bytes| bytes == b"\r\n\r\n")
            .filter(|offset| *offset <= 8192)
            .ok_or("Missing or excessive upload headers")?;
        let (name, filename) = part_headers(&remaining[..header_end])?;
        remaining = &remaining[header_end + 4..];
        let end = remaining
            .windows(delimiter.len())
            .enumerate()
            .find_map(|(index, bytes)| {
                let after = &remaining[index + delimiter.len()..];
                (bytes == delimiter.as_bytes()
                    && (after.starts_with(b"--") || after.starts_with(b"\r\n")))
                .then_some(index)
            })
            .ok_or("Missing multipart closing boundary")?;
        let payload = &remaining[..end];
        if name == "file" {
            if file.is_some() || payload.is_empty() {
                return Err("Exactly one nonempty upload is required".into());
            }
            let filename = filename
                .ok_or("Upload filename is required")?
                .to_lowercase();
            if filename.contains(['/', '\\']) {
                return Err("Upload filename must not contain a path".into());
            }
            let suffix = [
                ".csv.gz", ".csv.zip", ".csv", ".tsv", ".txt", ".parquet", ".pq", ".xlsx", ".xls",
                ".mat", ".npy", ".npz",
            ]
            .into_iter()
            .find(|suffix| filename.ends_with(suffix))
            .ok_or("Unsupported prediction upload format")?;
            file = Some(temporary_upload(suffix, payload)?);
        } else {
            if filename.is_some() || payload.len() > 8192 || values.contains_key(&name) {
                return Err("Invalid or duplicate upload field".into());
            }
            if ![
                "model_id",
                "model_source",
                "engine",
                "allow_fallback",
                "archive_fingerprint",
                "output_index",
                "has_header",
            ]
            .contains(&name.as_str())
            {
                return Err("Unexpected upload field".into());
            }
            let text = std::str::from_utf8(payload).map_err(|_| "Invalid upload field encoding")?;
            let value = match name.as_str() {
                "allow_fallback" | "has_header" => match text {
                    "false" => json!(false),
                    "true" => json!(true),
                    _ => return Err(format!("Invalid {name}: expected true or false")),
                },
                "output_index" => json!(text.parse::<u32>().map_err(|_| "Invalid output_index")?),
                _ => json!(text),
            };
            values.insert(name, value);
        }
        remaining = &remaining[end + delimiter.len()..];
        if let Some(end) = remaining.strip_prefix(b"--") {
            if !end.is_empty() && end != b"\r\n" {
                return Err("Unexpected multipart epilogue".into());
            }
            break;
        }
        remaining = remaining
            .strip_prefix(b"\r\n")
            .ok_or("Malformed multipart boundary suffix")?;
    }
    Ok(PredictionUpload {
        fields: Value::Object(values),
        file: file.ok_or("Prediction upload is missing")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn header_override_is_a_strict_optional_boolean() {
        for (value, accepted) in [
            ("true", true),
            ("false", true),
            ("auto", false),
            ("1", false),
        ] {
            let body = format!("--a\r\nContent-Disposition: form-data; name=\"has_header\"\r\n\r\n{value}\r\n--a\r\nContent-Disposition: form-data; name=\"file\"; filename=\"spectra.csv\"\r\n\r\n1,2\r\n--a--\r\n");
            let result = parse("multipart/form-data; boundary=a", body.as_bytes());
            assert_eq!(result.is_ok(), accepted);
            if let Ok(upload) = result {
                assert_eq!(upload.fields["has_header"], value == "true");
            }
        }
    }
    #[test]
    fn binary_payload_is_preserved_and_temporary_file_has_bounded_lifetime() {
        let mut body=b"--a\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nchain1\r\n--a\r\nContent-Disposition: form-data; name=\"file\"; filename=\"spectra.npy\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec();
        body.extend_from_slice(b"\0\xff\xfe123\r\n--a--\r\n");
        let upload = parse("multipart/form-data; boundary=a", &body).unwrap();
        assert_eq!(upload.fields["model_id"], "chain1");
        let path = upload.file.path().to_owned();
        assert_eq!(std::fs::read(&path).unwrap(), b"\0\xff\xfe123");
        drop(upload);
        assert!(!path.exists());
        assert!(parse("multipart/form-data; boundary=a", &body[..body.len() - 5]).is_err());
    }
    #[test]
    fn refuses_ambiguous_headers_boundaries_and_duplicate_files() {
        assert!(boundary("text/plain; boundary=a").is_err());
        assert!(boundary("multipart/form-data; boundary=a; boundary=b").is_err());
        assert!(boundary("multipart/form-data; boundary=a\r\nx").is_err());
        assert!(boundary("multipart/form-data; boundary=\"a").is_err());
        assert_eq!(
            disposition("form-data; name=\"file\"; filename=\"spectra; copy.csv\"")
                .unwrap()
                .1
                .as_deref(),
            Some("spectra; copy.csv")
        );
        let part = "Content-Disposition: form-data; name=\"file\"; filename=\"a.csv\"\r\n\r\na";
        assert!(parse(
            "multipart/form-data; boundary=b",
            format!("--b\r\n{part}\r\n--b\r\n{part}\r\n--b--\r\n").as_bytes()
        )
        .is_err());
    }
}
