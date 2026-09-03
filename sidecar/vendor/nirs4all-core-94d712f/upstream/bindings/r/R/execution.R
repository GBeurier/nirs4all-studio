NIRS4ALL_KENNARD_STONE_CLASSES <- c(
  "nirs4all.operators.splitters.KennardStoneSplitter",
  "nirs4all.operators.splitters.splitters.KennardStoneSplitter"
)

NIRS4ALL_SNV_CLASSES <- c(
  "nirs4all.operators.transforms.SNV",
  "nirs4all.operators.transforms.StandardNormalVariate",
  "nirs4all.operators.transforms.scalers.StandardNormalVariate"
)

NIRS4ALL_SAVGOL_CLASSES <- c(
  "nirs4all.operators.transforms.SavitzkyGolay",
  "nirs4all.operators.transforms.nirs.SavitzkyGolay"
)

NIRS4ALL_PLS_CLASSES <- c(
  "sklearn.cross_decomposition.PLSRegression",
  "sklearn.cross_decomposition._pls.PLSRegression"
)

nirs4all_run_portable_pipeline <- function(source, dataset) {
  engine <- methods()
  required <- c("kennard_stone_split", "snv_transform", "savgol_transform",
                "n4m_fit", "n4m_predict")
  missing <- required[!vapply(required, exists, logical(1), envir = engine, inherits = FALSE)]
  if (length(missing) > 0L) {
    stop(sprintf(
      "The installed nirs4all methods R binding does not expose: %s",
      paste(missing, collapse = ", ")
    ), call. = FALSE)
  }

  definition <- nirs4all_load_pipeline(source)
  data <- coerce_portable_dataset(dataset)
  plan <- parse_execution_plan(definition)

  split <- compute_portable_split(plan$splitter, data$X, engine)
  train_rows <- split$trainIndices + 1L
  test_rows <- split$testIndices + 1L
  X_train <- data$X[train_rows, , drop = FALSE]
  X_test <- data$X[test_rows, , drop = FALSE]
  y_train <- data$y[train_rows]
  y_test <- data$y[test_rows]

  preprocessing <- list()
  for (step in plan$preprocessing) {
    if (identical(step$type, "StandardNormalVariate")) {
      X_train <- engine$snv_transform(X_train, ddof = 0L)
      X_test <- engine$snv_transform(X_test, ddof = 0L)
    } else if (identical(step$type, "SavitzkyGolay")) {
      params <- step$params
      X_train <- engine$savgol_transform(
        X_train,
        window_length = params[[1]],
        polyorder = params[[2]],
        deriv = params[[3]],
        delta = 1.0,
        mode = savgol_mode_name(params[[4]]),
        cval = params[[5]]
      )
      X_test <- engine$savgol_transform(
        X_test,
        window_length = params[[1]],
        polyorder = params[[2]],
        deriv = params[[3]],
        delta = 1.0,
        mode = savgol_mode_name(params[[4]]),
        cval = params[[5]]
      )
    } else {
      stop(sprintf("Unsupported portable preprocessing step: %s", step$type), call. = FALSE)
    }
    preprocessing[[length(preprocessing) + 1L]] <- list(type = step$type, params = step$params)
  }

  variants <- lapply(plan$n_components, function(n_components) {
    model <- engine$n4m_fit(
      X_train,
      y_train,
      algo = "pls_simpls",
      n_components = as.integer(n_components),
      center_x = TRUE,
      scale_x = TRUE,
      center_y = TRUE,
      scale_y = TRUE
    )
    predictions <- as.numeric(engine$n4m_predict(model, X_test))
    diff <- predictions - y_test
    list(
      n_components = as.integer(n_components),
      rmse = sqrt(mean(diff * diff)),
      predictions = predictions
    )
  })
  rmses <- vapply(variants, function(item) item$rmse, numeric(1))

  list(
    name = definition$name,
    rows = as.integer(nrow(data$X)),
    cols = as.integer(ncol(data$X)),
    split = split,
    preprocessing = preprocessing,
    variants = variants,
    selected = variants[[which.min(rmses)]],
    targets = as.numeric(y_test)
  )
}

nirs4all_parse_execution_plan <- function(source) {
  parse_execution_plan(nirs4all_load_pipeline(source))
}

coerce_portable_dataset <- function(dataset) {
  if (!is.list(dataset)) {
    stop("Portable execution requires a list dataset.", call. = FALSE)
  }

  rows <- dataset$rows
  if (is.null(rows)) rows <- dataset$n_samples
  cols <- dataset$cols
  if (is.null(cols)) cols <- dataset$n_features

  X <- dataset$X
  if (is.null(X)) stop("Dataset must contain X.", call. = FALSE)
  if (is.matrix(X)) {
    X <- X
  } else if (is.list(X) && length(X) > 0L && is.list(X[[1L]])) {
    X <- do.call(rbind, lapply(X, as.numeric))
  } else {
    if (is.null(rows) || is.null(cols)) {
      stop("Flat dataset X requires rows/cols or n_samples/n_features.", call. = FALSE)
    }
    X <- matrix(as.numeric(unlist(X, use.names = FALSE)),
                nrow = as.integer(rows),
                ncol = as.integer(cols),
                byrow = TRUE)
  }
  storage.mode(X) <- "double"

  y <- dataset$y
  if (is.null(y)) stop("Dataset must contain y.", call. = FALSE)
  y <- as.numeric(unlist(y, use.names = FALSE))
  if (nrow(X) != length(y)) {
    stop(sprintf("X rows (%d) must match y rows (%d).", nrow(X), length(y)), call. = FALSE)
  }
  list(X = X, y = y)
}

parse_execution_plan <- function(definition) {
  splitter <- NULL
  preprocessing <- list()
  model_step <- NULL

  for (step in definition$pipeline) {
    if (!is.list(step)) {
      stop("Portable pipeline steps must be mapping/list objects.", call. = FALSE)
    }

    class_name <- step$class
    if (is.character(class_name) && length(class_name) == 1L) {
      if (class_name %in% NIRS4ALL_KENNARD_STONE_CLASSES) {
        splitter <- list(type = "KennardStone", params = step$params %||% list())
      } else if (class_name %in% NIRS4ALL_SNV_CLASSES) {
        preprocessing[[length(preprocessing) + 1L]] <- list(
          type = "StandardNormalVariate",
          params = list()
        )
      } else if (class_name %in% NIRS4ALL_SAVGOL_CLASSES) {
        preprocessing[[length(preprocessing) + 1L]] <- list(
          type = "SavitzkyGolay",
          params = savgol_params(step$params %||% list())
        )
      } else {
        stop(sprintf("Portable execution does not support step class '%s'.", class_name), call. = FALSE)
      }
      next
    }

    if (is.list(step$model)) {
      if (!is.null(model_step)) {
        stop("Portable execution supports exactly one model step.", call. = FALSE)
      }
      model_step <- step
      next
    }

    stop("Portable execution does not support pipeline step.", call. = FALSE)
  }

  if (is.null(model_step)) {
    stop("Portable execution requires a PLSRegression model step.", call. = FALSE)
  }
  model_class <- model_step$model$class
  if (!is.character(model_class) || !(model_class %in% NIRS4ALL_PLS_CLASSES)) {
    stop(sprintf("Portable execution does not support model class '%s'.", model_class), call. = FALSE)
  }

  list(
    splitter = splitter,
    preprocessing = preprocessing,
    n_components = component_values(model_step)
  )
}

compute_portable_split <- function(splitter, X, engine) {
  if (is.null(splitter)) {
    indices <- seq.int(0L, nrow(X) - 1L)
    return(list(kind = "all", trainIndices = indices, testIndices = indices))
  }
  split <- engine$kennard_stone_split(
    X,
    test_size = as.numeric(splitter$params$test_size %||% 0.25),
    zero_based = TRUE
  )
  list(
    kind = "KennardStone",
    trainIndices = as.integer(split$train),
    testIndices = as.integer(split$test)
  )
}

savgol_params <- function(params) {
  delta <- numeric_param(params$delta, 1.0, "delta")
  if (!identical(delta, 1.0) && !isTRUE(all.equal(delta, 1.0))) {
    stop("Portable Savitzky-Golay execution currently supports delta=1 only.", call. = FALSE)
  }
  list(
    integer_param(params$window_length %||% params$window, 11L, "window_length", min = 1L),
    integer_param(params$polyorder, 3L, "polyorder", min = 0L),
    integer_param(params$deriv, 0L, "deriv", min = 0L),
    savgol_mode(params$mode %||% "interp"),
    numeric_param(params$cval, 0.0, "cval")
  )
}

savgol_mode <- function(value) {
  modes <- c(mirror = 0L, constant = 1L, nearest = 2L, wrap = 3L, interp = 4L)
  if (is.character(value)) {
    key <- tolower(value[[1L]])
    if (key %in% names(modes)) {
      return(unname(modes[[key]]))
    }
    stop(sprintf("Unsupported Savitzky-Golay mode: %s", value[[1L]]), call. = FALSE)
  }
  mode <- integer_param(value, NULL, "mode", min = 0L)
  if (!is.na(mode) && mode >= 0L && mode <= 4L) {
    return(mode)
  }
  stop(sprintf("Unsupported Savitzky-Golay mode: %s", as.character(value)), call. = FALSE)
}

savgol_mode_name <- function(value) {
  modes <- c("mirror", "constant", "nearest", "wrap", "interp")
  modes[[savgol_mode(value) + 1L]]
}

component_values <- function(step) {
  range_values <- step$`_range_`
  if (!is.null(range_values)) {
    if (!identical(step$param, "n_components")) {
      stop("Portable execution only supports _range_ sweeps over 'n_components'.", call. = FALSE)
    }
    raw_values <- unlist(range_values, use.names = FALSE)
    if (length(raw_values) != 3L) {
      stop("Invalid n_components _range_; expected [start, stop, positive_step].", call. = FALSE)
    }
    values <- c(
      integer_param(raw_values[[1L]], NULL, "n_components range start", min = 1L),
      integer_param(raw_values[[2L]], NULL, "n_components range stop", min = 1L),
      integer_param(raw_values[[3L]], NULL, "n_components range step", min = 1L)
    )
    if (values[[1L]] > values[[2L]]) {
      stop("Invalid n_components _range_; start must be <= stop.", call. = FALSE)
    }
    return(seq.int(values[[1L]], values[[2L]], by = values[[3L]]))
  }
  params <- step$model$params %||% list()
  integer_param(params$n_components, 2L, "n_components", min = 1L)
}

numeric_param <- function(value, fallback, name) {
  if (is.null(value)) {
    if (is.null(fallback)) {
      stop(sprintf("Parameter '%s' must be a finite number.", name), call. = FALSE)
    }
    return(as.numeric(fallback))
  }
  if (is.logical(value) || length(value) != 1L) {
    stop(sprintf("Parameter '%s' must be a finite number.", name), call. = FALSE)
  }
  number <- if (is.numeric(value)) {
    as.numeric(value[[1L]])
  } else if (is.character(value) && nzchar(trimws(value[[1L]]))) {
    suppressWarnings(as.numeric(value[[1L]]))
  } else {
    NA_real_
  }
  if (!is.finite(number)) {
    stop(sprintf("Parameter '%s' must be a finite number.", name), call. = FALSE)
  }
  number
}

integer_param <- function(value, fallback, name, min = NULL) {
  number <- numeric_param(value, fallback, name)
  if (number != floor(number)) {
    stop(sprintf("Parameter '%s' must be an integer.", name), call. = FALSE)
  }
  if (number < -.Machine$integer.max || number > .Machine$integer.max) {
    stop(sprintf("Parameter '%s' is outside R integer range.", name), call. = FALSE)
  }
  result <- as.integer(number)
  if (!is.null(min) && result < min) {
    stop(sprintf("Parameter '%s' must be >= %d.", name, as.integer(min)), call. = FALSE)
  }
  result
}

`%||%` <- function(lhs, rhs) {
  if (is.null(lhs)) rhs else lhs
}
