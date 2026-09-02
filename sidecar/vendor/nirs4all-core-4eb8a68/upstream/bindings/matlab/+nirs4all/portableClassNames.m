function classes = portableClassNames(definition)
%PORTABLECLASSNAMES Return class names in a parsed pipeline definition.

classes = {};
if isstruct(definition) && isfield(definition, 'pipeline')
    classes = collectClasses(definition.pipeline, classes);
else
    classes = collectClasses(definition, classes);
end
end

function classes = collectClasses(value, classes)
if iscell(value)
    for idx = 1:numel(value)
        classes = collectClasses(value{idx}, classes);
    end
    return
end

if isstruct(value)
    for idx = 1:numel(value)
        item = value(idx);
        if isfield(item, 'class')
            className = item.('class');
            if ischar(className)
                classes{end + 1} = className; %#ok<AGROW>
            end
        end
        fields = fieldnames(item);
        for fieldIdx = 1:numel(fields)
            classes = collectClasses(item.(fields{fieldIdx}), classes);
        end
    end
end
end
