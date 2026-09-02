NIRS4ALL_PORTABLE_OPERATOR_CLASSES <- c(
  "nirs4all.operators.splitters.KennardStoneSplitter",
  "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
  "nirs4all.operators.transforms.SNV",
  "nirs4all.operators.transforms.StandardNormalVariate",
  "nirs4all.operators.transforms.scalers.StandardNormalVariate",
  "nirs4all.operators.transforms.SavitzkyGolay",
  "nirs4all.operators.transforms.nirs.SavitzkyGolay",
  "sklearn.cross_decomposition.PLSRegression",
  "sklearn.cross_decomposition._pls.PLSRegression"
)

nirs4all_load_pipeline <- function(source) {
  data <- parse_pipeline_source(source)
  data <- normalize_pipeline_root(data)

  if (!is.list(data$pipeline)) {
    stop("Pipeline definition key 'pipeline' or 'steps' must contain a list of steps.", call. = FALSE)
  }

  pipeline <- strip_pipeline_comments(data$pipeline)
  unsupported <- setdiff(unique(nirs4all_portable_class_names(pipeline)), NIRS4ALL_PORTABLE_OPERATOR_CLASSES)
  if (length(unsupported) > 0L) {
    stop(
      sprintf(
        "Pipeline uses operators outside the current nirs4all-core portable subset: %s",
        paste(unsupported, collapse = ", ")
      ),
      call. = FALSE
    )
  }

  random_state <- data$random_state
  if (is.null(random_state) || is.logical(random_state)) {
    random_state <- NULL
  } else if (!is.numeric(random_state) || length(random_state) != 1L || random_state != as.integer(random_state)) {
    stop("'random_state' must be an integer when provided.", call. = FALSE)
  } else {
    random_state <- as.integer(random_state)
  }

  result <- list(
    name = if (!is.null(data$name)) as.character(data$name) else "pipeline",
    description = if (!is.null(data$description)) as.character(data$description) else "",
    random_state = random_state,
    pipeline = pipeline
  )
  class(result) <- "nirs4all_pipeline_definition"
  result
}

nirs4all_portable_class_names <- function(definition) {
  if (inherits(definition, "nirs4all_pipeline_definition")) {
    root <- definition$pipeline
  } else if (is_named_list(definition) && !is.null(definition$pipeline)) {
    root <- definition$pipeline
  } else {
    root <- definition
  }
  collect_pipeline_classes(root)
}

parse_pipeline_source <- function(source) {
  if (is.character(source) && length(source) == 1L) {
    path <- path_like_source(source)
    if (!is.null(path)) {
      if (!file.exists(path)) {
        stop(sprintf("Configuration file does not exist: %s", path), call. = FALSE)
      }
      return(parse_pipeline_text(paste(readLines(path, warn = FALSE), collapse = "\n"), tolower(tools::file_ext(path))))
    }
    return(parse_pipeline_text(source, ""))
  }
  source
}

path_like_source <- function(source) {
  if (grepl("[\r\n]", source)) {
    return(NULL)
  }
  extension <- tolower(tools::file_ext(source))
  if (extension %in% c("json", "yaml", "yml") || file.exists(source)) {
    return(source)
  }
  NULL
}

parse_pipeline_text <- function(text, extension) {
  if (identical(extension, "json")) {
    return(jsonlite::fromJSON(text, simplifyVector = FALSE))
  }
  if (extension %in% c("yaml", "yml")) {
    return(yaml::yaml.load(text))
  }

  parsed <- tryCatch(jsonlite::fromJSON(text, simplifyVector = FALSE), error = identity)
  if (!inherits(parsed, "error")) {
    return(parsed)
  }
  yaml::yaml.load(text)
}

normalize_pipeline_root <- function(data) {
  if (is.null(data)) {
    stop("Pipeline definition must be a list or mapping with a 'pipeline'/'steps' key.", call. = FALSE)
  }

  if (!is_named_list(data)) {
    return(list(pipeline = data))
  }

  if (!is.null(data$pipeline)) {
    return(data)
  }
  if (!is.null(data$steps)) {
    data$pipeline <- data$steps
    return(data)
  }
  stop(
    "Invalid pipeline definition format. Expected a list or mapping with a 'pipeline' or 'steps' key.",
    call. = FALSE
  )
}

strip_pipeline_comments <- function(value) {
  if (!is.list(value)) {
    return(value)
  }

  if (!is_named_list(value)) {
    kept <- lapply(value[!vapply(value, is_comment_step, logical(1))], strip_pipeline_comments)
    return(kept)
  }

  value[["_comment"]] <- NULL
  lapply(value, strip_pipeline_comments)
}

is_comment_step <- function(value) {
  is_named_list(value) && identical(names(value), "_comment")
}

collect_pipeline_classes <- function(value) {
  classes <- character()
  collect <- function(item) {
    if (!is.list(item)) {
      return()
    }
    if (is_named_list(item) && is.character(item$class) && length(item$class) == 1L) {
      classes <<- c(classes, item$class)
    }
    invisible(lapply(item, collect))
  }
  collect(value)
  classes
}

is_named_list <- function(value) {
  is.list(value) && !is.null(names(value)) && any(nzchar(names(value)))
}
