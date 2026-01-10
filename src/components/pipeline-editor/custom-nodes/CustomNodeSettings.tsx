/**
 * CustomNodeSettings - Admin panel for custom node policy and security settings
 *
 * Provides controls for:
 * - Enabling/disabling custom nodes
 * - Managing the package allowlist
 * - Setting approval requirements
 * - Syncing with workspace settings
 *
 * @see docs/_internals/implementation_roadmap.md Phase 5, Task 5.10
 */

import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';
import {
  Settings,
  Shield,
  Package,
  Plus,
  X,
  RefreshCw,
  Save,
  Cloud,
  HardDrive,
  AlertTriangle,
  Check,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCustomNodes } from '@/data/nodes/custom/useCustomNodes';
import { DEFAULT_ALLOWED_PACKAGES } from '@/data/nodes/custom/CustomNodeStorage';
import { cn } from '@/lib/utils';

interface CustomNodeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomNodeSettings({ open, onOpenChange }: CustomNodeSettingsProps) {
  const {
    securityConfig,
    updateSecurityConfig,
    allowedPackages,
    addUserPackage,
    removeUserPackage,
    syncWithWorkspace,
    isSyncing,
    lastSyncTime,
    localNodes,
    workspaceNodes,
  } = useCustomNodes();

  // Local state for new package input
  const [newPackage, setNewPackage] = useState('');
  const [packageError, setPackageError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Track if changes were made
  const [hasChanges, setHasChanges] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setNewPackage('');
      setPackageError(null);
      setSaveSuccess(false);
      setHasChanges(false);
    }
  }, [open]);

  // Handle toggle changes
  const handleToggleChange = (key: keyof typeof securityConfig, value: boolean) => {
    updateSecurityConfig({ [key]: value });
    setHasChanges(true);
  };

  // Handle adding a new package
  const handleAddPackage = () => {
    const pkg = newPackage.trim().toLowerCase();

    if (!pkg) {
      setPackageError('Package name is required');
      return;
    }

    // Validate package name format
    if (!/^[a-z][a-z0-9_-]*$/.test(pkg)) {
      setPackageError('Invalid package name format. Use lowercase letters, numbers, underscores, or hyphens.');
      return;
    }

    // Check if already exists
    if (allowedPackages.includes(pkg)) {
      setPackageError('Package is already in the allowlist');
      return;
    }

    const result = addUserPackage(pkg);
    if (result.success) {
      setNewPackage('');
      setPackageError(null);
      setHasChanges(true);
    } else {
      setPackageError(result.error || 'Failed to add package');
    }
  };

  // Handle removing a package
  const handleRemovePackage = (pkg: string) => {
    // Don't allow removing default packages
    if (DEFAULT_ALLOWED_PACKAGES.includes(pkg)) {
      return;
    }
    removeUserPackage(pkg);
    setHasChanges(true);
  };

  // Handle sync with workspace
  const handleSync = async () => {
    const result = await syncWithWorkspace();
    if (result.success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  // Format last sync time
  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-violet-500" />
            Custom Node Settings
          </DialogTitle>
          <DialogDescription>
            Configure security policies and manage allowed packages for custom nodes
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Sync Status Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cloud className="h-4 w-4" />
                Workspace Sync
              </CardTitle>
              <CardDescription>
                Sync custom nodes with the workspace for team sharing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span>Local nodes: <strong>{localNodes.length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Cloud className="h-4 w-4 text-muted-foreground" />
                    <span>Workspace nodes: <strong>{workspaceNodes.length}</strong></span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last sync: {formatLastSync(lastSyncTime)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="gap-2"
                >
                  <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
              </div>

              <AnimatePresence>
                {saveSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-3"
                  >
                    <Alert className="bg-green-50 border-green-200">
                      <Check className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-green-700">
                        Successfully synced with workspace
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Security Settings Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Security Policy
              </CardTitle>
              <CardDescription>
                Control who can create and use custom nodes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Enable custom nodes */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="enable-custom">Enable Custom Nodes</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow users to create and use custom operators
                  </p>
                </div>
                <Switch
                  id="enable-custom"
                  checked={securityConfig.allowCustomNodes}
                  onCheckedChange={(checked) => handleToggleChange('allowCustomNodes', checked)}
                />
              </div>

              <Separator />

              {/* Require approval */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="require-approval" className="flex items-center gap-2">
                    Require Admin Approval
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">
                            When enabled, new custom nodes must be approved by an admin
                            before they can be used in pipelines.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    New custom nodes require admin review
                  </p>
                </div>
                <Switch
                  id="require-approval"
                  checked={securityConfig.requireApproval}
                  onCheckedChange={(checked) => handleToggleChange('requireApproval', checked)}
                  disabled={!securityConfig.allowCustomNodes}
                />
              </div>

              <Separator />

              {/* Allow user packages */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allow-user-packages">Allow User Packages</Label>
                  <p className="text-xs text-muted-foreground">
                    Let users add their own packages to the allowlist
                  </p>
                </div>
                <Switch
                  id="allow-user-packages"
                  checked={securityConfig.allowUserPackages}
                  onCheckedChange={(checked) => handleToggleChange('allowUserPackages', checked)}
                  disabled={!securityConfig.allowCustomNodes}
                />
              </div>
            </CardContent>
          </Card>

          {/* Package Allowlist Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Package Allowlist
              </CardTitle>
              <CardDescription>
                Only operators from these packages can be used in custom nodes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add new package */}
              {securityConfig.allowUserPackages && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Package name (e.g., mypackage)"
                      value={newPackage}
                      onChange={(e) => {
                        setNewPackage(e.target.value);
                        setPackageError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddPackage();
                        }
                      }}
                      className={cn(packageError && 'border-red-500')}
                    />
                    {packageError && (
                      <p className="text-xs text-red-500 mt-1">{packageError}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleAddPackage}
                    disabled={!securityConfig.allowCustomNodes}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Package list */}
              <div className="flex flex-wrap gap-2">
                {allowedPackages.map((pkg) => {
                  const isDefault = DEFAULT_ALLOWED_PACKAGES.includes(pkg);
                  return (
                    <Badge
                      key={pkg}
                      variant={isDefault ? 'secondary' : 'outline'}
                      className={cn(
                        'gap-1 pr-1',
                        !isDefault && 'hover:bg-red-50 group'
                      )}
                    >
                      <span>{pkg}</span>
                      {isDefault ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Shield className="h-3 w-3 ml-1 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Default package (cannot be removed)</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <button
                          onClick={() => handleRemovePackage(pkg)}
                          className="ml-1 p-0.5 rounded-full hover:bg-red-100 transition-colors"
                          title="Remove package"
                        >
                          <X className="h-3 w-3 text-muted-foreground group-hover:text-red-500" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>

              {/* Warning for restricted mode */}
              {!securityConfig.allowUserPackages && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Restricted Mode</AlertTitle>
                  <AlertDescription>
                    User packages are disabled. Only default packages can be used.
                    Enable "Allow User Packages" to let users add custom packages.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Custom Nodes Disabled Warning */}
          {!securityConfig.allowCustomNodes && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Custom Nodes Disabled</AlertTitle>
              <AlertDescription>
                Custom nodes are currently disabled. Users cannot create or use custom operators.
                Enable custom nodes to allow this functionality.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Footer with save indicator */}
        {hasChanges && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between pt-4 border-t"
          >
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Save className="h-4 w-4" />
              Changes are saved automatically
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setHasChanges(false);
              }}
            >
              Done
            </Button>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CustomNodeSettings;
