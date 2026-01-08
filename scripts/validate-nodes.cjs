#!/usr/bin/env node
/**
 * Node Definition Validation Script
 *
 * Validates all node definition JSON files against the JSON Schema at build time.
 * Can be run as part of CI/CD or pre-commit hooks.
 *
 * Usage:
 *   node scripts/validate-nodes.cjs
 *   npm run validate:nodes
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation errors found
 *
 * @see docs/_internals/implementation_roadmap.md Task 2.13
 */

const fs = require('fs');
const path = require('path');

function safeGet(obj, pathParts, fallback) {
  let cur = obj;
  for (const p of pathParts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return fallback;
    cur = cur[p];
  }
  return cur ?? fallback;
}

function asStringArray(value) {
  return Array.isArray(value) && value.every((x) => typeof x === 'string') ? value : null;
}

// Simple JSON Schema validator (basic implementation)
// For production, consider using 'ajv' package

/**
 * Basic schema validation
 */
function validateAgainstSchema(data, schema, filePath) {
  const errors = [];

  if (Array.isArray(data)) {
    // Validate array items
    data.forEach((item, index) => {
      const itemErrors = validateNode(item, schema);
      itemErrors.forEach(err => {
        errors.push(`[${index}] ${err}`);
      });
    });
  } else {
    errors.push(...validateNode(data, schema));
  }

  return errors;
}

/**
 * Validate a single node definition
 */
function validateNode(node, schema) {
  const errors = [];

  const schemaTypeEnum = asStringArray(safeGet(schema, ['definitions', 'NodeType', 'enum'], null));
  const schemaSourceEnum = asStringArray(safeGet(schema, ['properties', 'source', 'enum'], null));
  const schemaContainerTypeEnum = asStringArray(safeGet(schema, ['properties', 'containerType', 'enum'], null));
  const schemaIdPattern = safeGet(schema, ['properties', 'id', 'pattern'], null);

  // Required fields
  const requiredFields = ['id', 'name', 'type', 'description', 'parameters', 'source'];
  for (const field of requiredFields) {
    if (node[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate id format
  if (node.id && typeof node.id === 'string') {
    const pattern = typeof schemaIdPattern === 'string' && schemaIdPattern.length > 0
      ? new RegExp(schemaIdPattern)
      : /^[a-z_]+\.[a-z0-9_]+$/;

    if (!pattern.test(node.id)) {
      errors.push(`Invalid id format: ${node.id} (expected: type.snake_case)`);
    }
  }

  // Validate type
  const validTypes = schemaTypeEnum || [
    'preprocessing', 'y_processing', 'splitting', 'model', 'generator',
    'branch', 'merge', 'filter', 'augmentation', 'sample_augmentation',
    'feature_augmentation', 'sample_filter', 'concat_transform', 'sequential', 'chart', 'comment'
  ];
  if (node.type && !validTypes.includes(node.type)) {
    errors.push(`Invalid type: ${node.type}`);
  }

  // Validate source
  const validSources = schemaSourceEnum || ['sklearn', 'nirs4all', 'custom', 'editor'];
  if (node.source && !validSources.includes(node.source)) {
    errors.push(`Invalid source: ${node.source}`);
  }

  // Validate containerType when present
  if (node.containerType !== undefined) {
    if (typeof node.containerType !== 'string') {
      errors.push('containerType must be a string');
    } else if (schemaContainerTypeEnum && !schemaContainerTypeEnum.includes(node.containerType)) {
      errors.push(`Invalid containerType: ${node.containerType}`);
    }
  }

  // Validate childTypes when present
  if (node.childTypes !== undefined) {
    if (!Array.isArray(node.childTypes)) {
      errors.push('childTypes must be an array');
    } else {
      node.childTypes.forEach((t, idx) => {
        if (typeof t !== 'string' || !validTypes.includes(t)) {
          errors.push(`childTypes[${idx}] invalid: ${String(t)}`);
        }
      });
    }
  }

  // Validate parameters array
  if (node.parameters && !Array.isArray(node.parameters)) {
    errors.push(`Parameters must be an array`);
  } else if (node.parameters) {
    node.parameters.forEach((param, index) => {
      const paramErrors = validateParameter(param);
      paramErrors.forEach(err => {
        errors.push(`parameters[${index}]: ${err}`);
      });
    });
  }

  // Validate tags array
  if (node.tags !== undefined && !Array.isArray(node.tags)) {
    errors.push(`Tags must be an array`);
  }

  // Validate legacyClassPaths array
  if (node.legacyClassPaths !== undefined && !Array.isArray(node.legacyClassPaths)) {
    errors.push(`legacyClassPaths must be an array`);
  }

  return errors;
}

/**
 * Validate a parameter definition
 */
function validateParameter(param) {
  const errors = [];

  // Load parameter schema lazily (resolved once in main)
  const validParamTypes = globalThis.__N4A_VALID_PARAM_TYPES || ['int', 'float', 'bool', 'string', 'select', 'range', 'array', 'object'];

  // Required fields
  if (!param.name || typeof param.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  if (!param.type || typeof param.type !== 'string') {
    errors.push('Missing or invalid type');
  }

  // Validate type
  if (param.type && !validParamTypes.includes(param.type)) {
    errors.push(`Invalid parameter type: ${param.type}`);
  }

  // Select type must have options
  if (param.type === 'select' && !Array.isArray(param.options)) {
    errors.push('Select type must have options array');
  }

  // Validate min/max for numeric types
  if (param.min !== undefined && typeof param.min !== 'number') {
    errors.push('min must be a number');
  }
  if (param.max !== undefined && typeof param.max !== 'number') {
    errors.push('max must be a number');
  }
  if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
    errors.push('min must be less than or equal to max');
  }

  // Validate sweepPresets
  if (param.sweepPresets !== undefined && !Array.isArray(param.sweepPresets)) {
    errors.push('sweepPresets must be an array');
  }

  return errors;
}

/**
 * Find all JSON files in a directory recursively
 */
function findJsonFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      findJsonFiles(fullPath, files);
    } else if (item.endsWith('.json') && !item.includes('schema')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main validation function
 */
function main() {
  console.log('🔍 Validating node definitions...\n');

  const nodesDir = path.join(__dirname, '..', 'src', 'data', 'nodes');
  const definitionsDir = path.join(nodesDir, 'definitions');
  const schemaPath = path.join(nodesDir, 'schema', 'node.schema.json');
  const paramSchemaPath = path.join(nodesDir, 'schema', 'parameter.schema.json');

  // Check if directories exist
  if (!fs.existsSync(definitionsDir)) {
    console.error('❌ Definitions directory not found:', definitionsDir);
    process.exit(1);
  }

  // Load schema
  let schema = {};
  if (fs.existsSync(schemaPath)) {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    console.log('📋 Loaded schema from:', path.relative(process.cwd(), schemaPath));
  } else {
    console.warn('⚠️  Schema file not found, using basic validation');
  }

  // Load parameter schema (for param.type enum)
  if (fs.existsSync(paramSchemaPath)) {
    const paramSchema = JSON.parse(fs.readFileSync(paramSchemaPath, 'utf-8'));
    const enumList = safeGet(paramSchema, ['properties', 'type', 'enum'], null);
    const parsed = asStringArray(enumList);
    if (parsed) {
      globalThis.__N4A_VALID_PARAM_TYPES = parsed;
    }
    console.log('📋 Loaded parameter schema from:', path.relative(process.cwd(), paramSchemaPath));
  }

  // Find all JSON files
  const jsonFiles = findJsonFiles(definitionsDir);
  console.log(`📁 Found ${jsonFiles.length} JSON files\n`);

  let totalNodes = 0;
  let totalErrors = 0;
  const fileResults = [];

  for (const filePath of jsonFiles) {
    const relativePath = path.relative(process.cwd(), filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const errors = validateAgainstSchema(data, schema, filePath);
      const nodeCount = Array.isArray(data) ? data.length : 1;
      totalNodes += nodeCount;

      if (errors.length > 0) {
        totalErrors += errors.length;
        fileResults.push({
          file: relativePath,
          status: 'error',
          nodeCount,
          errors,
        });
      } else {
        fileResults.push({
          file: relativePath,
          status: 'ok',
          nodeCount,
          errors: [],
        });
      }
    } catch (e) {
      totalErrors++;
      fileResults.push({
        file: relativePath,
        status: 'error',
        nodeCount: 0,
        errors: [`Parse error: ${e.message}`],
      });
    }
  }

  // Print results
  console.log('Results:\n');

  for (const result of fileResults) {
    const icon = result.status === 'ok' ? '✅' : '❌';
    console.log(`${icon} ${result.file} (${result.nodeCount} nodes)`);

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.log(`   ⚠️  ${error}`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Summary: ${totalNodes} nodes in ${jsonFiles.length} files`);

  if (totalErrors > 0) {
    console.log(`❌ ${totalErrors} validation errors found`);
    process.exit(1);
  } else {
    console.log('✅ All validations passed!');
    process.exit(0);
  }
}

main();
