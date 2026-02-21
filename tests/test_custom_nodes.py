"""
Tests for Custom Nodes API (Phase 5)

Verifies:
- CRUD operations for custom nodes
- Namespace validation
- Security allowlist checking
- Import/export functionality
- Settings management
"""

import json
import shutil

# Add parent path for imports
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from api.workspace_manager import WorkspaceManager


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory."""
    temp_dir = tempfile.mkdtemp(prefix="nirs4all_test_")
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def workspace_manager(temp_workspace):
    """Create a workspace manager with a test workspace."""
    manager = WorkspaceManager()
    manager.set_workspace(temp_workspace)
    return manager


class TestCustomNodeStorage:
    """Tests for custom node storage in workspace."""

    def test_get_empty_nodes(self, workspace_manager):
        """Initially there should be no custom nodes."""
        nodes = workspace_manager.get_custom_nodes()
        assert nodes == []

    def test_add_custom_node(self, workspace_manager):
        """Can add a custom node."""
        node = {
            "id": "custom.test_node",
            "label": "Test Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        result = workspace_manager.add_custom_node(node)

        assert result["id"] == "custom.test_node"
        assert result["source"] == "workspace"
        assert "created_at" in result

        # Verify it's stored
        nodes = workspace_manager.get_custom_nodes()
        assert len(nodes) == 1
        assert nodes[0]["id"] == "custom.test_node"

    def test_add_duplicate_node_fails(self, workspace_manager):
        """Cannot add a node with duplicate ID."""
        node = {
            "id": "custom.test_node",
            "label": "Test Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        workspace_manager.add_custom_node(node)

        with pytest.raises(ValueError, match="already exists"):
            workspace_manager.add_custom_node(node)

    def test_update_custom_node(self, workspace_manager):
        """Can update an existing custom node."""
        node = {
            "id": "custom.test_node",
            "label": "Test Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        workspace_manager.add_custom_node(node)

        updates = {
            "id": "custom.test_node",
            "label": "Updated Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.MSC",
            "stepType": "preprocessing",
            "parameters": [{"name": "scale", "type": "bool", "default": True}],
        }
        result = workspace_manager.update_custom_node("custom.test_node", updates)

        assert result["label"] == "Updated Node"
        assert result["classPath"] == "nirs4all.operators.MSC"
        assert len(result["parameters"]) == 1

    def test_delete_custom_node(self, workspace_manager):
        """Can delete a custom node."""
        node = {
            "id": "custom.test_node",
            "label": "Test Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        workspace_manager.add_custom_node(node)

        success = workspace_manager.delete_custom_node("custom.test_node")
        assert success is True

        # Verify it's gone
        nodes = workspace_manager.get_custom_nodes()
        assert len(nodes) == 0

    def test_delete_nonexistent_node(self, workspace_manager):
        """Deleting a nonexistent node returns False."""
        success = workspace_manager.delete_custom_node("custom.not_found")
        assert success is False


class TestCustomNodeImportExport:
    """Tests for import/export functionality."""

    def test_import_nodes(self, workspace_manager):
        """Can import multiple nodes."""
        nodes_to_import = [
            {
                "id": "custom.node1",
                "label": "Node 1",
                "category": "Custom",
                "classPath": "nirs4all.operators.SNV",
                "stepType": "preprocessing",
                "parameters": [],
            },
            {
                "id": "custom.node2",
                "label": "Node 2",
                "category": "Custom",
                "classPath": "sklearn.preprocessing.MinMaxScaler",
                "stepType": "preprocessing",
                "parameters": [],
            },
        ]

        result = workspace_manager.import_custom_nodes(nodes_to_import)

        assert result["imported"] == 2
        assert result["skipped"] == 0
        assert result["errors"] == 0

        nodes = workspace_manager.get_custom_nodes()
        assert len(nodes) == 2

    def test_import_skips_duplicates(self, workspace_manager):
        """Import skips nodes that already exist (without overwrite)."""
        node = {
            "id": "custom.existing",
            "label": "Existing Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        workspace_manager.add_custom_node(node)

        nodes_to_import = [
            {
                "id": "custom.existing",
                "label": "Updated Label",
                "category": "Custom",
                "classPath": "nirs4all.operators.MSC",
                "stepType": "preprocessing",
                "parameters": [],
            },
            {
                "id": "custom.new_node",
                "label": "New Node",
                "category": "Custom",
                "classPath": "nirs4all.operators.Detrend",
                "stepType": "preprocessing",
                "parameters": [],
            },
        ]

        result = workspace_manager.import_custom_nodes(nodes_to_import, overwrite=False)

        assert result["imported"] == 1
        assert result["skipped"] == 1

        # Verify existing node was not changed
        nodes = workspace_manager.get_custom_nodes()
        existing = next(n for n in nodes if n["id"] == "custom.existing")
        assert existing["label"] == "Existing Node"

    def test_import_with_overwrite(self, workspace_manager):
        """Import can overwrite existing nodes."""
        node = {
            "id": "custom.existing",
            "label": "Existing Node",
            "category": "Custom",
            "classPath": "nirs4all.operators.SNV",
            "stepType": "preprocessing",
            "parameters": [],
        }
        workspace_manager.add_custom_node(node)

        nodes_to_import = [
            {
                "id": "custom.existing",
                "label": "Updated Label",
                "category": "Custom",
                "classPath": "nirs4all.operators.MSC",
                "stepType": "preprocessing",
                "parameters": [],
            },
        ]

        result = workspace_manager.import_custom_nodes(nodes_to_import, overwrite=True)

        assert result["imported"] == 1
        assert result["skipped"] == 0

        # Verify node was updated
        nodes = workspace_manager.get_custom_nodes()
        existing = nodes[0]
        assert existing["label"] == "Updated Label"


class TestCustomNodeSettings:
    """Tests for custom node settings."""

    def test_default_settings(self, workspace_manager):
        """Default settings have expected values."""
        settings = workspace_manager.get_custom_node_settings()

        assert settings["enabled"] is True
        assert "nirs4all" in settings["allowedPackages"]
        assert "sklearn" in settings["allowedPackages"]
        assert settings["requireApproval"] is False
        assert settings["allowUserNodes"] is True

    def test_save_settings(self, workspace_manager):
        """Can save custom settings."""
        new_settings = {
            "enabled": False,
            "allowedPackages": ["nirs4all", "sklearn", "my_company"],
            "requireApproval": True,
            "allowUserNodes": False,
        }

        success = workspace_manager.save_custom_node_settings(new_settings)
        assert success is True

        # Verify saved
        loaded = workspace_manager.get_custom_node_settings()
        assert loaded["enabled"] is False
        assert "my_company" in loaded["allowedPackages"]
        assert loaded["requireApproval"] is True


class TestNoWorkspaceSelected:
    """Tests for operations without workspace."""

    def test_add_node_requires_workspace(self):
        """Adding node without workspace raises error."""
        manager = WorkspaceManager()

        node = {
            "id": "custom.test",
            "label": "Test",
            "category": "Custom",
            "classPath": "nirs4all.test",
            "stepType": "preprocessing",
            "parameters": [],
        }

        with patch.object(manager, "get_active_workspace_path", return_value=None), \
             pytest.raises(RuntimeError, match="No active workspace"):
            manager.add_custom_node(node)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
