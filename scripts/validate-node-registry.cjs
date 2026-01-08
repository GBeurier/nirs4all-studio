#!/usr/bin/env node
/**
 * Validate node registry JSON files (NodeDefinition[]) against the schema.
 *
 * Usage:
 *   node scripts/validate-node-registry.cjs [path]
 *
 * If [path] is a directory, validates all *.json files in it.
 * If [path] is a file, validates just that file.
 * Defaults to: public/node-registry
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

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateParameter(param) {
  const errors = [];
  const validParamTypes = globalThis.__N4A_VALID_PARAM_TYPES || ['int', 'float', 'bool', 'string', 'select', 'range', 'array', 'object'];

  if (!param || typeof param !== 'object') {
    return ['Parameter must be an object'];
  }

  if (!param.name || typeof param.name !== 'string') {
    errors.push('Missing or invalid name');
  }

  if (!param.type || typeof param.type !== 'string') {
    errors.push('Missing or invalid type');
  }

  if (param.type && !validParamTypes.includes(param.type)) {
    errors.push(`Invalid parameter type: ${param.type}`);
  }

  if (param.type === 'select' && !Array.isArray(param.options)) {
    errors.push('Select type must have options array');
  }

  if (param.min !== undefined && typeof param.min !== 'number') {
    errors.push('min must be a number');
  }
  if (param.max !== undefined && typeof param.max !== 'number') {
    errors.push('max must be a number');
  }
  if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
    errors.push('min must be <= max');
  }

  if (param.sweepPresets !== undefined && !Array.isArray(param.sweepPresets)) {
    errors.push('sweepPresets must be an array');
  }

  return errors;
}

function validateNode(node, schema) {
  const errors = [];

  const schemaTypeEnum = asStringArray(safeGet(schema, ['definitions', 'NodeType', 'enum'], null));
  const schemaSourceEnum = asStringArray(safeGet(schema, ['properties', 'source', 'enum'], null));
  const schemaContainerTypeEnum = asStringArray(safeGet(schema, ['properties', 'containerType', 'enum'], null));
  const schemaIdPattern = safeGet(schema, ['properties', 'id', 'pattern'], null);

  const requiredFields = ['id', 'name', 'type', 'description', 'parameters', 'source'];
  for (const field of requiredFields) {
    if (node?.[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (node?.id && typeof node.id === 'string') {
    const pattern = typeof schemaIdPattern === 'string' && schemaIdPattern.length > 0
      ? new RegExp(schemaIdPattern)
      : /^[a-z_]+\.[a-z0-9_]+$/;

    if (!pattern.test(node.id)) {
      errors.push(`Invalid id format: ${node.id} (expected: type.snake_case)`);
    }
  }

  const validTypes = schemaTypeEnum || [];
  if (node?.type && validTypes.length > 0 && !validTypes.includes(node.type)) {
    errors.push(`Invalid type: ${node.type}`);
  }

  const validSources = schemaSourceEnum || [];
  if (node?.source && validSources.length > 0 && !validSources.includes(node.source)) {
    errors.push(`Invalid source: ${node.source}`);
  }

  if (node?.containerType !== undefined) {
    if (typeof node.containerType !== 'string') {
      errors.push('containerType must be a string');
    } else if (schemaContainerTypeEnum && !schemaContainerTypeEnum.includes(node.containerType)) {
      errors.push(`Invalid containerType: ${node.containerType}`);
    }
  }

  if (node?.childTypes !== undefined) {
    if (!Array.isArray(node.childTypes)) {
      errors.push('childTypes must be an array');
    } else {
      node.childTypes.forEach((t, idx) => {
        if (typeof t !== 'string' || (validTypes.length > 0 && !validTypes.includes(t))) {
          errors.push(`childTypes[${idx}] invalid: ${String(t)}`);
        }
      });
    }
  }

  if (node?.parameters && !Array.isArray(node.parameters)) {
    errors.push('parameters must be an array');
  } else if (Array.isArray(node?.parameters)) {
    node.parameters.forEach((param, idx) => {
      const paramErrors = validateParameter(param);
      paramErrors.forEach((e) => errors.push(`parameters[${idx}]: ${e}`));
    });
  }

  if (node?.tags !== undefined && !Array.isArray(node.tags)) {
    errors.push('tags must be an array');
  }

  if (node?.legacyClassPaths !== undefined && !Array.isArray(node.legacyClassPaths)) {
    errors.push('legacyClassPaths must be an array');
  }

  return errors;
}

function validateRegistryData(data, schema, filePath) {
  const errors = [];

  if (!Array.isArray(data)) {
    return [`Root must be an array of NodeDefinition objects (${filePath})`];
  }

  data.forEach((node, index) => {
    const nodeErrors = validateNode(node, schema);
    nodeErrors.forEach((e) => errors.push(`[${index}] ${e}`));
  });

  return errors;
}

function listJsonFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  const files = [];
  const items = fs.readdirSync(targetPath);
  for (const item of items) {
    if (!item.endsWith('.json')) continue;
    if (item.endsWith('.meta.json')) continue;
    if (item.endsWith('.version.json')) continue;
    if (item.endsWith('.info.json')) continue;
    const full = path.join(targetPath, item);
    if (fs.statSync(full).isFile()) files.push(full);
  }
  return files;
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const schemaPath = path.join(repoRoot, 'src', 'data', 'nodes', 'schema', 'node.schema.json');
  const paramSchemaPath = path.join(repoRoot, 'src', 'data', 'nodes', 'schema', 'parameter.schema.json');

  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(repoRoot, 'public', 'node-registry');

  if (!fs.existsSync(target)) {
    console.log(`ℹ️ No registry path found: ${target}`);
    process.exit(0);
  }

  const schema = loadJson(schemaPath);
  const paramSchema = loadJson(paramSchemaPath);
  const paramTypes = asStringArray(safeGet(paramSchema, ['properties', 'type', 'enum'], null));
  if (paramTypes) {
    globalThis.__N4A_VALID_PARAM_TYPES = paramTypes;
  }

  const files = listJsonFiles(target);
  if (files.length === 0) {
    console.log(`ℹ️ No .json files to validate in: ${target}`);
    process.exit(0);
  }

  console.log('🔍 Validating node registry files...');
  console.log(`📋 Loaded schema from: ${path.relative(repoRoot, schemaPath)}`);
  console.log(`📋 Loaded parameter schema from: ${path.relative(repoRoot, paramSchemaPath)}`);
  console.log(`📁 Target: ${path.relative(repoRoot, target)}`);

  let hasErrors = false;

  for (const file of files) {
    try {
      const data = loadJson(file);
      const errors = validateRegistryData(data, schema, path.relative(repoRoot, file));
      if (errors.length > 0) {
        hasErrors = true;
        console.log(`\n❌ ${path.relative(repoRoot, file)} (${errors.length} errors)`);
        errors.slice(0, 50).forEach((e) => console.log(`   - ${e}`));
        if (errors.length > 50) {
          console.log(`   ... and ${errors.length - 50} more`);
        }
      } else {
        console.log(`✅ ${path.relative(repoRoot, file)} (${data.length} nodes)`);
      }
    } catch (e) {
      hasErrors = true;
      console.log(`\n❌ ${path.relative(repoRoot, file)} (failed to read/parse)`);
      console.log(String(e));
    }
  }

  if (hasErrors) {
    console.log('\n❌ Registry validation failed');
    process.exit(1);
  }

  console.log('\n✅ Registry validation passed');
  process.exit(0);
}

main();
