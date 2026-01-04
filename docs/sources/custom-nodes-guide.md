# Custom Nodes User Guide

This guide explains how to create, manage, and share custom nodes in the Pipeline Editor.

## What are Custom Nodes?

Custom nodes allow you to add your own Python operators to the pipeline editor. This is useful when:

- You have proprietary preprocessing algorithms
- You want to use operators from external packages
- You need specialized transformations for your domain

## Quick Start

### Adding Your First Custom Node

1. Open the Pipeline Editor
2. In the Step Palette (left sidebar), find the **Custom Nodes** section
3. Click the **⋯** menu and select **Add Custom Node**
4. Follow the 5-step wizard:
   - **Step 1**: Choose node type (Preprocessing, Model, etc.)
   - **Step 2**: Enter name and description
   - **Step 3**: Specify the Python class path
   - **Step 4**: Define parameters
   - **Step 5**: Review and save

### Example: Adding a Custom Scaler

```
Name: MyScaler
Description: Custom min-max scaler with clip option
Class Path: mypackage.preprocessing.MyScaler
Type: Preprocessing

Parameters:
- feature_range_min (float): 0.0
- feature_range_max (float): 1.0
- clip (bool): True
```

## Node Types

| Type | Description | Examples |
|------|-------------|----------|
| **Preprocessing** | Data transformations | SNV, MSC, scaling |
| **Processing** | Feature extraction | Derivatives, PCA |
| **Splitting** | Data partitioning | K-Fold, train/test split |
| **Model** | Prediction models | PLS, Random Forest |
| **Metrics** | Evaluation metrics | RMSE, R² |

## Class Path Format

The class path tells the system where to find your Python class:

```
package.module.ClassName
```

**Examples:**
- `sklearn.preprocessing.StandardScaler`
- `nirs4all.operators.preprocessing.SNV`
- `mycompany.transforms.CustomDetrend`

### Allowed Packages

For security, only approved packages can be used. Default allowed packages:

- `nirs4all`
- `sklearn`
- `scipy`
- `numpy`
- `pandas`

Administrators can add more packages in **Settings**.

## Parameters

### Parameter Types

| Type | Description | Example |
|------|-------------|---------|
| `int` | Integer number | `n_components: 10` |
| `float` | Decimal number | `alpha: 0.5` |
| `bool` | True/False | `scale: True` |
| `string` | Text | `method: "linear"` |
| `select` | Dropdown options | `kernel: ["rbf", "linear", "poly"]` |

### Defining Parameters

For each parameter, you can specify:

- **Name**: Python parameter name (snake_case)
- **Type**: Data type
- **Default**: Default value
- **Required**: Must be provided
- **Description**: Help text
- **Min/Max**: For numeric types
- **Options**: For select type

## Namespaces

Custom node IDs follow a namespace pattern:

| Namespace | Scope | Priority |
|-----------|-------|----------|
| `admin.*` | Organization-wide | Highest |
| `workspace.*` | Current workspace | High |
| `user.*` | Personal | Normal |
| `custom.*` | Personal | Normal |

**Example IDs:**
- `custom.my_scaler`
- `workspace.team_preprocessor`
- `admin.approved_model`

## Import & Export

### Exporting Nodes

1. Click **⋯** menu in Custom Nodes section
2. Select **Export Nodes**
3. Save the JSON file

### Importing Nodes

1. Click **⋯** menu in Custom Nodes section
2. Select **Import Nodes**
3. Choose a JSON file
4. Nodes are merged with existing ones

### Export Format

```json
{
  "version": "1.0",
  "nodes": [
    {
      "id": "custom.my_scaler",
      "name": "MyScaler",
      "type": "preprocessing",
      "classPath": "mypackage.MyScaler",
      "description": "Custom scaler",
      "parameters": [
        {
          "name": "scale",
          "type": "float",
          "default": 1.0
        }
      ]
    }
  ]
}
```

## Workspace Sync

Custom nodes can be shared with your team via workspace sync:

1. Open **Settings** (⋯ menu → Settings)
2. Click **Sync Now** to pull/push workspace nodes
3. Workspace nodes appear for all team members

### Storage Locations

| Location | Persistence | Sharing |
|----------|-------------|---------|
| Browser (localStorage) | Per browser | No |
| Workspace (.nirs4all/custom_nodes.json) | Per project | Yes |

## Admin Settings

Administrators can configure custom node policies:

### Enable/Disable Custom Nodes

Toggle whether users can create custom nodes at all.

### Require Approval

When enabled, new custom nodes must be reviewed before use.

### Package Allowlist

Control which Python packages can be used:

1. Open Settings
2. Add package names to the allowlist
3. Default packages cannot be removed

## Troubleshooting

### "Package not in allowlist"

Your class path uses a package that isn't approved. Ask your administrator to add it to the allowlist.

### "Invalid ID format"

Node IDs must follow the pattern `namespace.snake_case_name`. Examples:
- ✅ `custom.my_operator`
- ❌ `MyOperator`
- ❌ `custom.My-Operator`

### "Node not executing"

Ensure:
1. The Python package is installed in your environment
2. The class path is correct
3. All required parameters are provided

### Custom node not appearing

1. Refresh the page
2. Check if custom nodes are enabled in Settings
3. Verify the node was saved successfully

## Best Practices

1. **Use descriptive names** - Make it clear what the node does
2. **Document parameters** - Add descriptions to help users
3. **Set sensible defaults** - Reduce configuration burden
4. **Test before sharing** - Verify nodes work in pipelines
5. **Use workspace sync** - Share proven nodes with your team

## API Reference

For developers integrating custom nodes programmatically:

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workspace/custom-nodes` | GET | List all nodes |
| `/api/workspace/custom-nodes` | POST | Create node |
| `/api/workspace/custom-nodes/{id}` | PUT | Update node |
| `/api/workspace/custom-nodes/{id}` | DELETE | Delete node |
| `/api/workspace/custom-nodes/import` | POST | Import nodes |
| `/api/workspace/custom-nodes/export` | GET | Export nodes |
| `/api/workspace/custom-nodes/settings` | GET/PUT | Manage settings |

### TypeScript Hook

```typescript
import { useCustomNodes } from '@/data/nodes/custom';

function MyComponent() {
  const {
    customNodes,
    addNode,
    removeNode,
    syncWithWorkspace,
  } = useCustomNodes();

  // Use custom nodes...
}
```
