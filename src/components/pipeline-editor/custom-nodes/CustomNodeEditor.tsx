/**
 * CustomNodeEditor - Editor for creating and editing custom node definitions
 *
 * Provides a full editing interface for custom nodes including:
 * - Basic node info (name, type, description)
 * - Class path with validation
 * - Parameter builder with type-specific options
 * - Live validation feedback
 *
 * @see docs/_internals/node_specifications.md Section 6
 * @see docs/_internals/implementation_roadmap.md Task 5.3
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { NodeDefinition, NodeType, ParameterDefinition } from '@/data/nodes/types';
import {
  DEFAULT_ALLOWED_PACKAGES,
} from '@/data/nodes/custom';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';
import {
  appendEditorParameter,
  buildCustomNodeFromEditorDraft,
  getCustomNodeEditorNodeId,
  getEditorClassPathAllowlistStatus,
  moveEditorParameter,
  removeEditorParameter,
  updateEditorParameter,
} from './CustomNodeEditorLogic';
import { CustomNodeBasicInfoSection } from './CustomNodeEditorBasicInfoSection';
import { CustomNodeEditorHeader } from './CustomNodeEditorHeader';
import { CustomNodeParametersSection } from './CustomNodeEditorParametersSection';
import { CustomNodeValidationBanners } from './CustomNodeEditorValidationBanners';

// ============================================================================
// Types
// ============================================================================

export interface CustomNodeEditorProps {
  /** Initial node definition (for editing existing node) */
  initialNode?: NodeDefinition;
  /** Callback when node is saved */
  onSave: (node: NodeDefinition) => void;
  /** Callback when editing is cancelled */
  onCancel: () => void;
  /** External validation function */
  validateNode?: (node: NodeDefinition) => CustomNodeValidationResult;
  /** Allowed packages for classPath */
  allowedPackages?: string[];
  /** Whether the editor is in edit mode (vs create mode) */
  isEditMode?: boolean;
  /** Additional class name */
  className?: string;
}

// ============================================================================
// CustomNodeEditor Component
// ============================================================================

export function CustomNodeEditor({
  initialNode,
  onSave,
  onCancel,
  validateNode,
  allowedPackages = DEFAULT_ALLOWED_PACKAGES,
  isEditMode = false,
  className,
}: CustomNodeEditorProps) {
  // Form state
  const [name, setName] = useState(initialNode?.name ?? '');
  const [type, setType] = useState<NodeType>(initialNode?.type ?? 'preprocessing');
  const [classPath, setClassPath] = useState(initialNode?.classPath ?? '');
  const [description, setDescription] = useState(initialNode?.description ?? '');
  const [category, setCategory] = useState(initialNode?.category ?? 'Custom');
  const [tags, setTags] = useState(initialNode?.tags?.join(', ') ?? '');
  const [parameters, setParameters] = useState<ParameterDefinition[]>(
    initialNode?.parameters ?? []
  );
  const [isAdvanced, setIsAdvanced] = useState(initialNode?.isAdvanced ?? false);
  const [isDeepLearning, setIsDeepLearning] = useState(initialNode?.isDeepLearning ?? false);

  // Validation state
  const [validationResult, setValidationResult] = useState<CustomNodeValidationResult | null>(null);
  const [classPathValid, setClassPathValid] = useState<boolean | null>(null);

  // Build node definition from form state
  const buildNodeDefinition = useCallback((): NodeDefinition => {
    return buildCustomNodeFromEditorDraft(
      {
        name,
        type,
        classPath,
        description,
        category,
        tags,
        parameters,
        isAdvanced,
        isDeepLearning,
      },
      {
        isEditMode,
        initialNodeId: initialNode?.id,
      }
    );
  }, [name, type, classPath, description, category, tags, parameters, isAdvanced, isDeepLearning, isEditMode, initialNode?.id]);

  // Validate on changes
  useEffect(() => {
    if (validateNode) {
      const node = buildNodeDefinition();
      const result = validateNode(node);
      setValidationResult(result);
    }
  }, [buildNodeDefinition, validateNode]);

  // Validate classPath separately for immediate feedback
  useEffect(() => {
    if (!classPath.trim()) {
      setClassPathValid(null);
      return;
    }

    setClassPathValid(getEditorClassPathAllowlistStatus(classPath, allowedPackages));
  }, [classPath, allowedPackages]);

  // Parameter handlers
  const handleAddParameter = useCallback(() => {
    setParameters(appendEditorParameter);
  }, []);

  const handleUpdateParameter = useCallback((index: number, updates: Partial<ParameterDefinition>) => {
    setParameters(prev => updateEditorParameter(prev, index, updates));
  }, []);

  const handleRemoveParameter = useCallback((index: number) => {
    setParameters(prev => removeEditorParameter(prev, index));
  }, []);

  const handleMoveParameter = useCallback((fromIndex: number, toIndex: number) => {
    setParameters(prev => moveEditorParameter(prev, fromIndex, toIndex));
  }, []);

  // Save handler
  const handleSave = useCallback(() => {
    const node = buildNodeDefinition();

    if (validateNode) {
      const result = validateNode(node);
      if (!result.valid) {
        setValidationResult(result);
        return;
      }
    }

    onSave(node);
  }, [buildNodeDefinition, validateNode, onSave]);

  // Generate ID preview
  const previewId = useMemo(() => {
    return getCustomNodeEditorNodeId(name, isEditMode, initialNode?.id);
  }, [name, isEditMode, initialNode?.id]);

  const hasErrors = validationResult && !validationResult.valid;
  const hasWarnings = validationResult && validationResult.warnings.length > 0;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <CustomNodeEditorHeader
        initialNode={initialNode}
        isEditMode={isEditMode}
        hasErrors={hasErrors}
        name={name}
        onCancel={onCancel}
        onSave={handleSave}
      />

      <CustomNodeValidationBanners
        hasErrors={hasErrors}
        hasWarnings={hasWarnings}
        validationResult={validationResult}
      />

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <CustomNodeBasicInfoSection
            allowedPackages={allowedPackages}
            category={category}
            classPath={classPath}
            classPathValid={classPathValid}
            description={description}
            isAdvanced={isAdvanced}
            isDeepLearning={isDeepLearning}
            name={name}
            previewId={previewId}
            tags={tags}
            type={type}
            onChangeCategory={setCategory}
            onChangeClassPath={setClassPath}
            onChangeDescription={setDescription}
            onChangeIsAdvanced={setIsAdvanced}
            onChangeIsDeepLearning={setIsDeepLearning}
            onChangeName={setName}
            onChangeTags={setTags}
            onChangeType={setType}
          />

          <Separator />

          <CustomNodeParametersSection
            parameters={parameters}
            onAddParameter={handleAddParameter}
            onMoveParameter={handleMoveParameter}
            onRemoveParameter={handleRemoveParameter}
            onUpdateParameter={handleUpdateParameter}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
