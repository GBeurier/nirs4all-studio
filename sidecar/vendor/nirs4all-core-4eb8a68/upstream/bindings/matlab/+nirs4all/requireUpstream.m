function item = requireUpstream(name)
%REQUIREUPSTREAM Return upstream metadata or error if the key is unknown.

items = nirs4all.upstreams();
keys = {items.key};
idx = strcmp(keys, name);

if ~any(idx)
    error('nirs4all:UnknownUpstream', 'Unknown nirs4all upstream: %s', name);
end

item = items(find(idx, 1));
end
