import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ParameterDefinition } from '@/data/nodes/types';
import {
  appendWizardParameter,
  coerceWizardParameterDefault,
  removeWizardParameter,
  updateWizardParameter,
} from './AddCustomNodeWizardLogic';

interface AddCustomNodeWizardParametersStepProps {
  parameters: ParameterDefinition[];
  onChange: (params: ParameterDefinition[]) => void;
}

export function AddCustomNodeWizardParametersStep({
  parameters,
  onChange,
}: AddCustomNodeWizardParametersStepProps) {
  const { t } = useTranslation();
  const addParameter = () => {
    onChange(appendWizardParameter(parameters));
  };

  const removeParameter = (index: number) => {
    onChange(removeWizardParameter(parameters, index));
  };

  const updateParameter = (index: number, updates: Partial<ParameterDefinition>) => {
    onChange(updateWizardParameter(parameters, index, updates));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('pipelineEditor.customNodes.wizard.params.heading')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('pipelineEditor.customNodes.wizard.params.hint')}
        </p>
      </div>

      <div className="space-y-3">
        {parameters.map((param, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
          >
            <div className="flex-1 grid grid-cols-3 gap-2">
              <Input
                value={param.name}
                onChange={(e) => updateParameter(index, { name: e.target.value })}
                placeholder="param_name"
                className="font-mono text-sm h-8"
              />
              <select
                value={param.type}
                onChange={(e) => updateParameter(index, { type: e.target.value as ParameterDefinition['type'] })}
                aria-label={t('pipelineEditor.customNodes.editor.basic.type')}
                className="h-8 px-2 text-sm rounded border bg-background"
              >
                <option value="int">{t('pipelineEditor.customNodes.paramTypes.int')}</option>
                <option value="float">{t('pipelineEditor.customNodes.paramTypes.float')}</option>
                <option value="bool">{t('pipelineEditor.customNodes.paramTypes.bool')}</option>
                <option value="string">{t('pipelineEditor.customNodes.paramTypes.string')}</option>
                <option value="select">{t('pipelineEditor.customNodes.paramTypes.select')}</option>
              </select>
              <Input
                type={param.type === 'int' || param.type === 'float' ? 'number' : 'text'}
                value={param.default !== undefined ? String(param.default) : ''}
                onChange={(e) => updateParameter(index, {
                  default: coerceWizardParameterDefault(e.target.value, param.type),
                })}
                placeholder={t('pipelineEditor.customNodes.wizard.params.defaultPlaceholder')}
                className="font-mono text-sm h-8"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={() => removeParameter(index)}
              aria-label={t('pipelineEditor.customNodes.wizard.params.remove')}
            >
              &times;
            </Button>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addParameter} className="w-full">
          {t('pipelineEditor.customNodes.wizard.params.add')}
        </Button>
      </div>

      {parameters.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('pipelineEditor.customNodes.wizard.params.none')}
        </p>
      )}
    </div>
  );
}
