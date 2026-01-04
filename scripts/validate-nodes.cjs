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

  // Required fields
  const requiredFields = ['id', 'name', 'type', 'description', 'parameters', 'source'];
  for (const field of requiredFields) {
    if (node[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate id format
  if (node.id && typeof node.id === 'string') {
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(node.id)) {
      errors.push(`Invalid id format: ${node.id} (expected: type.snake_case)`);
    }
  }

  // Validate type
  const validTypes = [
    'preprocessing', 'y_processing', 'splitting', 'model', 'generator',
    'branch', 'merge', 'filter', 'augmentation', 'sample_augmentation',
    'feature_augmentation', 'sample_filter', 'concat_transform', 'chart', 'comment'
  ];
  if (node.type && !validTypes.includes(node.type)) {
    errors.push(`Invalid type: ${node.type}`);
  }

  // Validate source
  const validSources = ['sklearn', 'nirs4all', 'editor', 'custom'];
  if (node.source && !validSources.includes(node.source)) {
    errors.push(`Invalid source: ${node.source}`);
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

  // Required fields
  if (!param.name || typeof param.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  if (!param.type || typeof param.type !== 'string') {
    errors.push('Missing or invalid type');
  }

  // Validate type
  const validParamTypes = ['int', 'float', 'bool', 'string', 'select', 'array', 'object'];
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
