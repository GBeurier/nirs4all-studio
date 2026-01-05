# Developer Guide: Custom Nodes via UI

This guide explains how users can create, manage, and use custom nodes through the nirs4all Pipeline Editor UI. For adding builtin nodes to the source code, see [developer_guide_adding_nodes.md](developer_guide_adding_nodes.md).

## Overview

Custom nodes allow users to extend the Pipeline Editor with their own operators without modifying the source code. Custom nodes are:

- Stored in browser localStorage (persisted per-device)
- Optionally synced to workspace storage (shared across team)
- Validated against a security allowlist
- Exportable/importable as JSON files

## Table of Contents

1. [Creating a Custom Node](#creating-a-custom-node)
2. [Node ID Namespaces](#node-id-namespaces)
3. [Security Configuration](#security-configuration)
4. [Import/Export](#importexport)
5. [Workspace Sync](#workspace-sync)
6. [Programmatic API](#programmatic-api)
7. [Troubleshooting](#troubleshooting)

## Creating a Custom Node

### Via the UI

1. Open the Pipeline Editor
2. Click **Settings** (gear icon) in the toolbar
3. Select **Custom Nodes** tab
4. Click **Add Custom Node**
5. Fill in the form:
   - **ID**: Unique identifier (e.g., `custom.my_preprocessor`)
   - **Name**: Display name (e.g., `MyPreprocessor`)
   - **Type**: Node category (preprocessing, model, etc.)
   - **Class Path**: Python import path (e.g., `mypackage.transforms.MyPreprocessor`)
   - **Description**: Short description for tooltips
   - **Category**: Subcategory for organization

### Adding Parameters

Click **Add Parameter** and configure:

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Python argument name (snake_case) |
| Type | Yes | int, float, bool, string, select |
| Default | Recommended | Default value |
| Description | Recommended | Help text |
| Min/Max | Optional | Numeric constraints |
| Options | For select | Dropdown choices |
| Required | Optional | Mark as required |
| Advanced | Optional | Hide in basic view |

### Example: Custom Preprocessor

```
ID: custom.weighted_msc
Name: WeightedMSC
Type: preprocessing
Class Path: mylab.transforms.WeightedMSC
Description: MSC with wavelength-dependent weights

Parameters:
  - name: weights_path
    type: string
    default: ""
    description: Path to weights file

  - name: reference
    type: select
    default: mean
    options: [mean, median, first]
    description: Reference spectrum type

  - name: normalize
    type: bool
    default: true
    description: Normalize after correction
```

## Node ID Namespaces

Custom node IDs must follow the namespace pattern: `namespace.snake_case_name`

| Namespace | Priority | Use Case |
|-----------|----------|----------|
| `custom.*` | 25 | User-defined nodes (personal) |
| `user.*` | 25 | User-defined (alias for custom) |
| `workspace.*` | 50 | Shared within workspace/team |
| `admin.*` | 100 | Administrator-defined (highest priority) |

### Conflict Resolution

When nodes have the same ID, higher priority wins:
- `admin.my_node` overrides `workspace.my_node`
- `workspace.my_node` overrides `custom.my_node`

### Valid ID Examples

```
✓ custom.my_preprocessor
✓ custom.lab_specific_filter
✓ workspace.team_normalizer
✓ admin.approved_model

✗ my_preprocessor          (missing namespace)
✗ custom.MyPreprocessor    (not snake_case)
✗ Custom.my_node           (namespace must be lowercase)
✗ custom.                   (missing name)
```

## Security Configuration

Custom nodes are validated against a security allowlist to prevent execution of arbitrary code.

### Allowed Packages

By default, only these packages are allowed:

```
nirs4all
sklearn
scipy
numpy
pandas
```

### Adding Custom Packages

Administrators can configure allowed packages:

```typescript
const storage = CustomNodeStorage.getInstance();
storage.updateSecurityConfig({
  allowCustomNodes: true,
  allowedPackages: ['nirs4all', 'sklearn', 'mylab', 'custom_package'],
  requireApproval: false,
  allowUserPackages: true
});
```

### User Package Addition

If `allowUserPackages` is enabled, users can add packages:

1. Go to **Settings** > **Custom Nodes** > **Security**
2. Click **Add Package**
3. Enter package name (e.g., `mylab`)
4. Click **Save**

### Class Path Validation

When adding a custom node, the `classPath` is validated:

```
✓ nirs4all.operators.transforms.SNV           (nirs4all is allowed)
✓ sklearn.preprocessing.StandardScaler        (sklearn is allowed)
✓ mylab.transforms.CustomTransform            (if mylab is added)

✗ malicious.package.Exploit                   (not in allowlist)
✗ os.system                                   (dangerous module)
```

## Import/Export

### Exporting Custom Nodes

1. Go to **Settings** > **Custom Nodes**
2. Click **Export All**
3. Save the JSON file

Or export specific nodes:
1. Select nodes to export
2. Click **Export Selected**

### Export Format

```json
{
  "version": "1.0.0",
  "nodes": [
    {
      "id": "custom.my_preprocessor",
      "name": "MyPreprocessor",
      "type": "preprocessing",
      "classPath": "mylab.transforms.MyPreprocessor",
      "description": "Custom preprocessing step",
      "category": "Custom",
      "source": "custom",
      "parameters": [
        {
          "name": "factor",
          "type": "float",
          "default": 1.0,
          "min": 0,
          "max": 10,
          "description": "Scaling factor"
        }
      ]
    }
  ]
}
```

### Importing Custom Nodes

1. Go to **Settings** > **Custom Nodes**
2. Click **Import**
3. Select the JSON file
4. Choose import mode:
   - **Merge**: Add to existing (skip duplicates)
   - **Replace**: Clear existing, then import

### Programmatic Import

```typescript
const storage = CustomNodeStorage.getInstance();
const result = storage.importFromString(jsonString, 'merge');
console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
if (result.errors.length > 0) {
  console.error('Import errors:', result.errors);
}
```

## Workspace Sync

Custom nodes can be synced to workspace storage for team sharing.

### Syncing with Workspace

```typescript
const storage = CustomNodeStorage.getInstance();
const result = await storage.syncWithWorkspace();

if (result.success) {
  console.log(`Synced: ${result.workspaceCount} workspace nodes, ${result.localCount} local nodes`);
} else {
  console.error('Sync failed:', result.error);
}
```

### Promoting Local to Workspace

1. Create a custom node locally
2. Test it in your pipelines
3. Go to **Settings** > **Custom Nodes**
4. Click the **Share** button on the node
5. Confirm to promote to workspace

Or programmatically:

```typescript
const storage = CustomNodeStorage.getInstance();
await storage.promoteToWorkspace('custom.my_node');
```

### Node Sources

After sync, nodes have a source indicator:

| Source | Icon | Description |
|--------|------|-------------|
| `local` | 💾 | Browser localStorage only |
| `workspace` | 🏢 | Synced from workspace API |
| `admin` | 🔒 | Admin-configured (read-only) |

### Conflict Handling

When local and workspace nodes have the same ID:
- Workspace nodes take priority
- Local node is hidden but preserved
- Deleting workspace node reveals local node

## Programmatic API

### CustomNodeStorage

The `CustomNodeStorage` class provides the core API:

```typescript
import { CustomNodeStorage } from '@/data/nodes/custom';

const storage = CustomNodeStorage.getInstance();
```

### CRUD Operations

```typescript
// Create
storage.add({
  id: 'custom.my_node',
  name: 'MyNode',
  type: 'preprocessing',
  classPath: 'mypackage.MyNode',
  description: 'My custom node',
  source: 'custom',
  parameters: []
});

// Read
const node = storage.get('custom.my_node');
const allNodes = storage.getAll();
const byType = storage.getByType('preprocessing');

// Update
storage.update('custom.my_node', {
  description: 'Updated description'
});

// Delete
storage.remove('custom.my_node');

// Clear all
storage.clear();
```

### Validation

```typescript
const validation = storage.validate(node);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings);
}
```

### Event Subscriptions

```typescript
const unsubscribe = storage.subscribe((event) => {
  switch (event.type) {
    case 'add':
      console.log(`Node added: ${event.nodeId}`);
      break;
    case 'update':
      console.log(`Node updated: ${event.nodeId}`);
      break;
    case 'remove':
      console.log(`Node removed: ${event.nodeId}`);
      break;
    case 'sync':
      console.log('Workspace sync completed');
      break;
  }
});

// Later: cleanup
unsubscribe();
```

### Utility Functions

```typescript
import {
  generateCustomNodeId,
  parseNamespace,
  isCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate
} from '@/data/nodes/custom';

// Generate ID from name
const id = generateCustomNodeId('My Transform', 'custom');
// Result: 'custom.my_transform'

// Parse namespace
const ns = parseNamespace('workspace.team_filter');
// Result: 'workspace'

// Check if custom
const isCustom = isCustomNodeId('custom.my_node');
// Result: true

// Create template
const template = createCustomNodeTemplate('preprocessing');
// Result: NodeDefinition with defaults

// Create parameter template
const param = createParameterTemplate();
// Result: ParameterDefinition with defaults
```

## Troubleshooting

### Node Not Appearing in Palette

1. **Check validation**: Open console and look for validation errors
2. **Verify namespace**: ID must start with `custom.`, `user.`, `workspace.`, or `admin.`
3. **Check type**: Type must be a valid NodeType
4. **Refresh registry**: The node palette caches nodes; try refreshing the page

### Class Path Rejected

1. **Check allowlist**: The package must be in the security allowlist
2. **Add package**: Use `storage.addUserPackage('mypackage')` if allowed
3. **Contact admin**: If `allowUserPackages` is false, ask an administrator

### Import Failures

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid file format" | Not a valid JSON file | Verify JSON syntax |
| "Invalid ID format" | Wrong namespace pattern | Use `namespace.snake_case` |
| "Package not in allowlist" | classPath uses blocked package | Add package to allowlist |
| "Name is required" | Missing name field | Add node name |

### Sync Issues

1. **Check network**: Workspace sync requires API connectivity
2. **Check permissions**: You may need workspace write access
3. **Retry sync**: Temporary failures can be retried

### Storage Quota

Browser localStorage has a ~5MB limit. If you hit quota errors:

1. Export your custom nodes to a file
2. Clear old/unused nodes
3. Consider using workspace sync for large node collections

## Related Documentation

- [CustomNodeStorage.ts](../src/data/nodes/custom/CustomNodeStorage.ts) - Implementation
- [types.ts](../src/data/nodes/types.ts) - TypeScript types
- [node_specifications.md](node_specifications.md) - Design specifications
- [developer_guide_adding_nodes.md](developer_guide_adding_nodes.md) - Adding builtin nodes
