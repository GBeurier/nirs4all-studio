//! Independent bounded wire validation. Numerical hydration remains Methods-owned.
use std::collections::BTreeMap;

use serde_json::Value;

use crate::{DagMlError, Result};

fn invalid<T>() -> Result<T> {
    Err(DagMlError::RuntimeValidation("classifier learned state differs from its signed recipe, class order or bounded wire format".into()))
}

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| DagMlError::RuntimeValidation("truncated classifier state".into()))?;
        let value = &self.bytes[self.position..end];
        self.position = end;
        Ok(value)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("four bytes"),
        ))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("eight bytes"),
        ))
    }
    fn i64(&mut self) -> Result<i64> {
        Ok(self.u64()? as i64)
    }
    fn f64(&mut self) -> Result<f64> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() {
            return invalid();
        }
        Ok(value)
    }
    fn block(&mut self) -> Result<&'a [u8]> {
        let count = self.u64()?;
        if count > 67_108_864 {
            return invalid();
        }
        self.take(count as usize)
    }
    fn string(&mut self) -> Result<String> {
        let bytes = self.block()?;
        if bytes.len() > 1_048_576 {
            return invalid();
        }
        String::from_utf8(bytes.to_vec())
            .map_err(|_| DagMlError::RuntimeValidation("classifier state text is not UTF-8".into()))
    }
    fn short_string(&mut self) -> Result<String> {
        let count = self.u32()?;
        if count > 4096 {
            return invalid();
        }
        String::from_utf8(self.take(count as usize)?.to_vec())
            .map_err(|_| DagMlError::RuntimeValidation("estimator state text is not UTF-8".into()))
    }
    fn end(&self) -> Result<()> {
        if self.position == self.bytes.len() {
            Ok(())
        } else {
            invalid()
        }
    }
}

fn checksum<'a>(bytes: &'a [u8], magic: &[u8]) -> Result<&'a [u8]> {
    if bytes.len() < 28 || bytes.len() > 67_108_864 || !bytes.starts_with(magic) {
        return invalid();
    }
    let body = &bytes[..bytes.len() - 8];
    let hash = body.iter().fold(0xcbf29ce484222325_u64, |value, byte| {
        (value ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    if hash != u64::from_le_bytes(bytes[bytes.len() - 8..].try_into().expect("checksum bytes")) {
        return invalid();
    }
    Ok(body)
}

struct EstimatorState<'a> {
    params: BTreeMap<String, (u32, u64)>,
    capabilities: u64,
    width: u64,
    outputs: u64,
    blocks: BTreeMap<u32, &'a [u8]>,
}
fn estimator<'a>(bytes: &'a [u8], method: &str) -> Result<EstimatorState<'a>> {
    let mut input = Reader::new(checksum(bytes, b"N4ME")?);
    input.take(4)?;
    if input.u32()? != 1
        || [input.u32()?, input.u32()?, input.u32()?] != [2, 17, 0]
        || input.short_string()? != method
    {
        return invalid();
    }
    let count = input.u32()?;
    if count > 256 {
        return invalid();
    }
    let mut params = BTreeMap::new();
    for _ in 0..count {
        let name = input.short_string()?;
        let kind = input.u32()?;
        if input.u64()? != 1
            || !matches!(kind, 1..=4)
            || params.insert(name, (kind, input.u64()?)).is_some()
        {
            return invalid();
        }
    }
    let capabilities = input.u64()?;
    let width = input.u64()?;
    let outputs = input.u64()?;
    if width == 0 || width > 1_048_576 || outputs > 1_048_576 || capabilities & 512 != 0 {
        return invalid();
    }
    let count = input.u32()?;
    if count == 0 || count > 256 {
        return invalid();
    }
    let mut blocks = BTreeMap::new();
    for _ in 0..count {
        let tag = input.u32()?;
        if blocks.insert(tag, input.block()?).is_some() {
            return invalid();
        }
    }
    input.end()?;
    Ok(EstimatorState {
        params,
        capabilities,
        width,
        outputs,
        blocks,
    })
}

fn validate_latent_model(bytes: &[u8], width: u64, components: u64, classes: u64) -> Result<()> {
    let mut input = Reader::new(checksum(bytes, b"N4MM")?);
    input.take(4)?;
    if input.u32()? != 1
        || [input.u32()?, input.u32()?, input.u32()?] != [2, 17, 0]
        || [input.u32()?, input.u32()?, input.u32()?] != [0, 1, 0]
    {
        return invalid();
    }
    let samples = input.u64()?;
    if samples <= components
        || input.u64()? != width
        || input.u64()? != classes
        || input.u64()? != components
        || [
            input.u32()?,
            input.u32()?,
            input.u32()?,
            input.u32()?,
            input.u32()?,
        ] != [1, 0, 1, 0, 0]
        || input.f64()? <= 0.0
        || input.u32()? == 0
    {
        return invalid();
    }
    let product = |left: u64, right: u64| {
        left.checked_mul(right)
            .ok_or_else(|| DagMlError::RuntimeValidation("latent model size overflow".into()))
    };
    for count in [
        width,
        width,
        classes,
        classes,
        product(width, classes)?,
        product(width, components)?,
        product(width, components)?,
        product(classes, components)?,
        product(width, components)?,
        0,
        0,
    ] {
        if input.u64()? != count {
            return invalid();
        }
        for _ in 0..count {
            input.f64()?;
        }
    }
    input.end()
}

pub(crate) fn validate_classifier_n4me(
    bytes: &[u8],
    params: &Value,
    width: usize,
    classes: &[usize],
) -> Result<()> {
    let state = estimator(bytes, crate::METHODS_CLASSIFIER_METHOD)?;
    let components = params["n_components"]
        .as_u64()
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier components missing".into()))?;
    let iterations = params["max_iter"]
        .as_u64()
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier iterations missing".into()))?;
    if state.width != width as u64
        || state.outputs != classes.len() as u64
        || state.capabilities != 156
        || state.params
            != BTreeMap::from([
                ("n_components".into(), (1, components)),
                ("max_iter".into(), (1, iterations)),
            ])
        || state.blocks.len() != 1
    {
        return invalid();
    }
    let mut head =
        Reader::new(state.blocks.get(&0x31534c43).ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier CLS1 block missing".into())
        })?);
    if head.i64()? != width as i64 || head.u64()? != classes.len() as u64 {
        return invalid();
    }
    for id in classes {
        if head.i64()? != *id as i64 {
            return invalid();
        }
    }
    let model_size = head.i64()?;
    if !(28..=67_108_864).contains(&model_size) {
        return invalid();
    }
    let packed_count = head.u64()?;
    if packed_count != (model_size as u64).div_ceil(8) {
        return invalid();
    }
    let packed = head.take(packed_count as usize * 8)?;
    if !packed.starts_with(b"N4MM") || packed[model_size as usize..].iter().any(|byte| *byte != 0) {
        return invalid();
    }
    validate_latent_model(
        &packed[..model_size as usize],
        width as u64,
        components,
        classes.len() as u64,
    )?;
    let tail = classes.len() as u64 - 1;
    for count in [
        tail,
        tail.checked_mul(components).ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier coefficient width overflow".into())
        })?,
    ] {
        if head.u64()? != count {
            return invalid();
        }
        for _ in 0..count {
            head.f64()?;
        }
    }
    head.end()
}

fn validate_encoder(bytes: &[u8], encoder: &Value, input_width: u64) -> Result<u64> {
    let pca = encoder["kind"] == "tensor_pca";
    let method = if pca {
        "preprocessing.feature_selection.flexible_pca"
    } else {
        "preprocessing.scaling.standard_scale"
    };
    let state = estimator(bytes, method)?;
    let expected = if pca {
        BTreeMap::from([(
            "n_components".into(),
            (
                2,
                (encoder["n_components"].as_u64().unwrap_or(0) as f64).to_bits(),
            ),
        )])
    } else {
        BTreeMap::from([("with_mean".into(), (3, 1)), ("with_std".into(), (3, 1))])
    };
    if state.width != input_width
        || state.outputs != 0
        || state.capabilities != 129
        || state.params != expected
        || state.blocks.len() != 1
    {
        return invalid();
    }
    let output = if pca {
        encoder["n_components"].as_u64().unwrap_or(0)
    } else {
        input_width
    };
    let mut learned = Reader::new(state.blocks.get(&0x31545354).ok_or_else(|| {
        DagMlError::RuntimeValidation("classifier encoder TST1 block missing".into())
    })?);
    if learned.i64()? != input_width as i64 {
        return invalid();
    }
    if pca {
        if learned.u64()? != input_width {
            return invalid();
        }
        for _ in 0..input_width {
            learned.f64()?;
        }
        if learned.i64()? != output as i64 || learned.u64()? != input_width * output {
            return invalid();
        }
        for _ in 0..input_width * output {
            learned.f64()?;
        }
    } else {
        if learned.i64()? != 1 || learned.i64()? != 1 {
            return invalid();
        }
        for positive in [false, true] {
            if learned.u64()? != input_width {
                return invalid();
            }
            for _ in 0..input_width {
                if learned.f64()? <= 0.0 && positive {
                    return invalid();
                }
            }
        }
    }
    learned.end()?;
    Ok(output)
}

fn put_string(output: &mut Vec<u8>, text: &str) {
    output.extend((text.len() as u64).to_le_bytes());
    output.extend(text.as_bytes());
}

fn canonical_recipe(recipe: &Value, schemas: &Value) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    put_string(&mut output, crate::METHODS_CLASSIFIER_METHOD);
    for name in ["n_components", "max_iter"] {
        output.extend(
            recipe["model"]["params"][name]
                .as_u64()
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("classifier parameters missing".into())
                })?
                .to_le_bytes(),
        );
    }
    let order = recipe["source_order"]
        .as_array()
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier source order missing".into()))?;
    output.extend((order.len() as u32).to_le_bytes());
    for value in order {
        let name = value.as_str().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier source name missing".into())
        })?;
        let schema = &schemas[name];
        let encoder = &recipe["encoders"][name];
        for text in [
            name,
            schema["representation_id"].as_str().unwrap_or(""),
            schema["dtype"].as_str().unwrap_or(""),
            schema["identity"].as_str().unwrap_or(""),
        ] {
            put_string(&mut output, text);
        }
        let shape = schema["input_shape"].as_array().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier source shape missing".into())
        })?;
        output.extend((shape.len() as u32).to_le_bytes());
        for dimension in shape {
            output.extend(dimension.as_u64().unwrap_or(0).to_le_bytes());
        }
        let kind = match encoder["kind"].as_str() {
            Some("standard_scaler") => 1_u32,
            Some("tensor_pca") => 2,
            Some("column_transformer") => 3,
            _ => return invalid(),
        };
        output.extend(kind.to_le_bytes());
        output.extend(
            recipe["source_weights"][name]
                .as_f64()
                .ok_or_else(|| DagMlError::RuntimeValidation("classifier weight missing".into()))?
                .to_le_bytes(),
        );
        for value in [
            encoder["n_components"].as_u64().unwrap_or(0),
            encoder["random_state"].as_u64().unwrap_or(0),
            if kind == 3 { 0 } else { u64::MAX },
            if kind == 3 { 1 } else { u64::MAX },
        ] {
            output.extend(value.to_le_bytes());
        }
        for value in [
            u32::from(kind != 2),
            u32::from(kind != 2),
            0,
            u32::from(kind == 3),
        ] {
            output.extend(value.to_le_bytes());
        }
    }
    Ok(output)
}

pub(crate) fn validate_classifier_n4mc(
    bytes: &[u8],
    recipe: &Value,
    schemas: &Value,
    classes: &[usize],
) -> Result<()> {
    let mut input = Reader::new(checksum(bytes, b"N4MC")?);
    input.take(4)?;
    if input.u32()? != 1
        || [input.u32()?, input.u32()?, input.u32()?] != [2, 17, 0]
        || input.block()? != canonical_recipe(recipe, schemas)?
    {
        return invalid();
    }
    let mut width = 0_u64;
    for source in recipe["source_order"]
        .as_array()
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier source order missing".into()))?
    {
        let name = source.as_str().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier source name missing".into())
        })?;
        let encoder = &recipe["encoders"][name];
        let features = if name == "metadata" {
            1
        } else {
            schemas[name]["input_shape"]
                .as_array()
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("classifier source shape missing".into())
                })?
                .iter()
                .try_fold(1_u64, |count, size| {
                    count
                        .checked_mul(size.as_u64().unwrap_or(0))
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation("classifier input width overflow".into())
                        })
                })?
        };
        let encoded = validate_encoder(input.block()?, encoder, features)?;
        let categories = input.u64()?;
        if categories > 65_536
            || (name == "metadata" && categories == 0)
            || (name != "metadata" && categories != 0)
        {
            return invalid();
        }
        let mut previous: Option<String> = None;
        for _ in 0..categories {
            let value = input.string()?;
            if previous.as_ref().is_some_and(|prior| prior >= &value) {
                return invalid();
            }
            previous = Some(value);
        }
        width = width.checked_add(encoded + categories).ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier encoded width overflow".into())
        })?;
    }
    if input.u64()? != classes.len() as u64 {
        return invalid();
    }
    for class in classes {
        if input.i64()? != *class as i64 {
            return invalid();
        }
    }
    validate_classifier_n4me(
        input.block()?,
        &recipe["model"]["params"],
        width as usize,
        classes,
    )?;
    input.end()
}
