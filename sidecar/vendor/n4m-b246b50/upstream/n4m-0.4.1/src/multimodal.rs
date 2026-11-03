//! Thin, owning binding to the complete native multimodal predictor (ABI 2.16).
//!
//! Rust describes schemas and borrows tensors/UTF-8 cells. Population scaling,
//! PCA, categorical learning, fusion, Ridge and state validation live in libn4m.

use super::*;

const MAX_STATE_BYTES: usize = 64 * 1024 * 1024;

#[repr(C)]
pub(super) struct PipelineRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct SourceSpecRaw {
    struct_size: u32,
    name: *const c_char,
    representation_id: *const c_char,
    dtype: *const c_char,
    identity_utf8: *const c_void,
    identity_bytes: usize,
    ndim: i32,
    shape: *const i64,
    encoder: u32,
    weight: f64,
    n_components: i64,
    random_state: i64,
    with_mean: i32,
    with_std: i32,
    whiten: i32,
    ignore_unknown: i32,
    numeric_column: i64,
    categorical_column: i64,
}
#[repr(C)]
pub(super) struct RecipeRaw {
    struct_size: u32,
    n_sources: i32,
    sources: *const SourceSpecRaw,
    alpha: f64,
    center_x: i32,
    center_y: i32,
    scale_x: i32,
}
#[repr(C)]
pub(super) struct SourceViewRaw {
    struct_size: u32,
    name: *const c_char,
    representation_id: *const c_char,
    dtype: *const c_char,
    identity_utf8: *const c_void,
    identity_bytes: usize,
    rank: i32,
    shape: *const i64,
    strides: *const i64,
    numeric_data: *const c_void,
    numeric_dtype: i32,
    categorical_utf8: *const c_void,
    utf8_bytes: usize,
    categorical_offsets: *const u64,
}

// Supported targets are 64-bit (build.rs). The linked C header probe separately
// verifies the same layouts and function signatures against the real header.
const _: [(); 128] = [(); mem::size_of::<SourceSpecRaw>()];
const _: [(); 40] = [(); mem::size_of::<RecipeRaw>()];
const _: [(); 112] = [(); mem::size_of::<SourceViewRaw>()];

/// Declarative encoder settings. Native create/import owns semantic validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Encoder {
    StandardScaler,
    TensorPca {
        n_components: usize,
        random_state: i64,
    },
    /// Dense population-scaled column 0 and learned unknown-ignore UTF-8 column 1.
    ColumnTransformer,
}

/// Independently supplied schema and encoder for one ordered source.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceSpec {
    pub name: String,
    pub representation_id: String,
    pub dtype: String,
    /// Canonical IO descriptor UTF-8, including axes/units and feature names.
    pub identity: String,
    /// Fixed shape excluding the sample axis (no ragged or missing sources).
    pub input_shape: Vec<usize>,
    pub encoder: Encoder,
    pub weight: f64,
}

/// Ordered selection of 1..4 distinct U07 modalities; no learned categories or input rows.
#[derive(Debug, Clone, PartialEq)]
pub struct Recipe {
    pub sources: Vec<SourceSpec>,
    pub alpha: f64,
}

struct Strings {
    name: CString,
    representation: CString,
    dtype: CString,
}
impl Strings {
    fn new(spec: &SourceSpec) -> Result<Self, Error> {
        if [&spec.name, &spec.representation_id, &spec.dtype]
            .iter()
            .any(|text| text.is_empty() || text.len() > 256)
        {
            return Err(invalid(
                "source identifiers must contain 1..256 UTF-8 bytes",
            ));
        }
        Ok(Self {
            name: cstring(&spec.name, "source name")?,
            representation: cstring(&spec.representation_id, "representation id")?,
            dtype: cstring(&spec.dtype, "source dtype")?,
        })
    }
}
fn dimensions(values: &[usize]) -> Result<Vec<i64>, Error> {
    values
        .iter()
        .map(|&value| {
            i64::try_from(value).map_err(|_| invalid("tensor dimension exceeds C ABI range"))
        })
        .collect()
}
fn with_recipe<R>(recipe: &Recipe, call: impl FnOnce(&RecipeRaw) -> R) -> Result<R, Error> {
    if !(1..=4).contains(&recipe.sources.len())
        || recipe
            .sources
            .iter()
            .any(|source| !(1..=7).contains(&source.input_shape.len()))
    {
        return Err(invalid(
            "multimodal recipe requires 1..4 sources with non-sample rank 1..7",
        ));
    }
    let count = i32::try_from(recipe.sources.len()).map_err(|_| invalid("too many sources"))?;
    let strings = recipe
        .sources
        .iter()
        .map(Strings::new)
        .collect::<Result<Vec<_>, _>>()?;
    let shapes = recipe
        .sources
        .iter()
        .map(|source| dimensions(&source.input_shape))
        .collect::<Result<Vec<_>, _>>()?;
    let mut specs = Vec::with_capacity(recipe.sources.len());
    for ((source, text), shape) in recipe.sources.iter().zip(&strings).zip(&shapes) {
        let mut raw = SourceSpecRaw {
            struct_size: mem::size_of::<SourceSpecRaw>() as u32,
            name: text.name.as_ptr(),
            representation_id: text.representation.as_ptr(),
            dtype: text.dtype.as_ptr(),
            identity_utf8: source.identity.as_ptr().cast(),
            identity_bytes: source.identity.len(),
            ndim: i32::try_from(shape.len())
                .map_err(|_| invalid("tensor rank exceeds C ABI range"))?,
            shape: shape.as_ptr(),
            encoder: 0,
            weight: source.weight,
            n_components: 0,
            random_state: 0,
            with_mean: 0,
            with_std: 0,
            whiten: 0,
            ignore_unknown: 0,
            numeric_column: -1,
            categorical_column: -1,
        };
        match source.encoder {
            Encoder::StandardScaler => {
                raw.encoder = 1;
                raw.with_mean = 1;
                raw.with_std = 1;
            }
            Encoder::TensorPca {
                n_components,
                random_state,
            } => {
                raw.encoder = 2;
                raw.n_components = i64::try_from(n_components)
                    .map_err(|_| invalid("PCA component count exceeds C ABI range"))?;
                raw.random_state = random_state;
            }
            Encoder::ColumnTransformer => {
                raw.encoder = 3;
                raw.with_mean = 1;
                raw.with_std = 1;
                raw.ignore_unknown = 1;
                raw.numeric_column = 0;
                raw.categorical_column = 1;
            }
        }
        specs.push(raw);
    }
    Ok(call(&RecipeRaw {
        struct_size: mem::size_of::<RecipeRaw>() as u32,
        n_sources: count,
        sources: specs.as_ptr(),
        alpha: recipe.alpha,
        center_x: 1,
        center_y: 1,
        scale_x: 0,
    }))
}

#[derive(Clone, Copy)]
enum NumericData<'a> {
    F64(&'a [f64]),
    F32(&'a [f32]),
}
impl NumericData<'_> {
    fn len(self) -> usize {
        match self {
            Self::F64(data) => data.len(),
            Self::F32(data) => data.len(),
        }
    }
    fn ptr(self) -> *const c_void {
        match self {
            Self::F64(data) => data.as_ptr().cast(),
            Self::F32(data) => data.as_ptr().cast(),
        }
    }
    fn dtype(self) -> i32 {
        match self {
            Self::F64(_) => 1,
            Self::F32(_) => 2,
        }
    }
}

/// Memory-safe borrowed numeric tensor or mixed table. No encoding is learned.
pub struct SourceView<'a> {
    spec: &'a SourceSpec,
    strings: Strings,
    shape: Vec<i64>,
    strides: Vec<i64>,
    data: NumericData<'a>,
    utf8: Vec<u8>,
    offsets: Vec<u64>,
}
impl<'a> SourceView<'a> {
    /// Borrow an f64 tensor, sample axis first, in row-major order.
    pub fn numeric(spec: &'a SourceSpec, data: &'a [f64], shape: &[usize]) -> Result<Self, Error> {
        Self::tensor(
            spec,
            NumericData::F64(data),
            shape,
            &row_major_strides(shape)?,
        )
    }
    /// Borrow an f32 tensor without changing its declared dtype.
    pub fn numeric_f32(
        spec: &'a SourceSpec,
        data: &'a [f32],
        shape: &[usize],
    ) -> Result<Self, Error> {
        Self::tensor(
            spec,
            NumericData::F32(data),
            shape,
            &row_major_strides(shape)?,
        )
    }
    /// Positive element strides permit transposes/slices without copying data.
    pub fn strided(
        spec: &'a SourceSpec,
        data: &'a [f64],
        shape: &[usize],
        strides: &[usize],
    ) -> Result<Self, Error> {
        Self::tensor(spec, NumericData::F64(data), shape, strides)
    }
    fn tensor(
        spec: &'a SourceSpec,
        data: NumericData<'a>,
        shape: &[usize],
        strides: &[usize],
    ) -> Result<Self, Error> {
        if spec.encoder == Encoder::ColumnTransformer {
            return Err(invalid(
                "mixed sources require numeric values and raw UTF-8 categories",
            ));
        }
        if !(2..=8).contains(&shape.len()) || shape.len() != strides.len() {
            return Err(invalid(
                "numeric tensor requires rank 2..8 and one stride per axis",
            ));
        }
        if !shape.contains(&0) {
            let last = shape
                .iter()
                .zip(strides)
                .try_fold(0usize, |offset, (&width, &stride)| {
                    (width - 1)
                        .checked_mul(stride)
                        .and_then(|delta| offset.checked_add(delta))
                })
                .ok_or_else(|| invalid("tensor span overflows"))?;
            if last >= data.len() {
                return Err(invalid("tensor view exceeds its borrowed data"));
            }
        }
        Ok(Self {
            spec,
            strings: Strings::new(spec)?,
            shape: dimensions(shape)?,
            strides: dimensions(strides)?,
            data,
            utf8: Vec::new(),
            offsets: Vec::new(),
        })
    }
    /// Borrow column 0 and copy exact category bytes for column 1. Empty strings,
    /// embedded NUL and Unicode are length-delimited; no category codes are made.
    pub fn mixed(
        spec: &'a SourceSpec,
        numeric: &'a [f64],
        categories: &[&str],
    ) -> Result<Self, Error> {
        if spec.encoder != Encoder::ColumnTransformer || numeric.len() != categories.len() {
            return Err(invalid(
                "mixed source requires a declared column transformer and equal row counts",
            ));
        }
        if categories.len() >= MAX_STATE_BYTES / mem::size_of::<u64>() {
            return Err(invalid("categorical offset array exceeds 64 MiB"));
        }
        let mut utf8 = Vec::new();
        let mut offsets = vec![0];
        for category in categories {
            let length = utf8
                .len()
                .checked_add(category.len())
                .filter(|&size| size <= MAX_STATE_BYTES)
                .ok_or_else(|| invalid("UTF-8 category input exceeds 64 MiB"))?;
            utf8.extend_from_slice(category.as_bytes());
            offsets.push(length as u64);
        }
        Ok(Self {
            spec,
            strings: Strings::new(spec)?,
            shape: dimensions(&[numeric.len(), 2])?,
            strides: vec![1, 1],
            data: NumericData::F64(numeric),
            utf8,
            offsets,
        })
    }
    fn rows(&self) -> usize {
        self.shape[0] as usize
    }
    fn raw(&self) -> SourceViewRaw {
        SourceViewRaw {
            struct_size: mem::size_of::<SourceViewRaw>() as u32,
            name: self.strings.name.as_ptr(),
            representation_id: self.strings.representation.as_ptr(),
            dtype: self.strings.dtype.as_ptr(),
            identity_utf8: self.spec.identity.as_ptr().cast(),
            identity_bytes: self.spec.identity.len(),
            rank: self.shape.len() as i32,
            shape: self.shape.as_ptr(),
            strides: self.strides.as_ptr(),
            numeric_data: self.data.ptr(),
            numeric_dtype: self.data.dtype(),
            categorical_utf8: if self.offsets.is_empty() {
                ptr::null()
            } else if self.utf8.is_empty() {
                // Mixed tables can contain only empty strings. Keep a valid
                // address for their zero-byte slices, with no category code.
                c"".as_ptr().cast()
            } else {
                self.utf8.as_ptr().cast()
            },
            utf8_bytes: self.utf8.len(),
            categorical_offsets: if self.offsets.is_empty() {
                ptr::null()
            } else {
                self.offsets.as_ptr()
            },
        }
    }
}
fn row_major_strides(shape: &[usize]) -> Result<Vec<usize>, Error> {
    let mut strides = vec![1; shape.len()];
    let mut stride = 1usize;
    for index in (0..shape.len()).rev() {
        strides[index] = stride;
        stride = stride
            .checked_mul(shape[index])
            .ok_or_else(|| invalid("tensor size overflows"))?;
    }
    Ok(strides)
}

/// Complete native early-fusion predictor. Dropping frees its fitted encoders
/// and Ridge; no source buffers or training rows are retained by this binding.
pub struct MultimodalPipeline {
    raw: NonNull<PipelineRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl MultimodalPipeline {
    pub fn new(ctx: &Context, recipe: &Recipe) -> Result<Self, Error> {
        let mut raw = ptr::null_mut();
        let status = with_recipe(recipe, |spec| unsafe {
            n4m_multimodal_pipeline_create(ctx.ptr(), spec, &mut raw)
        })?;
        check(status, Some(ctx.ptr()))?;
        Ok(Self {
            raw: NonNull::new(raw)
                .ok_or_else(|| corrupt("native multimodal create returned no handle"))?,
            _thread_bound: PhantomData,
        })
    }
    /// Native fit is transactional; any failure preserves previous fitted state.
    pub fn fit(
        &mut self,
        ctx: &Context,
        sources: &[SourceView<'_>],
        y: MatrixRef<'_>,
    ) -> Result<(), Error> {
        let views = sources.iter().map(SourceView::raw).collect::<Vec<_>>();
        let count = i32::try_from(views.len()).map_err(|_| invalid("too many sources"))?;
        check(
            unsafe {
                n4m_multimodal_pipeline_fit(
                    ctx.ptr(),
                    self.raw.as_ptr(),
                    count,
                    views.as_ptr(),
                    &y.raw(),
                )
            },
            Some(ctx.ptr()),
        )
    }
    pub fn transform_cols(&self) -> Result<usize, Error> {
        let mut cols = 0;
        check(
            unsafe { n4m_multimodal_pipeline_transform_cols(self.raw.as_ptr(), &mut cols) },
            None,
        )?;
        usize::try_from(cols).map_err(|_| corrupt("invalid native multimodal output width"))
    }
    /// Return actual weighted encoded features, with no fit/reconstruction.
    pub fn transform(&self, ctx: &Context, sources: &[SourceView<'_>]) -> Result<Matrix, Error> {
        self.output(ctx, sources, self.transform_cols()?, true)
    }
    pub fn predict(&self, ctx: &Context, sources: &[SourceView<'_>]) -> Result<Matrix, Error> {
        self.output(ctx, sources, 1, false)
    }
    fn output(
        &self,
        ctx: &Context,
        sources: &[SourceView<'_>],
        cols: usize,
        transform: bool,
    ) -> Result<Matrix, Error> {
        let rows = sources
            .first()
            .ok_or_else(|| invalid("multimodal input requires sources"))?
            .rows();
        let size = rows
            .checked_mul(cols)
            .filter(|&size| size <= MAX_ARRAY_ELEMENTS)
            .ok_or_else(|| invalid("multimodal output exceeds allocation budget"))?;
        let mut result = Matrix {
            data: vec![0.0; size],
            rows,
            cols,
        };
        let mut out = MatrixView {
            data: result.data.as_mut_ptr().cast(),
            rows: rows as i64,
            cols: i64::try_from(cols)
                .map_err(|_| corrupt("native output width exceeds C ABI range"))?,
            row_stride: cols as i64,
            col_stride: 1,
            dtype: 1,
            reserved0: 0,
        };
        let views = sources.iter().map(SourceView::raw).collect::<Vec<_>>();
        let count = i32::try_from(views.len()).map_err(|_| invalid("too many sources"))?;
        let status = unsafe {
            if transform {
                n4m_multimodal_pipeline_transform(
                    ctx.ptr(),
                    self.raw.as_ptr(),
                    count,
                    views.as_ptr(),
                    &mut out,
                )
            } else {
                n4m_multimodal_pipeline_predict(
                    ctx.ptr(),
                    self.raw.as_ptr(),
                    count,
                    views.as_ptr(),
                    &mut out,
                )
            }
        };
        check(status, Some(ctx.ptr()))?;
        Ok(result)
    }
    /// Export the complete N4MF predictor; no fitted host objects are serialized.
    pub fn export_state(&self, ctx: &Context) -> Result<Vec<u8>, Error> {
        let mut size = 0;
        check(
            unsafe { n4m_multimodal_pipeline_export_size(ctx.ptr(), self.raw.as_ptr(), &mut size) },
            Some(ctx.ptr()),
        )?;
        if size > MAX_STATE_BYTES {
            return Err(corrupt("native multimodal state exceeds 64 MiB"));
        }
        let mut bytes = vec![0; size];
        let mut written = 0;
        check(
            unsafe {
                n4m_multimodal_pipeline_export_to_buffer(
                    ctx.ptr(),
                    self.raw.as_ptr(),
                    bytes.as_mut_ptr().cast(),
                    size,
                    &mut written,
                )
            },
            Some(ctx.ptr()),
        )?;
        if written != size {
            return Err(corrupt(
                "native multimodal state size changed during export",
            ));
        }
        Ok(bytes)
    }
    /// Import only against an independent expected recipe/schema. Native code
    /// validates all lengths, checksums, parameters and learned encoder states.
    pub fn from_state(ctx: &Context, recipe: &Recipe, bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() > MAX_STATE_BYTES {
            return Err(invalid("multimodal state exceeds 64 MiB"));
        }
        let mut raw = ptr::null_mut();
        let status = with_recipe(recipe, |spec| unsafe {
            n4m_multimodal_pipeline_import_from_buffer(
                ctx.ptr(),
                spec,
                bytes.as_ptr().cast(),
                bytes.len(),
                &mut raw,
            )
        })?;
        check(status, Some(ctx.ptr()))?;
        Ok(Self {
            raw: NonNull::new(raw)
                .ok_or_else(|| corrupt("native multimodal import returned no handle"))?,
            _thread_bound: PhantomData,
        })
    }
}
impl Drop for MultimodalPipeline {
    fn drop(&mut self) {
        unsafe { n4m_multimodal_pipeline_destroy(self.raw.as_ptr()) }
    }
}
