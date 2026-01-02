import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import type { Dataset, DatasetGroup } from "@/types/datasets";

interface GroupsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DatasetGroup[];
  datasets: Dataset[];
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (groupId: string, newName: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onRemoveDatasetFromGroup: (
    groupId: string,
    datasetId: string
  ) => Promise<void>;
}

export function GroupsModal({
  open,
  onOpenChange,
  groups,
  datasets,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onRemoveDatasetFromGroup,
}: GroupsModalProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setLoading(true);
    try {
      await onCreateGroup(newGroupName.trim());
      setNewGroupName("");
    } catch (error) {
      console.error("Failed to create group:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRenameGroup = async (groupId: string) => {
    if (!editingGroupName.trim()) return;
    setLoading(true);
    try {
      await onRenameGroup(groupId, editingGroupName.trim());
      setEditingGroupId(null);
      setEditingGroupName("");
    } catch (error) {
      console.error("Failed to rename group:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Delete group "${groupName}"?`)) return;
    setLoading(true);
    try {
      await onDeleteGroup(groupId);
    } catch (error) {
      console.error("Failed to delete group:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDataset = async (groupId: string, datasetId: string) => {
    setLoading(true);
    try {
      await onRemoveDatasetFromGroup(groupId, datasetId);
    } catch (error) {
      console.error("Failed to remove dataset from group:", error);
    } finally {
      setLoading(false);
    }
  };

  const getDatasetName = (datasetId: string): string => {
    return datasets.find((ds) => ds.id === datasetId)?.name || datasetId;
  };

  const startEdit = (group: DatasetGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const cancelEdit = () => {
    setEditingGroupId(null);
    setEditingGroupName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Groups</DialogTitle>
          <DialogDescription>
            Organize your datasets into groups for easier management
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
          {/* Create new group */}
          <div>
            <Label className="mb-2 block">Create New Group</Label>
            <div className="flex gap-2">
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                placeholder="Group name"
                className="flex-1"
              />
              <Button
                onClick={handleCreateGroup}
                disabled={loading || !newGroupName.trim()}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Create
              </Button>
            </div>
          </div>

          {/* Groups list */}
          <div className="flex-1 overflow-hidden">
            <Label className="mb-2 block">Existing Groups</Label>

            <ScrollArea className="h-[300px] border rounded-lg">
              {groups.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No groups yet. Create one above.
                </div>
              ) : (
                <div className="divide-y">
                  {groups.map((group) => (
                    <div key={group.id} className="p-4">
                      {/* Group header */}
                      <div className="flex items-center justify-between mb-2">
                        {editingGroupId === group.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <Input
                              value={editingGroupName}
                              onChange={(e) =>
                                setEditingGroupName(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleRenameGroup(group.id);
                                } else if (e.key === "Escape") {
                                  cancelEdit();
                                }
                              }}
                              className="h-8 flex-1"
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleRenameGroup(group.id)}
                              disabled={loading}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={cancelEdit}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-foreground">
                                {group.name}
                              </h4>
                              <Badge variant="secondary" className="text-xs">
                                {group.dataset_ids.length} datasets
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEdit(group)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() =>
                                  handleDeleteGroup(group.id, group.name)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Datasets in group */}
                      <div className="flex flex-wrap gap-1.5">
                        {group.dataset_ids.length === 0 ? (
                          <span className="text-sm text-muted-foreground">
                            No datasets assigned
                          </span>
                        ) : (
                          group.dataset_ids.map((datasetId) => (
                            <Badge
                              key={datasetId}
                              variant="outline"
                              className="gap-1 pr-1"
                            >
                              {getDatasetName(datasetId)}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 hover:bg-transparent"
                                onClick={() =>
                                  handleRemoveDataset(group.id, datasetId)
                                }
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
