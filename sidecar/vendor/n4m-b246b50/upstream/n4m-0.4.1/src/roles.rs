//! Generic estimator roles (ABI 2.13, `n4m/estimator.h`).
//!
//! Every catalog method is either an [`Estimator`] with a fitted state
//! (create, fit, transform / predict / ..., N4ME export and import) or a
//! procedure run once through [`run_procedure`]. Parameters, defaults,
//! required inputs, role checks and all numerics live in libn4m: an operation
//! the method's role does not define fails with the native status
//! (`Unsupported`). This module only owns handles and copies results.

use super::*;

pub const ROLE_TRANSFORMER: u32 = 1 << 0;
pub const ROLE_REGRESSOR: u32 = 1 << 1;
pub const ROLE_CLASSIFIER: u32 = 1 << 2;
pub const ROLE_SELECTOR: u32 = 1 << 3;
pub const ROLE_SAMPLE_FILTER: u32 = 1 << 4;
pub const ROLE_SPLITTER: u32 = 1 << 5;
pub const ROLE_AUGMENTER: u32 = 1 << 6;
pub const ROLE_GENERIC: u32 = 1 << 7;

pub const CAP_TRANSFORM: u64 = 1 << 0;
pub const CAP_PREDICT: u64 = 1 << 1;
pub const CAP_PREDICT_PROBA: u64 = 1 << 2;
pub const CAP_DECISION_FUNCTION: u64 = 1 << 3;
pub const CAP_PREDICT_LABELS: u64 = 1 << 4;
pub const CAP_SELECTED_INDICES: u64 = 1 << 5;
pub const CAP_APPLY_MASK: u64 = 1 << 6;
pub const CAP_SERIALIZABLE: u64 = 1 << 7;
pub const CAP_AFFINE: u64 = 1 << 8;
pub const CAP_RETAINS_TRAINING_ROWS: u64 = 1 << 9;

const EXPORT_ALLOW_TRAINING_ROWS: u32 = 1 << 0;

c_enum!(MethodKind { Estimator=1, Procedure=2 });
c_enum!(InputRequirement { None=0, Optional=1, Required=2 });
c_enum!(FitInput { Y=0, Labels=1, SampleWeight=2, Groups=3, FeatureGroups=4, Blocks=5, Axis=6, TargetDomain=7, FoldIds=8 });
c_enum!(ParamType { Int=1, Double=2, Bool=3, Enum=4, IntArray=5, DoubleArray=6 });
c_enum!(ResultEntryKind { DoubleMatrix=0, IntVector=1, Int64Vector=2, Scalar=3 });

/// A parameter value, typed as the manifest declares it.
#[derive(Debug, Clone, PartialEq)]
pub enum ParamValue {
    Int(i64),
    /// `NaN` leaves an optional double unset when its default is `NaN`.
    Double(f64),
    Bool(bool),
    Enum(String),
    IntArray(Vec<i64>),
    DoubleArray(Vec<f64>),
}

/// One typed parameter of the native manifest.
#[derive(Debug, Clone, PartialEq)]
pub struct ParamInfo {
    pub name: String,
    pub param_type: ParamType,
    /// The caller must set it (no default).
    pub required: bool,
    /// `None` when the parameter is required, or optional and unset by
    /// default (seeds: an unset seed runs as 0).
    pub default: Option<ParamValue>,
    /// The fitted state records the value (or a dimension it fixes); N4ME
    /// import refuses a contradicting value.
    pub recorded: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Labels of an [`ParamType::Enum`] parameter.
    pub choices: Vec<String>,
}

/// One method of the native manifest.
#[derive(Debug, Clone, PartialEq)]
pub struct MethodInfo {
    pub method_id: String,
    pub fq_name: String,
    pub kind: MethodKind,
    /// `ROLE_*` mask.
    pub roles: u32,
    /// `CAP_*` mask of a fitted estimator; 0 for procedures.
    pub capabilities: u64,
    /// N4ME state block format, empty when the method has none.
    pub state_format: String,
    /// Requirement of each fit input, indexed by [`FitInput`].
    pub inputs: [InputRequirement; FIT_INPUT_COUNT],
    pub params: Vec<ParamInfo>,
}
impl MethodInfo {
    pub fn input(&self, input: FitInput) -> InputRequirement {
        self.inputs[input as usize]
    }
}

fn native(status: i32, message: impl Into<String>) -> Error {
    Error {
        kind: kind(status),
        status,
        message: message.into(),
    }
}
fn check_named(status: i32, what: impl FnOnce() -> String) -> Result<(), Error> {
    check(status, None).map_err(|e| native(status, format!("{}: {}", what(), e.message)))
}
fn static_str(text: *const c_char) -> Result<String, Error> {
    if text.is_null() {
        return Err(corrupt("native manifest string is null"));
    }
    Ok(unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .into_owned())
}
fn native_len(value: i64, what: &str) -> Result<usize, Error> {
    usize::try_from(value).map_err(|_| corrupt(format!("native {what} is invalid")))
}
/// Copies `len` elements borrowed from a native result.
fn copy_borrowed<T: Copy>(data: *const T, len: usize, what: &str) -> Result<Vec<T>, Error> {
    if len == 0 {
        return Ok(Vec::new());
    }
    if data.is_null() {
        return Err(corrupt(format!("native {what} data is null")));
    }
    Ok(unsafe { slice::from_raw_parts(data, len) }.to_vec())
}
/// Reads a caller-allocated array through the ABI's query-then-fill protocol
/// (`out = NULL, capacity = 0` returns the count).
fn read_counted<T: Copy + Default>(
    read: impl Fn(*mut T, i64, *mut i64) -> i32,
    what: &str,
) -> Result<Vec<T>, Error> {
    let mut count = 0;
    check_named(read(ptr::null_mut(), 0, &mut count), || what.to_owned())?;
    let mut out = vec![T::default(); native_len(count, what)?];
    if !out.is_empty() {
        check_named(read(out.as_mut_ptr(), count, &mut count), || {
            what.to_owned()
        })?;
        out.truncate(native_len(count, what)?);
    }
    Ok(out)
}

/// The whole native manifest as JSON: per method its id, kind, roles, DAG-ML
/// node kinds, capabilities, fit inputs and typed parameters with defaults.
pub fn manifest_json() -> Result<String, Error> {
    ensure_abi()?;
    let mut size = 0;
    check(
        unsafe { n4m_method_manifest_json(ptr::null_mut(), 0, &mut size) },
        None,
    )?;
    let mut out = vec![0u8; size];
    check(
        unsafe { n4m_method_manifest_json(out.as_mut_ptr().cast(), out.len(), &mut size) },
        None,
    )?;
    out.truncate(size);
    String::from_utf8(out).map_err(|_| corrupt("native manifest is not UTF-8"))
}

/// Every method of the native manifest, in catalog order.
pub fn methods() -> Result<Vec<MethodInfo>, Error> {
    ensure_abi()?;
    let mut count = 0;
    check(unsafe { n4m_method_count(&mut count) }, None)?;
    (0..count).map(info_at).collect()
}

/// Manifest entry of `method_id`.
pub fn method_info(method_id: &str) -> Result<MethodInfo, Error> {
    info_at(method_index(method_id)?)
}

fn method_index(method_id: &str) -> Result<i32, Error> {
    ensure_abi()?;
    let id = cstring(method_id, "method id")?;
    let mut index = -1;
    let status = unsafe { n4m_method_find(id.as_ptr(), &mut index) };
    if status != OK {
        return Err(native(status, format!("unknown method {method_id:?}")));
    }
    Ok(index)
}
fn info_raw(index: i32) -> Result<MethodInfoV1Raw, Error> {
    // All-zero is a valid value for every field (integers and null pointers).
    let mut raw: MethodInfoV1Raw = unsafe { mem::zeroed() };
    raw.struct_size = mem::size_of::<MethodInfoV1Raw>() as u32;
    check(unsafe { n4m_method_info_v1(index, &mut raw) }, None)?;
    Ok(raw)
}
fn info_at(index: i32) -> Result<MethodInfo, Error> {
    let raw = info_raw(index)?;
    let mut inputs = [InputRequirement::None; FIT_INPUT_COUNT];
    for (slot, &level) in inputs.iter_mut().zip(&raw.inputs) {
        *slot = status_enum(level, InputRequirement::from_raw, "input requirement")?;
    }
    Ok(MethodInfo {
        method_id: static_str(raw.method_id)?,
        fq_name: static_str(raw.fq_name)?,
        kind: status_enum(raw.kind, MethodKind::from_raw, "method kind")?,
        roles: raw.roles,
        capabilities: raw.capabilities,
        state_format: static_str(raw.state_format)?,
        inputs,
        params: (0..raw.n_params)
            .map(|param| param_at(index, param))
            .collect::<Result<_, _>>()?,
    })
}
fn param_at(index: i32, param: i32) -> Result<ParamInfo, Error> {
    // All-zero is a valid value for every field (numbers and null pointers).
    let mut raw: ParamInfoV1Raw = unsafe { mem::zeroed() };
    raw.struct_size = mem::size_of::<ParamInfoV1Raw>() as u32;
    check(
        unsafe { n4m_method_param_info_v1(index, param, &mut raw) },
        None,
    )?;
    let param_type = status_enum(raw.param_type, ParamType::from_raw, "parameter type")?;
    let n_choices = native_len(raw.n_choices.into(), "enum choice count")?;
    let choices = copy_borrowed(raw.choices, n_choices, "enum choices")?
        .into_iter()
        .map(static_str)
        .collect::<Result<Vec<_>, _>>()?;
    let array = matches!(param_type, ParamType::IntArray | ParamType::DoubleArray);
    let default = if raw.has_default == 0 || (!array && raw.default_length == 0) {
        None
    } else {
        Some(default_value(index, param, param_type, &choices)?)
    };
    let bound = |value: f64| (!value.is_nan()).then_some(value);
    Ok(ParamInfo {
        name: static_str(raw.name)?,
        param_type,
        required: raw.has_default == 0,
        default,
        recorded: raw.recorded != 0,
        min: bound(raw.min_value),
        max: bound(raw.max_value),
        choices,
    })
}
fn default_value(
    index: i32,
    param: i32,
    param_type: ParamType,
    choices: &[String],
) -> Result<ParamValue, Error> {
    let ints = || {
        read_counted(
            |out, capacity, count| unsafe {
                n4m_method_param_default_int(index, param, out, capacity, count)
            },
            "parameter default",
        )
    };
    let doubles = || {
        read_counted(
            |out, capacity, count| unsafe {
                n4m_method_param_default_double(index, param, out, capacity, count)
            },
            "parameter default",
        )
    };
    Ok(match param_type {
        ParamType::Int => ParamValue::Int(single(ints()?)?),
        ParamType::Bool => ParamValue::Bool(single(ints()?)? != 0),
        ParamType::Enum => {
            let choice = single(ints()?)?;
            let label = usize::try_from(choice).ok().and_then(|i| choices.get(i));
            ParamValue::Enum(
                label
                    .cloned()
                    .ok_or_else(|| corrupt("native enum default is out of range"))?,
            )
        }
        ParamType::IntArray => ParamValue::IntArray(ints()?),
        ParamType::Double => ParamValue::Double(single(doubles()?)?),
        ParamType::DoubleArray => ParamValue::DoubleArray(doubles()?),
    })
}
fn single<T: Copy>(values: Vec<T>) -> Result<T, Error> {
    match values[..] {
        [value] => Ok(value),
        _ => Err(corrupt(
            "native scalar parameter default must hold one value",
        )),
    }
}

/// Named, typed parameters of one method. Unset parameters keep their
/// manifest defaults; setters check name, type and bounds natively.
pub struct Params {
    raw: NonNull<ParamsRaw>,
    method_id: String,
    _thread_bound: PhantomData<*mut ()>,
}
impl Params {
    pub fn new(ctx: &Context, method_id: &str) -> Result<Self, Error> {
        let index = method_index(method_id)?;
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_params_create(ctx.ptr(), index, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Self::owned(ctx, raw, method_id.to_owned())
    }
    fn owned(ctx: &Context, raw: *mut ParamsRaw, method_id: String) -> Result<Self, Error> {
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            method_id,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut ParamsRaw {
        self.raw.as_ptr()
    }
    pub fn method_id(&self) -> &str {
        &self.method_id
    }
    fn setter(
        &mut self,
        name: &str,
        set: impl FnOnce(*mut ParamsRaw, *const c_char) -> i32,
    ) -> Result<&mut Self, Error> {
        let key = cstring(name, "parameter name")?;
        let status = set(self.ptr(), key.as_ptr());
        if status != OK {
            // The setters report no context message; name the parameter.
            return Err(native(
                status,
                format!("{}: invalid value for parameter {name:?}", self.method_id),
            ));
        }
        Ok(self)
    }
    pub fn set_int(&mut self, name: &str, value: i64) -> Result<&mut Self, Error> {
        self.setter(name, |p, key| unsafe { n4m_params_set_int(p, key, value) })
    }
    pub fn set_double(&mut self, name: &str, value: f64) -> Result<&mut Self, Error> {
        self.setter(name, |p, key| unsafe {
            n4m_params_set_double(p, key, value)
        })
    }
    pub fn set_bool(&mut self, name: &str, value: bool) -> Result<&mut Self, Error> {
        self.setter(name, |p, key| unsafe {
            n4m_params_set_bool(p, key, i32::from(value))
        })
    }
    pub fn set_enum(&mut self, name: &str, choice: &str) -> Result<&mut Self, Error> {
        let choice = cstring(choice, "enum choice")?;
        self.setter(name, |p, key| unsafe {
            n4m_params_set_enum(p, key, choice.as_ptr())
        })
    }
    pub fn set_int_array(&mut self, name: &str, values: &[i64]) -> Result<&mut Self, Error> {
        self.setter(name, |p, key| unsafe {
            n4m_params_set_int_array(p, key, values.as_ptr(), values.len() as i64)
        })
    }
    pub fn set_double_array(&mut self, name: &str, values: &[f64]) -> Result<&mut Self, Error> {
        self.setter(name, |p, key| unsafe {
            n4m_params_set_double_array(p, key, values.as_ptr(), values.len() as i64)
        })
    }
    /// Sets a value through the setter of its type.
    pub fn set(&mut self, name: &str, value: &ParamValue) -> Result<&mut Self, Error> {
        match value {
            ParamValue::Int(v) => self.set_int(name, *v),
            ParamValue::Double(v) => self.set_double(name, *v),
            ParamValue::Bool(v) => self.set_bool(name, *v),
            ParamValue::Enum(v) => self.set_enum(name, v),
            ParamValue::IntArray(v) => self.set_int_array(name, v),
            ParamValue::DoubleArray(v) => self.set_double_array(name, v),
        }
    }
    /// Reports the first invalid or missing required parameter by name.
    /// Estimator creation and procedure runs perform the same check.
    pub fn validate(&self, ctx: &Context) -> Result<(), Error> {
        check(
            unsafe { n4m_params_validate(ctx.ptr(), self.ptr()) },
            Some(ctx.ptr()),
        )
    }
    /// Resolved (explicit or default) value of an int, bool, enum (choice
    /// index) or int-array parameter.
    pub fn int_values(&self, name: &str) -> Result<Vec<i64>, Error> {
        let key = cstring(name, "parameter name")?;
        read_counted(
            |out, capacity, count| unsafe {
                n4m_params_get_int(self.ptr(), key.as_ptr(), out, capacity, count)
            },
            name,
        )
    }
    /// Resolved (explicit or default) value of a double or double-array
    /// parameter.
    pub fn double_values(&self, name: &str) -> Result<Vec<f64>, Error> {
        let key = cstring(name, "parameter name")?;
        read_counted(
            |out, capacity, count| unsafe {
                n4m_params_get_double(self.ptr(), key.as_ptr(), out, capacity, count)
            },
            name,
        )
    }
}
impl Drop for Params {
    fn drop(&mut self) {
        unsafe { n4m_params_destroy(self.ptr()) }
    }
}

/// Data of one fit or procedure run (`n4m_fit_inputs_v1_t`). Only `X` is
/// mandatory; the manifest decides which other inputs a method requires,
/// accepts or refuses, and the native core enforces it.
#[derive(Debug, Clone, Copy)]
pub struct FitInputs<'a> {
    x: MatrixRef<'a>,
    y: Option<MatrixRef<'a>>,
    labels: Option<&'a [i64]>,
    sample_weight: Option<&'a [f64]>,
    groups: Option<&'a [i64]>,
    feature_groups: Option<&'a [i64]>,
    blocks: Option<&'a [i64]>,
    axis: Option<&'a [f64]>,
    x_target: Option<MatrixRef<'a>>,
    fold_ids: Option<&'a [i64]>,
}
impl<'a> FitInputs<'a> {
    pub fn new(x: MatrixRef<'a>) -> Self {
        Self {
            x,
            y: None,
            labels: None,
            sample_weight: None,
            groups: None,
            feature_groups: None,
            blocks: None,
            axis: None,
            x_target: None,
            fold_ids: None,
        }
    }
    /// Continuous targets, one row per row of `X`.
    pub fn y(mut self, y: MatrixRef<'a>) -> Self {
        self.y = Some(y);
        self
    }
    /// Class ids, one per row (classifiers).
    pub fn labels(mut self, labels: &'a [i64]) -> Self {
        self.labels = Some(labels);
        self
    }
    pub fn sample_weight(mut self, weights: &'a [f64]) -> Self {
        self.sample_weight = Some(weights);
        self
    }
    /// Sample groups, one per row.
    pub fn groups(mut self, groups: &'a [i64]) -> Self {
        self.groups = Some(groups);
        self
    }
    /// Group id per column.
    pub fn feature_groups(mut self, groups: &'a [i64]) -> Self {
        self.feature_groups = Some(groups);
        self
    }
    /// Column counts of consecutive multiblock blocks.
    pub fn blocks(mut self, block_sizes: &'a [i64]) -> Self {
        self.blocks = Some(block_sizes);
        self
    }
    /// Spectral axis, one value per column.
    pub fn axis(mut self, axis: &'a [f64]) -> Self {
        self.axis = Some(axis);
        self
    }
    /// Target-domain (slave) spectra.
    pub fn x_target(mut self, x_target: MatrixRef<'a>) -> Self {
        self.x_target = Some(x_target);
        self
    }
    /// Internal-CV test fold per row.
    pub fn fold_ids(mut self, fold_ids: &'a [i64]) -> Self {
        self.fold_ids = Some(fold_ids);
        self
    }
    fn with_raw<R>(&self, call: impl FnOnce(&FitInputsV1Raw) -> R) -> R {
        fn parts<T>(values: Option<&[T]>) -> (*const T, i64) {
            values.map_or((ptr::null(), 0), |v| (v.as_ptr(), v.len() as i64))
        }
        let x = self.x.raw();
        let y = self.y.map(MatrixRef::raw);
        let x_target = self.x_target.map(MatrixRef::raw);
        let (labels, n_labels) = parts(self.labels);
        let (sample_weight, n_sample_weight) = parts(self.sample_weight);
        let (groups, n_groups) = parts(self.groups);
        let (feature_groups, n_feature_groups) = parts(self.feature_groups);
        let (block_sizes, n_blocks) = parts(self.blocks);
        let (axis, n_axis) = parts(self.axis);
        let (fold_ids, n_fold_ids) = parts(self.fold_ids);
        let view = |v: &Option<MatrixView>| v.as_ref().map_or(ptr::null(), |v| v as *const _);
        call(&FitInputsV1Raw {
            struct_size: mem::size_of::<FitInputsV1Raw>() as u32,
            x: &x,
            y: view(&y),
            labels,
            n_labels,
            sample_weight,
            n_sample_weight,
            groups,
            n_groups,
            feature_groups,
            n_feature_groups,
            block_sizes,
            n_blocks,
            axis,
            n_axis,
            x_target: view(&x_target),
            fold_ids,
            n_fold_ids,
        })
    }
}

/// Caller-allocated row-major `rows x cols` output of a matrix operation.
fn matrix_output(
    rows: usize,
    cols: usize,
    fill: impl FnOnce(&mut MatrixView) -> i32,
    ctx: &Context,
) -> Result<Matrix, Error> {
    let cells = rows
        .checked_mul(cols)
        .ok_or_else(|| invalid("output dimensions overflow"))?;
    let mut data = vec![0.0; cells];
    let mut out = MatrixView {
        data: data.as_mut_ptr().cast(),
        rows: rows as i64,
        cols: cols as i64,
        row_stride: cols as i64,
        col_stride: 1,
        dtype: 1,
        reserved0: 0,
    };
    check(fill(&mut out), Some(ctx.ptr()))?;
    Ok(Matrix { data, rows, cols })
}

/// A native estimator: one method with a fitted state. The handle is
/// destroyed on drop; the fitted state crosses languages as N4ME bytes.
pub struct Estimator {
    raw: NonNull<EstimatorRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Estimator {
    /// Unfitted estimator of `method_id`; `None` uses every default.
    pub fn new(ctx: &Context, method_id: &str, params: Option<&Params>) -> Result<Self, Error> {
        let id = cstring(method_id, "method id")?;
        let params = params.map_or(ptr::null(), |p| p.ptr().cast_const());
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_estimator_create(ctx.ptr(), id.as_ptr(), params, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Self::owned(ctx, raw)
    }
    fn owned(ctx: &Context, raw: *mut EstimatorRaw) -> Result<Self, Error> {
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut EstimatorRaw {
        self.raw.as_ptr()
    }
    /// Fits (or refits) the state; missing, unused or mismatched inputs (one
    /// entry per row of `X`, never broadcast) are named in the error. The
    /// state is replaced only on success: a failed refit keeps the previous
    /// fitted state.
    pub fn fit(&mut self, ctx: &Context, inputs: &FitInputs<'_>) -> Result<(), Error> {
        let status =
            inputs.with_raw(|raw| unsafe { n4m_estimator_fit(ctx.ptr(), self.ptr(), raw) });
        check(status, Some(ctx.ptr()))
    }
    pub fn is_fitted(&self) -> Result<bool, Error> {
        let mut fitted = 0;
        check(
            unsafe { n4m_estimator_is_fitted(self.ptr(), &mut fitted) },
            None,
        )?;
        Ok(fitted != 0)
    }
    fn info(&self) -> Result<(i32, u64), Error> {
        let (mut index, mut capabilities) = (0, 0);
        check(
            unsafe { n4m_estimator_info(self.ptr(), &mut index, &mut capabilities) },
            None,
        )?;
        Ok((index, capabilities))
    }
    pub fn method_id(&self) -> Result<String, Error> {
        static_str(info_raw(self.info()?.0)?.method_id)
    }
    /// `CAP_*` mask of the fitted state; 0 before a fit.
    pub fn capabilities(&self) -> Result<u64, Error> {
        Ok(self.info()?.1)
    }
    /// Copy of the resolved parameters (also after [`Estimator::from_n4me`]).
    pub fn params(&self, ctx: &Context) -> Result<Params, Error> {
        let method_id = self.method_id()?;
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_estimator_get_params(ctx.ptr(), self.ptr(), &mut raw) },
            Some(ctx.ptr()),
        )?;
        Params::owned(ctx, raw, method_id)
    }
    fn width(
        &self,
        read: impl FnOnce(*const EstimatorRaw, *mut i64) -> i32,
    ) -> Result<usize, Error> {
        let mut value = 0;
        check(read(self.ptr(), &mut value), None)?;
        native_len(value, "estimator width")
    }
    pub fn n_features_in(&self) -> Result<usize, Error> {
        self.width(|est, out| unsafe { n4m_estimator_n_features_in(est, out) })
    }
    /// Output width of predict, decision_function and predict_proba.
    pub fn n_outputs(&self) -> Result<usize, Error> {
        self.width(|est, out| unsafe { n4m_estimator_n_outputs(est, out) })
    }
    /// Output width of transform.
    pub fn transform_cols(&self) -> Result<usize, Error> {
        self.width(|est, out| unsafe { n4m_estimator_transform_cols(est, out) })
    }
    pub fn transform(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Matrix, Error> {
        let x_raw = x.raw();
        matrix_output(
            x.rows,
            self.transform_cols()?,
            |out| unsafe { n4m_estimator_transform(ctx.ptr(), self.ptr(), &x_raw, out) },
            ctx,
        )
    }
    pub fn predict(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Matrix, Error> {
        let x_raw = x.raw();
        matrix_output(
            x.rows,
            self.n_outputs()?,
            |out| unsafe { n4m_estimator_predict(ctx.ptr(), self.ptr(), &x_raw, out) },
            ctx,
        )
    }
    /// Method-defined class scores, one column per class.
    pub fn decision_function(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Matrix, Error> {
        let x_raw = x.raw();
        matrix_output(
            x.rows,
            self.n_outputs()?,
            |out| unsafe { n4m_estimator_decision_function(ctx.ptr(), self.ptr(), &x_raw, out) },
            ctx,
        )
    }
    /// Class probabilities, for classifiers that define them.
    pub fn predict_proba(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Matrix, Error> {
        let x_raw = x.raw();
        matrix_output(
            x.rows,
            self.n_outputs()?,
            |out| unsafe { n4m_estimator_predict_proba(ctx.ptr(), self.ptr(), &x_raw, out) },
            ctx,
        )
    }
    /// Predicted class ids, one per row.
    pub fn predict_labels(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Vec<i64>, Error> {
        let x_raw = x.raw();
        let mut out = vec![0; x.rows];
        check(
            unsafe {
                n4m_estimator_predict_labels(
                    ctx.ptr(),
                    self.ptr(),
                    &x_raw,
                    out.as_mut_ptr(),
                    out.len() as i64,
                )
            },
            Some(ctx.ptr()),
        )?;
        Ok(out)
    }
    /// Class ids seen at fit, in decision-function column order.
    pub fn classes(&self) -> Result<Vec<i64>, Error> {
        read_counted(
            |out, capacity, count| unsafe {
                n4m_estimator_classes(self.ptr(), out, capacity, count)
            },
            "classes",
        )
    }
    /// Selected input columns in native selection order; `transform` returns
    /// them in ascending column order.
    pub fn selected_indices(&self) -> Result<Vec<i64>, Error> {
        read_counted(
            |out, capacity, count| unsafe {
                n4m_estimator_selected_indices(self.ptr(), out, capacity, count)
            },
            "selected indices",
        )
    }
    /// Keep mask of the rows of `x` (`true` keeps). Filters on the target
    /// read `y`; the others ignore it.
    pub fn apply_mask(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        y: Option<MatrixRef<'_>>,
    ) -> Result<Vec<bool>, Error> {
        let x_raw = x.raw();
        let y_raw = y.map(MatrixRef::raw);
        let y_ptr = y_raw.as_ref().map_or(ptr::null(), |v| v as *const _);
        let mut mask = vec![0u8; x.rows];
        check(
            unsafe {
                n4m_estimator_apply_mask(
                    ctx.ptr(),
                    self.ptr(),
                    &x_raw,
                    y_ptr,
                    mask.as_mut_ptr(),
                    mask.len() as i64,
                )
            },
            Some(ctx.ptr()),
        )?;
        Ok(mask.into_iter().map(|keep| keep != 0).collect())
    }
    /// True when the fitted state embeds training rows (kernel PLS, GPR-PLS,
    /// LW-PLS, ...): exporting it shares training data.
    pub fn contains_training_rows(&self) -> Result<bool, Error> {
        let mut out = 0;
        check(
            unsafe { n4m_estimator_contains_training_rows(self.ptr(), &mut out) },
            None,
        )?;
        Ok(out != 0)
    }
    /// Portable fitted state readable by every n4m binding. States that
    /// retain training rows ([`Estimator::contains_training_rows`]) export
    /// only when `allow_training_rows` is set.
    pub fn to_n4me(&self, ctx: &Context, allow_training_rows: bool) -> Result<Vec<u8>, Error> {
        let flags = if allow_training_rows {
            EXPORT_ALLOW_TRAINING_ROWS
        } else {
            0
        };
        let mut size = 0;
        check(
            unsafe { n4m_estimator_export_size(ctx.ptr(), self.ptr(), flags, &mut size) },
            Some(ctx.ptr()),
        )?;
        let mut out = vec![0u8; size];
        let mut written = 0;
        check(
            unsafe {
                n4m_estimator_export_to_buffer(
                    ctx.ptr(),
                    self.ptr(),
                    flags,
                    out.as_mut_ptr().cast(),
                    out.len(),
                    &mut written,
                )
            },
            Some(ctx.ptr()),
        )?;
        if written > out.len() {
            return Err(corrupt("native N4ME wrote beyond its allocation"));
        }
        out.truncate(written);
        Ok(out)
    }
    /// Fitted estimator rebuilt from N4ME bytes, within the context's state
    /// size limit ([`Context::set_max_state_bytes`], 256 MiB by default).
    pub fn from_n4me(ctx: &Context, bytes: &[u8]) -> Result<Self, Error> {
        let mut raw = ptr::null_mut();
        check(
            unsafe {
                n4m_estimator_import_from_buffer(
                    ctx.ptr(),
                    bytes.as_ptr().cast(),
                    bytes.len(),
                    &mut raw,
                )
            },
            Some(ctx.ptr()),
        )?;
        Self::owned(ctx, raw)
    }
}
impl Drop for Estimator {
    fn drop(&mut self) {
        unsafe { n4m_estimator_destroy(self.ptr()) }
    }
}

impl Context {
    /// Largest N4ME payload [`Estimator::from_n4me`] accepts (default 256 MiB).
    pub fn set_max_state_bytes(&self, max_bytes: u64) -> Result<(), Error> {
        check(
            unsafe { n4m_context_set_max_state_bytes(self.ptr(), max_bytes) },
            Some(self.ptr()),
        )
    }
}

/// Named entry of a [`MethodResult`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResultEntry {
    pub name: String,
    pub kind: ResultEntryKind,
}

/// One splitter fold: zero-based row indices of `X` in the splitter's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fold {
    pub train: Vec<i64>,
    pub test: Vec<i64>,
}

/// Owned output of a procedure run. Its layout follows the procedure role:
/// splitters hold [`MethodResult::folds`], augmenters the double matrix
/// `"X"` (augmented rows, same shape and order as the input), generic
/// procedures the named outputs listed by [`MethodResult::entries`].
pub struct MethodResult {
    raw: NonNull<MethodResultRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl MethodResult {
    fn ptr(&self) -> *const MethodResultRaw {
        self.raw.as_ptr()
    }
    /// Named entries, sorted by name.
    pub fn entries(&self) -> Result<Vec<ResultEntry>, Error> {
        let mut count = 0;
        check(
            unsafe { n4m_method_result_entry_count(self.ptr(), &mut count) },
            None,
        )?;
        (0..count)
            .map(|index| {
                let (mut name, mut kind) = (ptr::null(), 0);
                check(
                    unsafe { n4m_method_result_entry(self.ptr(), index, &mut name, &mut kind) },
                    None,
                )?;
                Ok(ResultEntry {
                    name: static_str(name)?,
                    kind: status_enum(kind, ResultEntryKind::from_raw, "result entry kind")?,
                })
            })
            .collect()
    }
    pub fn double_matrix(&self, name: &str) -> Result<Matrix, Error> {
        let key = cstring(name, "result name")?;
        let (mut data, mut rows, mut cols) = (ptr::null(), 0, 0);
        check_named(
            unsafe {
                n4m_method_result_get_double_matrix(
                    self.ptr(),
                    key.as_ptr(),
                    &mut data,
                    &mut rows,
                    &mut cols,
                )
            },
            || name.to_owned(),
        )?;
        let (rows, cols) = (native_len(rows, "rows")?, native_len(cols, "cols")?);
        let cells = rows
            .checked_mul(cols)
            .ok_or_else(|| corrupt("native matrix dimensions overflow"))?;
        Ok(Matrix {
            data: copy_borrowed(data, cells, name)?,
            rows,
            cols,
        })
    }
    pub fn int_vector(&self, name: &str) -> Result<Vec<i32>, Error> {
        let key = cstring(name, "result name")?;
        let (mut data, mut len) = (ptr::null(), 0);
        check_named(
            unsafe {
                n4m_method_result_get_int_vector(self.ptr(), key.as_ptr(), &mut data, &mut len)
            },
            || name.to_owned(),
        )?;
        copy_borrowed(data, native_len(len.into(), name)?, name)
    }
    pub fn int64_vector(&self, name: &str) -> Result<Vec<i64>, Error> {
        let key = cstring(name, "result name")?;
        let (mut data, mut len) = (ptr::null(), 0);
        check_named(
            unsafe {
                n4m_method_result_get_int64_vector(self.ptr(), key.as_ptr(), &mut data, &mut len)
            },
            || name.to_owned(),
        )?;
        copy_borrowed(data, native_len(len, name)?, name)
    }
    pub fn scalar(&self, name: &str) -> Result<f64, Error> {
        let key = cstring(name, "result name")?;
        let mut value = 0.0;
        check_named(
            unsafe { n4m_method_result_get_scalar(self.ptr(), key.as_ptr(), &mut value) },
            || name.to_owned(),
        )?;
        Ok(value)
    }
    /// Every fold of a splitter result.
    pub fn folds(&self) -> Result<Vec<Fold>, Error> {
        let mut n_folds = 0;
        check(
            unsafe { n4m_method_result_get_n_folds(self.ptr(), &mut n_folds) },
            None,
        )?;
        (0..n_folds)
            .map(|fold| {
                let (mut train, mut n_train, mut test, mut n_test) =
                    (ptr::null(), 0, ptr::null(), 0);
                check(
                    unsafe {
                        n4m_method_result_get_fold(
                            self.ptr(),
                            fold,
                            &mut train,
                            &mut n_train,
                            &mut test,
                            &mut n_test,
                        )
                    },
                    None,
                )?;
                Ok(Fold {
                    train: copy_borrowed(train, native_len(n_train, "fold size")?, "fold")?,
                    test: copy_borrowed(test, native_len(n_test, "fold size")?, "fold")?,
                })
            })
            .collect()
    }
}
impl Drop for MethodResult {
    fn drop(&mut self) {
        unsafe { n4m_method_result_destroy(self.raw.as_ptr()) }
    }
}

/// Runs a procedure (splitter, augmenter or generic) once; `None` uses every
/// default. Parameters and inputs are checked against the manifest natively.
pub fn run_procedure(
    ctx: &Context,
    method_id: &str,
    params: Option<&Params>,
    inputs: &FitInputs<'_>,
) -> Result<MethodResult, Error> {
    let index = method_index(method_id)?;
    let params = params.map_or(ptr::null(), |p| p.ptr().cast_const());
    let mut raw = ptr::null_mut();
    let status = inputs
        .with_raw(|fit| unsafe { n4m_procedure_run(ctx.ptr(), index, params, fit, &mut raw) });
    check(status, Some(ctx.ptr()))?;
    Ok(MethodResult {
        raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
        _thread_bound: PhantomData,
    })
}

/// Role a step plays in a [`RolePipeline`] (one `ROLE_*` bit).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleStepInfo {
    pub method_id: String,
    /// `ROLE_*` bit the step plays (PLS: transformer inside, regressor last).
    pub role: u32,
    /// Index among the stateful steps; `None` for a train-only sample filter.
    pub state_index: Option<usize>,
    /// The fitted state embeds training rows (export needs the opt-in).
    pub contains_training_rows: bool,
    /// Fitted widths; 0 while unfitted.
    pub n_features_in: usize,
    pub n_features_out: usize,
}

/// A native trained recipe of role steps (ABI 2.14, `n4m_role_pipeline_*`):
/// sample filters (training rows only), transformers / selectors, then one
/// regressor or classifier. Recipe validation, fit-input routing, the
/// feature-name check and the per-step N4ME states are native; class ids
/// stay integers as in [`Estimator`].
pub struct RolePipeline {
    raw: NonNull<RolePipelineRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl RolePipeline {
    /// Unfitted pipeline of `steps` (`method_id`, parameters or `None` for the
    /// defaults); refused natively unless the role order is valid.
    pub fn new(ctx: &Context, steps: &[(&str, Option<&Params>)]) -> Result<Self, Error> {
        ensure_abi()?;
        let ids = steps
            .iter()
            .map(|(id, _)| cstring(id, "method id"))
            .collect::<Result<Vec<_>, _>>()?;
        let id_ptrs: Vec<*const c_char> = ids.iter().map(|id| id.as_ptr()).collect();
        let params: Vec<*const ParamsRaw> = steps
            .iter()
            .map(|(_, p)| p.map_or(ptr::null(), |p| p.ptr().cast_const()))
            .collect();
        let n = i32::try_from(steps.len()).map_err(|_| invalid("too many steps"))?;
        let mut raw = ptr::null_mut();
        check(
            unsafe {
                n4m_role_pipeline_create(ctx.ptr(), n, id_ptrs.as_ptr(), params.as_ptr(), &mut raw)
            },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut RolePipelineRaw {
        self.raw.as_ptr()
    }
    /// Input column names (UTF-8, unique), set before fit or import; they are
    /// then checked by every operation given names.
    pub fn set_feature_names(&mut self, ctx: &Context, names: &[&str]) -> Result<(), Error> {
        let (_owned, ptrs) = c_strings(names)?;
        check(
            unsafe {
                n4m_role_pipeline_set_feature_names(
                    ctx.ptr(),
                    self.ptr(),
                    ptrs.as_ptr(),
                    names.len() as i64,
                )
            },
            Some(ctx.ptr()),
        )
    }
    /// Fits every step: `y` for a final regressor, `labels` (class ids) for a
    /// final classifier; the other inputs reach the steps that declare them.
    /// On failure the pipeline is unfitted.
    pub fn fit(&mut self, ctx: &Context, inputs: &FitInputs<'_>) -> Result<(), Error> {
        let status =
            inputs.with_raw(|raw| unsafe { n4m_role_pipeline_fit(ctx.ptr(), self.ptr(), raw) });
        check(status, Some(ctx.ptr()))
    }
    /// Rebuilds the fitted pipeline from one N4ME state per stateful step;
    /// states contradicting the recipe (count, method, parameters, role,
    /// widths) are refused.
    pub fn import_states(&mut self, ctx: &Context, states: &[&[u8]]) -> Result<(), Error> {
        let buffers: Vec<*const c_void> = states.iter().map(|s| s.as_ptr().cast()).collect();
        let sizes: Vec<usize> = states.iter().map(|s| s.len()).collect();
        let n = i32::try_from(states.len()).map_err(|_| invalid("too many states"))?;
        check(
            unsafe {
                n4m_role_pipeline_import_states(
                    ctx.ptr(),
                    self.ptr(),
                    n,
                    buffers.as_ptr(),
                    sizes.as_ptr(),
                )
            },
            Some(ctx.ptr()),
        )
    }
    pub fn is_fitted(&self) -> Result<bool, Error> {
        let mut fitted = 0;
        check(
            unsafe { n4m_role_pipeline_is_fitted(self.ptr(), &mut fitted) },
            None,
        )?;
        Ok(fitted != 0)
    }
    /// Every step, in recipe order.
    pub fn steps(&self) -> Result<Vec<RoleStepInfo>, Error> {
        let mut n = 0;
        check(
            unsafe { n4m_role_pipeline_n_steps(self.ptr(), &mut n) },
            None,
        )?;
        (0..n)
            .map(|step| {
                // All-zero is a valid value for every field.
                let mut raw: RolePipelineStepInfoV1Raw = unsafe { mem::zeroed() };
                raw.struct_size = mem::size_of::<RolePipelineStepInfoV1Raw>() as u32;
                check(
                    unsafe { n4m_role_pipeline_step_info_v1(self.ptr(), step, &mut raw) },
                    None,
                )?;
                Ok(RoleStepInfo {
                    method_id: static_str(raw.method_id)?,
                    role: raw.role,
                    state_index: usize::try_from(raw.state_index).ok(),
                    contains_training_rows: raw.contains_training_rows != 0,
                    n_features_in: native_len(raw.n_features_in, "step width")?,
                    n_features_out: native_len(raw.n_features_out, "step width")?,
                })
            })
            .collect()
    }
    /// Input width of the fitted pipeline.
    pub fn n_features_in(&self) -> Result<usize, Error> {
        let mut n = 0;
        check(
            unsafe { n4m_role_pipeline_n_features_in(self.ptr(), &mut n) },
            None,
        )?;
        native_len(n, "input width")
    }
    /// Stored input column names (empty: positional).
    pub fn feature_names(&self) -> Result<Vec<String>, Error> {
        let mut n = 0;
        check(
            unsafe { n4m_role_pipeline_n_feature_names(self.ptr(), &mut n) },
            None,
        )?;
        (0..n)
            .map(|k| {
                let mut name = ptr::null();
                check(
                    unsafe { n4m_role_pipeline_feature_name(self.ptr(), k, &mut name) },
                    None,
                )?;
                static_str(name)
            })
            .collect()
    }
    /// Refuses a width mismatch and, when names are stored and given, a
    /// renamed or reordered column.
    pub fn check_features(
        &self,
        ctx: &Context,
        n_columns: usize,
        names: Option<&[&str]>,
    ) -> Result<(), Error> {
        let owned = names.map(c_strings).transpose()?;
        let names_ptr = owned.as_ref().map_or(ptr::null(), |(_, p)| p.as_ptr());
        check(
            unsafe {
                n4m_role_pipeline_check_features(ctx.ptr(), self.ptr(), n_columns as i64, names_ptr)
            },
            Some(ctx.ptr()),
        )
    }
    fn width(
        &self,
        read: impl FnOnce(*const RolePipelineRaw, *mut i64) -> i32,
    ) -> Result<usize, Error> {
        let mut value = 0;
        check(read(self.ptr(), &mut value), None)?;
        native_len(value, "pipeline width")
    }
    /// Checks the columns of `x`, then runs `op` into a `rows x width` output.
    fn matrix_op(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
        width: usize,
        op: impl FnOnce(*const MatrixView, *mut MatrixView) -> i32,
    ) -> Result<Matrix, Error> {
        self.check_features(ctx, x.cols(), names)?;
        let x_raw = x.raw();
        matrix_output(x.rows(), width, |out| op(&x_raw, out), ctx)
    }
    /// Rows after the transformers and selectors (the final step's input).
    pub fn transform(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
    ) -> Result<Matrix, Error> {
        let cols = self.width(|p, out| unsafe { n4m_role_pipeline_transform_cols(p, out) })?;
        self.matrix_op(ctx, x, names, cols, |x, out| unsafe {
            n4m_role_pipeline_transform(ctx.ptr(), self.ptr(), x, out)
        })
    }
    fn n_outputs(&self) -> Result<usize, Error> {
        self.width(|p, out| unsafe { n4m_role_pipeline_n_outputs(p, out) })
    }
    /// Predictions of a final regressor.
    pub fn predict(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
    ) -> Result<Matrix, Error> {
        self.matrix_op(ctx, x, names, self.n_outputs()?, |x, out| unsafe {
            n4m_role_pipeline_predict(ctx.ptr(), self.ptr(), x, out)
        })
    }
    /// Class scores of a final classifier, one column per class.
    pub fn decision_function(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
    ) -> Result<Matrix, Error> {
        self.matrix_op(ctx, x, names, self.n_outputs()?, |x, out| unsafe {
            n4m_role_pipeline_decision_function(ctx.ptr(), self.ptr(), x, out)
        })
    }
    /// Class probabilities, for final classifiers that define them.
    pub fn predict_proba(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
    ) -> Result<Matrix, Error> {
        self.matrix_op(ctx, x, names, self.n_outputs()?, |x, out| unsafe {
            n4m_role_pipeline_predict_proba(ctx.ptr(), self.ptr(), x, out)
        })
    }
    /// Class ids predicted by a final classifier.
    pub fn predict_labels(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        names: Option<&[&str]>,
    ) -> Result<Vec<i64>, Error> {
        self.check_features(ctx, x.cols(), names)?;
        let x_raw = x.raw();
        let mut out = vec![0; x.rows()];
        check(
            unsafe {
                n4m_role_pipeline_predict_labels(
                    ctx.ptr(),
                    self.ptr(),
                    &x_raw,
                    out.as_mut_ptr(),
                    out.len() as i64,
                )
            },
            Some(ctx.ptr()),
        )?;
        Ok(out)
    }
    /// Class ids of a final classifier, ascending.
    pub fn classes(&self) -> Result<Vec<i64>, Error> {
        read_counted(
            |out, capacity, count| unsafe {
                n4m_role_pipeline_classes(self.ptr(), out, capacity, count)
            },
            "classes",
        )
    }
    /// N4ME state of every stateful step, in step order. States embedding
    /// training rows export only with `allow_training_rows`.
    pub fn export_states(
        &self,
        ctx: &Context,
        allow_training_rows: bool,
    ) -> Result<Vec<Vec<u8>>, Error> {
        let flags = if allow_training_rows {
            EXPORT_ALLOW_TRAINING_ROWS
        } else {
            0
        };
        let mut n = 0;
        check(
            unsafe { n4m_role_pipeline_n_states(self.ptr(), &mut n) },
            None,
        )?;
        (0..n)
            .map(|state| {
                let mut size = 0;
                check(
                    unsafe {
                        n4m_role_pipeline_export_state_size(
                            ctx.ptr(),
                            self.ptr(),
                            state,
                            flags,
                            &mut size,
                        )
                    },
                    Some(ctx.ptr()),
                )?;
                let mut out = vec![0u8; size];
                let mut written = 0;
                check(
                    unsafe {
                        n4m_role_pipeline_export_state_to_buffer(
                            ctx.ptr(),
                            self.ptr(),
                            state,
                            flags,
                            out.as_mut_ptr().cast(),
                            out.len(),
                            &mut written,
                        )
                    },
                    Some(ctx.ptr()),
                )?;
                if written > out.len() {
                    return Err(corrupt("native N4ME wrote beyond its allocation"));
                }
                out.truncate(written);
                Ok(out)
            })
            .collect()
    }
}
impl Drop for RolePipeline {
    fn drop(&mut self) {
        unsafe { n4m_role_pipeline_destroy(self.ptr()) }
    }
}

/// NUL-terminated copies of `values` and their pointer array.
fn c_strings(values: &[&str]) -> Result<(Vec<CString>, Vec<*const c_char>), Error> {
    let owned = values
        .iter()
        .map(|v| cstring(v, "feature name"))
        .collect::<Result<Vec<_>, _>>()?;
    let ptrs = owned.iter().map(|v| v.as_ptr()).collect();
    Ok((owned, ptrs))
}
